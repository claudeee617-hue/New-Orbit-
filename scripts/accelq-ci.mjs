#!/usr/bin/env node
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const TERMINAL = new Set(['COMPLETED', 'ABORTED', 'FAILED_TO_START', 'FAILED', 'ERROR']);
const ACTIVE = new Set(['SCHEDULED', 'IN_PROGRESS', 'RUNNING']);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function log(message) {
  process.stdout.write(`${message}\n`);
}

function logError(message) {
  process.stderr.write(`${message}\n`);
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required ACCELQ configuration: ${name}`);
  return value;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

function count(value, label) {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value.trim()))) {
    throw new Error(`ACCELQ ${label} must be a non-negative integer.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`ACCELQ ${label} must be a non-negative integer.`);
  }
  return number;
}

export function validateRunProperties(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ACCELQ run properties must be a JSON object.');
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 16 * 1024) {
    throw new Error('ACCELQ run properties must not exceed 16 KiB.');
  }

  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const [key, item] of Object.entries(current)) {
      if (/secret|token|password|credential|cookie|private.?key|api.?key/i.test(key)) {
        throw new Error('ACCELQ run properties cannot contain credential-like field names.');
      }
      if (item && typeof item === 'object') stack.push(item);
    }
  }
  return value;
}

export function buildTriggerUrl(baseUrl, tenantCode, savedJobId) {
  const jobId = positiveInteger(savedJobId, 'ACCELQ_JOB_ID');
  return `${new URL(baseUrl).origin}/awb/api/1.0/${encodeURIComponent(tenantCode)}/jobs/${jobId}/trigger-ci-job`;
}

export function buildRunStatusUrl(baseUrl, tenantCode, runtimePid) {
  const pid = positiveInteger(runtimePid, 'ACCELQ runtime PID');
  return `${new URL(baseUrl).origin}/awb/api/1.0/${encodeURIComponent(tenantCode)}/runs/${pid}`;
}

export function normalizeRunPid(payload) {
  const first = Array.isArray(payload) ? payload[0] : payload;
  const candidate =
    typeof first === 'number' || typeof first === 'string'
      ? first
      : (first?.pid ?? first?.jobPid ?? first?.runtimeJobPid);
  return positiveInteger(candidate, 'ACCELQ runtime PID');
}

export function normalizeRunSnapshot(payload) {
  const data = payload?.summary ?? payload?.data ?? payload;
  const rawStatus = String(data?.status ?? '').trim();
  if (!rawStatus) throw new Error('ACCELQ status response did not contain a job status.');

  const status = rawStatus.toUpperCase().replace(/[\s-]+/g, '_');
  const passed = count(data.pass ?? data.passed, 'passed count');
  const failed = count(data.fail ?? data.failed, 'failed count');
  const notRun = count(data.notRun ?? data.not_run ?? data.notrun, 'not-run count');
  const total = passed + failed + notRun;
  const reportedTotal = data.testcaseCount ?? data.totalTestCases ?? data.total;
  if (
    reportedTotal !== undefined &&
    reportedTotal !== null &&
    count(reportedTotal, 'total test case count') !== total
  ) {
    throw new Error('ACCELQ test case totals do not reconcile with pass/fail/not-run counts.');
  }

  return { status, passed, failed, notRun, total };
}

export function evaluateRun(snapshot) {
  if (snapshot.status !== 'COMPLETED') {
    return { passed: false, reason: `ACCELQ job ended with status ${snapshot.status}.` };
  }
  if (snapshot.failed > 0) {
    return { passed: false, reason: `ACCELQ reported ${snapshot.failed} failed test case(s).` };
  }
  if (snapshot.notRun > 0) {
    return { passed: false, reason: `ACCELQ reported ${snapshot.notRun} not-run test case(s).` };
  }
  if (snapshot.total === 0) {
    return { passed: false, reason: 'ACCELQ completed without reporting any test cases.' };
  }
  return { passed: true, reason: 'All reported ACCELQ test cases passed.' };
}

function resolveConfiguration(env) {
  const app = new URL(required(env, 'ACCELQ_APP_URL'));
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash) {
    throw new Error(
      'ACCELQ_APP_URL must be an HTTPS server URL without credentials, query, or fragment.',
    );
  }
  if (app.pathname !== '/' && app.pathname !== '') {
    throw new Error(
      'ACCELQ_APP_URL must be the ACCELQ server root URL, not a project or application path.',
    );
  }

  const tenant = required(env, 'ACCELQ_TENANT_CODE');
  const userId = required(env, 'ACCELQ_USER_ID');
  const apiKey = required(env, 'ACCELQ_API_KEY');
  const jobId = positiveInteger(required(env, 'ACCELQ_JOB_ID'), 'ACCELQ_JOB_ID');
  let runProperties;
  if (env.ACCELQ_RUN_PROPERTIES_JSON?.trim()) {
    try {
      runProperties = JSON.parse(env.ACCELQ_RUN_PROPERTIES_JSON);
    } catch {
      throw new Error('ACCELQ_RUN_PROPERTIES_JSON must be valid JSON.');
    }
    try {
      validateRunProperties(runProperties);
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : 'ACCELQ_RUN_PROPERTIES_JSON is invalid.',
        { cause: error },
      );
    }
  }

  const maxRunMinutes = positiveInteger(
    env.ACCELQ_MAX_RUN_MINUTES || '90',
    'ACCELQ_MAX_RUN_MINUTES',
  );
  const agentPickupMinutes = positiveInteger(
    env.ACCELQ_AGENT_PICKUP_TIMEOUT_MINUTES || '20',
    'ACCELQ_AGENT_PICKUP_TIMEOUT_MINUTES',
  );
  const pollIntervalSeconds = positiveInteger(
    env.ACCELQ_POLL_INTERVAL_SECONDS || '30',
    'ACCELQ_POLL_INTERVAL_SECONDS',
  );

  return {
    baseUrl: app.origin,
    tenant,
    userId,
    apiKey,
    jobId,
    runProperties,
    maxRunMinutes,
    agentPickupMinutes,
    pollIntervalSeconds,
  };
}

async function requestJson(url, options, operation) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const reason =
      error?.name === 'TimeoutError' ? 'request timed out' : 'network or TLS request failed';
    throw new Error(
      `ACCELQ ${operation}: ${reason}. Check the server URL and outbound network access.`,
      { cause: error },
    );
  }

  if (!response.ok) {
    // Do not print the response body: vendors may include tenant-specific details.
    throw new Error(`ACCELQ ${operation} returned HTTP ${response.status}.`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`ACCELQ ${operation} returned an invalid JSON response.`);
  }
}

async function triggerJob(config) {
  const endpoint = buildTriggerUrl(config.baseUrl, config.tenant, config.jobId);
  const payload = { jobPid: config.jobId };
  if (config.runProperties) payload.runProperties = config.runProperties;

  const response = await requestJson(
    endpoint,
    {
      method: 'PUT',
      headers: {
        API_KEY: config.apiKey,
        USER_ID: config.userId,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    },
    'job trigger',
  );

  return normalizeRunPid(response);
}

async function fetchRunSnapshot(config, runtimePid) {
  const endpoint = buildRunStatusUrl(config.baseUrl, config.tenant, runtimePid);
  const response = await requestJson(
    endpoint,
    {
      method: 'GET',
      headers: {
        API_KEY: config.apiKey,
        USER_ID: config.userId,
        accept: 'application/json',
      },
    },
    'run status lookup',
  );
  return normalizeRunSnapshot(response);
}

function resultUrl(config, runtimePid) {
  return `${config.baseUrl}/#/resultext?tenant=${encodeURIComponent(config.tenant)}&resultId=${runtimePid}`;
}

async function writeSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) await appendFile(summaryPath, markdown + '\n', 'utf8');
}

async function main(env = process.env) {
  const config = resolveConfiguration(env);
  log('ACCELQ configuration validated. Credentials will not be printed.');
  log(`Triggering saved ACCELQ CI job ${config.jobId}.`);

  const runtimePid = await triggerJob(config);
  const link = resultUrl(config, runtimePid);
  log(`ACCELQ runtime PID: ${runtimePid}`);
  log(`ACCELQ result: ${link}`);

  const startTime = Date.now();
  let scheduledAt = null;

  while (true) {
    const snapshot = await fetchRunSnapshot(config, runtimePid);
    log(
      `ACCELQ status: ${snapshot.status} | total ${snapshot.total} | passed ${snapshot.passed} | failed ${snapshot.failed} | not run ${snapshot.notRun}`,
    );

    if (snapshot.status === 'SCHEDULED') {
      scheduledAt ??= Date.now();
      if (Date.now() - scheduledAt > config.agentPickupMinutes * 60_000) {
        throw new Error(
          `No ACCELQ Agent picked up the job within ${config.agentPickupMinutes} minutes. Check Resources > Local Agents and the CI job's assigned agent.`,
        );
      }
    } else {
      scheduledAt = null;
    }

    if (TERMINAL.has(snapshot.status)) {
      const result = evaluateRun(snapshot);
      const badge = result.passed ? 'PASS' : 'FAIL';
      await writeSummary(
        [
          '## ACCELQ Enterprise Regression',
          '',
          `- **Result:** ${badge}`,
          `- **Runtime PID:** ${runtimePid}`,
          `- **Status:** ${snapshot.status}`,
          `- **Test cases:** ${snapshot.total} total / ${snapshot.passed} passed / ${snapshot.failed} failed / ${snapshot.notRun} not run`,
          `- **ACCELQ report:** ${link}`,
          `- **Reason:** ${result.reason}`,
        ].join('\n'),
      );
      if (!result.passed) throw new Error(result.reason);
      log(result.reason);
      return;
    }

    if (!ACTIVE.has(snapshot.status)) {
      throw new Error(`ACCELQ returned an unsupported job status: ${snapshot.status}.`);
    }

    if (Date.now() - startTime > config.maxRunMinutes * 60_000) {
      throw new Error(
        `ACCELQ run exceeded the configured ${config.maxRunMinutes}-minute limit. Inspect the run report before retrying.`,
      );
    }

    await sleep(config.pollIntervalSeconds * 1000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    logError(`ACCELQ regression failed: ${error.message}`);
    process.exitCode = 1;
  });
}
