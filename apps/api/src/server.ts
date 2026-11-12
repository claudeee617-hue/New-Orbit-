import { timingSafeEqual } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import {
  hashArtifact,
  nodeIdFor,
  type EvidenceStatus,
  type JsonValue,
  type NodeType,
  canonicalJson,
} from '@orbit/core';
import {
  analyseTelemetry,
  analyseTestHistory,
  compareChangePassports,
  exportAtlas,
  getPassportHistory,
  impactMap,
  parseGoTestJson,
  parseJestJsonReport,
  parseJunitXml,
  parsePytestJsonReport,
  recordChangePassport,
  scanRepository,
  parseTelemetry,
  type PassportRecordInput,
  type TestCaseResult,
  type TestReliabilityReport,
} from '@orbit/atlas';
import { createGraphStore, type GraphStore, type OrbitDatabase } from '@orbit/database';
import { ORBIT_VERSION, OrbitError, type HealthResponse, type Logger } from '@orbit/shared';
import { prepareAIContext, runOrbitAnalysis, OrbitAIError, type AIProvider } from '@orbit/ai';
import { getOrCreateApiToken } from './session-token.js';

export const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '[::1]'];
const MAX_INGEST_BYTES = 2 * 1024 * 1024;
const MAX_GRAPH_LIMIT = 1000;
const MAX_FLARE_HISTORY_NODES = 100_000;
const FLARE_HISTORY_PAGE_SIZE = 10_000;

function readFlareHistory(
  store: GraphStore,
  repositoryId: string,
  options: { minSamples: number; minFlips: number },
): {
  testExecutions: number;
  distinctRuns: number;
  tests: number;
  summaries: TestReliabilityReport['summaries'];
  failureClusters: TestReliabilityReport['failureClusters'];
  slowTests: TestReliabilityReport['slowTests'];
  limitations: string[];
  truncated: boolean;
  scannedTestRunNodes: number;
} {
  const rows: Array<{
    runId: string;
    ordinal: number;
    recordedAt: string;
    result: TestCaseResult;
  }> = [];
  let offset = 0;
  let scannedTestRunNodes = 0;
  let lastPageSize = 0;

  while (scannedTestRunNodes < MAX_FLARE_HISTORY_NODES) {
    const page = store.nodes.find(repositoryId, {
      type: 'TestRun',
      limit: FLARE_HISTORY_PAGE_SIZE,
      offset,
    });
    lastPageSize = page.length;
    if (page.length === 0) break;
    scannedTestRunNodes += page.length;

    for (const node of page) {
      const attrs = node.attrs;
      const runId = attrs['runId'];
      const id = attrs['testId'];
      const name = attrs['name'];
      const suite = attrs['suite'];
      const outcome = attrs['outcome'];
      const duration = attrs['durationSeconds'];
      if (
        attrs['producer'] !== 'orbit-cli' ||
        attrs['recordKind'] !== 'case' ||
        typeof runId !== 'string' ||
        runId.length === 0 ||
        runId.length > 128 ||
        typeof id !== 'string' ||
        id.length === 0 ||
        id.length > 1000 ||
        typeof name !== 'string' ||
        name.length > 500 ||
        typeof suite !== 'string' ||
        suite.length > 500 ||
        !['passed', 'failed', 'skipped'].includes(String(outcome)) ||
        (duration !== null &&
          (typeof duration !== 'number' ||
            !Number.isFinite(duration) ||
            duration < 0 ||
            duration > 1_000_000_000))
      ) {
        continue;
      }
      const ordinal = attrs['ordinal'];
      rows.push({
        runId,
        ordinal: typeof ordinal === 'number' && Number.isInteger(ordinal) ? ordinal : 0,
        recordedAt: node.recordedAt,
        result: {
          id,
          name,
          suite,
          outcome: outcome as TestCaseResult['outcome'],
          durationSeconds: duration as number | null,
          ...(typeof attrs['message'] === 'string'
            ? { message: attrs['message'].slice(0, 2_000) }
            : {}),
        },
      });
      if (rows.length > MAX_FLARE_HISTORY_NODES) break;
    }

    offset += page.length;
    if (page.length < FLARE_HISTORY_PAGE_SIZE) break;
  }

  const moreNodes =
    scannedTestRunNodes >= MAX_FLARE_HISTORY_NODES &&
    lastPageSize === FLARE_HISTORY_PAGE_SIZE &&
    store.nodes.find(repositoryId, {
      type: 'TestRun',
      limit: 1,
      offset: scannedTestRunNodes,
    }).length > 0;
  const truncated = moreNodes || rows.length > MAX_FLARE_HISTORY_NODES;
  rows.sort(
    (a, b) =>
      a.recordedAt.localeCompare(b.recordedAt) ||
      a.runId.localeCompare(b.runId) ||
      a.ordinal - b.ordinal,
  );
  const history = rows.slice(0, MAX_FLARE_HISTORY_NODES);
  const analysis = analyseTestHistory(
    history.map((item) => item.result),
    options,
  );
  const limitations = [...analysis.limitations];
  if (history.length === 0) {
    limitations.push(
      'No per-test history records were found. Ingest JUnit, pytest, Jest or Go reports with the updated ORBIT CLI.',
    );
  }
  limitations.push(
    'The endpoint analyses per-test records written by the ORBIT CLI; legacy aggregate-only TestRun records do not count as executions.',
    'Failure signatures are normalized for grouping; they are not raw failure messages or a complete security scan.',
  );
  if (truncated) {
    limitations.push(
      `The API history scan reached the ${MAX_FLARE_HISTORY_NODES} TestRun-node bound; additional records were not analysed.`,
    );
  }
  return {
    testExecutions: history.length,
    distinctRuns: new Set(history.map((item) => item.runId)).size,
    tests: analysis.summaries.length,
    summaries: analysis.summaries,
    failureClusters: analysis.failureClusters,
    slowTests: analysis.slowTests,
    limitations,
    truncated,
    scannedTestRunNodes,
  };
}

export interface BuildServerOptions {
  database: OrbitDatabase;
  logger: Logger;
  /** Host names (without port) accepted in the Host header. Defaults to loopback names. */
  allowedHosts?: readonly string[];
  /** API session token. Authenticated routes are disabled when no token is supplied (tests only). */
  apiToken?: string;
  /** Database file used to place the generated token beside the workspace. */
  databasePath?: string;
  /** Optional test override. Production uses the generated or configured local API token. */
  env?: Record<string, string | undefined>;
}

/** Parsers run on caller-supplied content, so anything they throw is a client error. */
function parseInput<T>(what: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof OrbitError) throw error;
    throw new OrbitError('INVALID_INPUT', `${what} could not be parsed`, { cause: error });
  }
}

const HOST_HEADER = /^(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?$/i;

/**
 * Host name (without port, IPv6 brackets kept) of a Host header value, or '' when the value is
 * not a plain `host[:port]` pair. Anything else (userinfo, paths, trailing garbage after an IPv6
 * literal, non-numeric or out-of-range ports) is treated as invalid rather than guessed at.
 */
function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  const match = HOST_HEADER.exec(hostHeader);
  if (!match) return '';
  if (match[2] !== undefined && Number(match[2]) > 65535) return '';
  return match[1]!;
}

/**
 * Host name of a browser `Origin` header, or '' when it is not a plain http(s) origin
 * (`null`, opaque schemes, paths, userinfo).
 */
function originHostname(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '') {
    return '';
  }
  if (origin !== url.origin) return '';
  return url.hostname.toLowerCase();
}

type JsonRecord = Record<string, JsonValue>;

function record(value: unknown, what: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OrbitError('INVALID_INPUT', `${what} must be a JSON object`);
  }
  return value as JsonRecord;
}

function text(value: unknown, what: string, max = 512): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new OrbitError(
      'INVALID_INPUT',
      `${what} must be a non-empty string of at most ${max} characters`,
    );
  }
  return value.trim();
}

function optionalText(value: unknown, what: string, max = 256): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, what, max);
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  what: string,
): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new OrbitError('INVALID_INPUT', `${what} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

const ENVIRONMENT_KEYS = new Set([
  'schemaVersion',
  'runtimes',
  'toolchains',
  'packageManager',
  'fingerprint',
  'lockfiles',
  'manifestFiles',
  'workspaceSignals',
  'dependencyCount',
]);

function safeStringMap(value: unknown, label: string): Record<string, string> {
  const source = record(value, label);
  const output: Record<string, string> = {};
  const safeKey = /^[A-Za-z][A-Za-z0-9_.+-]{0,63}$/;
  for (const [key, item] of Object.entries(source).slice(0, 100)) {
    if (!safeKey.test(key) || typeof item !== 'string' || item.length > 128) {
      throw new OrbitError('INVALID_INPUT', `${label} must contain short named string values only`);
    }
    if (/secret|token|password|credential|cookie|private.?key|api.?key/i.test(key)) {
      throw new OrbitError('INVALID_INPUT', `${label} cannot contain credential-like field names`);
    }
    output[key] = item;
  }
  return output;
}

function safeStringList(value: unknown, label: string, maxItems = 100): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new OrbitError(
      'INVALID_INPUT',
      `${label} must be an array of at most ${maxItems} entries`,
    );
  }
  return value.map((item) => {
    if (typeof item !== 'string' || item.length === 0 || item.length > 256) {
      throw new OrbitError(
        'INVALID_INPUT',
        `${label} entries must be non-empty strings of at most 256 characters`,
      );
    }
    if (/secret|token|password|credential|cookie|private.?key|api.?key/i.test(item)) {
      throw new OrbitError('INVALID_INPUT', `${label} cannot contain credential-like text`);
    }
    return item;
  });
}

function sanitizeEnvironmentSnapshot(value: unknown): JsonRecord {
  const source = record(value, 'snapshot');
  const snapshot: JsonRecord = {};
  for (const key of Object.keys(source)) {
    if (!ENVIRONMENT_KEYS.has(key)) {
      throw new OrbitError(
        'INVALID_INPUT',
        `snapshot field ${key} is not supported; send only declared environment metadata`,
      );
    }
  }
  if (source.schemaVersion !== undefined) {
    if (source.schemaVersion !== 1)
      throw new OrbitError('INVALID_INPUT', 'snapshot schemaVersion must be 1');
    snapshot.schemaVersion = 1;
  }
  for (const key of ['runtimes', 'toolchains'] as const) {
    if (source[key] !== undefined) snapshot[key] = safeStringMap(source[key], key);
  }
  if (source.packageManager !== undefined) {
    snapshot.packageManager = text(source.packageManager, 'packageManager', 64);
  }
  if (source.fingerprint !== undefined) {
    const fingerprint = text(source.fingerprint, 'fingerprint', 64);
    if (!/^[a-f0-9]{64}$/i.test(fingerprint))
      throw new OrbitError('INVALID_INPUT', 'fingerprint must be a SHA-256 digest');
    snapshot.fingerprint = fingerprint.toLowerCase();
  }
  for (const key of ['lockfiles', 'manifestFiles', 'workspaceSignals'] as const) {
    if (source[key] !== undefined) snapshot[key] = safeStringList(source[key], key);
  }
  if (source.dependencyCount !== undefined) {
    snapshot.dependencyCount = boundedInteger(
      source.dependencyCount,
      0,
      0,
      100_000,
      'dependencyCount',
    );
  }
  return snapshot;
}

function sanitizeCiSummary(value: unknown): JsonRecord {
  const source = record(value, 'summary');
  const numericFields = [
    'passed',
    'failed',
    'skipped',
    'durationSeconds',
    'jobCount',
    'artifactCount',
    'attempt',
  ];
  const stringFields = ['conclusion', 'event', 'runnerOS', 'workflowName'];
  const allowed = new Set([...numericFields, ...stringFields]);
  const summary: JsonRecord = {};
  for (const [key, item] of Object.entries(source)) {
    if (!allowed.has(key))
      throw new OrbitError('INVALID_INPUT', `summary field ${key} is not supported`);
    if (numericFields.includes(key)) {
      if (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1_000_000_000) {
        throw new OrbitError(
          'INVALID_INPUT',
          `summary field ${key} must be a non-negative finite number`,
        );
      }
      summary[key] = item;
    } else {
      summary[key] = text(item, `summary.${key}`, 128);
    }
  }
  return summary;
}

function hashablePayload(value: unknown): string {
  const encoded = canonicalJson(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_INGEST_BYTES) {
    throw new OrbitError('INVALID_INPUT', 'Ingestion payload exceeds the 2 MiB limit');
  }
  return encoded;
}

function httpStatus(error: unknown): number {
  if (error instanceof OrbitAIError) {
    if (error.code === 'AI_DISABLED' || error.code === 'APPROVAL_REQUIRED') return 403;
    if (error.code === 'CONTEXT_MISMATCH') return 409;
    if (error.code === 'PROVIDER_ERROR') return 502;
    if (error.code === 'RESPONSE_TOO_LARGE') return 413;
    return 400;
  }
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const status = Number((error as { statusCode?: unknown }).statusCode);
    if (status >= 400 && status <= 599) return status;
  }
  if (error instanceof OrbitError) {
    if (error.code === 'NOT_FOUND') return 404;
    if (error.code === 'INVALID_INPUT' || error.code === 'CONFIG_INVALID') return 400;
    if (error.code === 'DATABASE_ERROR') return 503;
  }
  return 500;
}

function repositoryByKey(store: GraphStore, key: string) {
  const repository = store.repositories.list().find((item) => item.key === key || item.id === key);
  if (!repository) {
    throw new OrbitError('NOT_FOUND', `Repository ${key} was not found`, {
      details: { repositoryKey: key },
    });
  }
  return repository;
}

function authenticate(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function appendEvidence(
  store: GraphStore,
  input: {
    repositoryId: string;
    source: string;
    sourceType: 'ci' | 'test-report' | 'environment' | 'telemetry';
    content: string;
    status: EvidenceStatus;
    commitSha?: string;
    limitation?: string;
    relatedEntityIds?: string[];
  },
) {
  return store.evidence.append({
    repositoryId: input.repositoryId,
    source: input.source,
    sourceType: input.sourceType,
    ...(input.commitSha ? { commitSha: input.commitSha } : {}),
    contentHash: hashArtifact(input.content),
    status: input.status,
    limitations: input.limitation ? [input.limitation] : [],
    relatedEntityIds: input.relatedEntityIds ?? [],
  }).record;
}

export function buildServer(options: BuildServerOptions) {
  const allowed = new Set(
    (options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS).map((h) => h.toLowerCase()),
  );
  const tokenInfo = options.apiToken
    ? { token: options.apiToken, filePath: null, source: 'environment' as const }
    : options.databasePath
      ? getOrCreateApiToken(options.databasePath, options.env)
      : null;
  const apiToken = tokenInfo?.token;
  const server = Fastify({
    loggerInstance: options.logger,
    bodyLimit: MAX_INGEST_BYTES + 64 * 1024,
  });

  // DNS-rebinding defence: only explicitly allowed loopback Host names are accepted by default.
  server.addHook('onRequest', async (request, reply) => {
    if (!allowed.has(hostnameOf(request.headers.host).toLowerCase())) {
      return reply.code(403).send({ error: 'FORBIDDEN_HOST', message: 'Host header not allowed' });
    }
    // Browsers attach Origin to cross-site requests. A request whose Origin is not itself an
    // allowed local host is refused before it can reach any route, even a public one, so a page
    // on another site cannot drive the API even if it learns the token. Non-browser clients
    // (CLI, curl, the Vite proxy for same-origin calls) send no Origin and are unaffected.
    const origin = request.headers.origin;
    if (origin !== undefined && !allowed.has(originHostname(origin))) {
      return reply.code(403).send({ error: 'FORBIDDEN_ORIGIN', message: 'Origin not allowed' });
    }
    // Decide on the route the router actually matched, not on the URL text: the router decodes
    // %-escapes, so a prefix test on the raw URL can be bypassed (`/%61pi/v1/...`). Only the
    // exact `/health` route is public; unmatched URLs reach the 404 handler, which returns no data.
    const matched = request.routeOptions.url;
    const isPublic = matched === undefined || matched === '/health' || matched === '*';
    if (!isPublic) {
      if (!apiToken || !authenticate(request.headers.authorization, apiToken)) {
        return reply.code(401).send({
          error: 'UNAUTHENTICATED',
          message: 'Provide the local ORBIT session token using Authorization: Bearer <token>',
        });
      }
    }
    return undefined;
  });

  server.setErrorHandler((error, _request, reply) => {
    const status = httpStatus(error);
    const code =
      error instanceof OrbitError || error instanceof OrbitAIError
        ? error.code
        : status < 500
          ? 'INVALID_INPUT'
          : 'INTERNAL';
    const message =
      status >= 500
        ? 'The ORBIT API could not complete the request'
        : error instanceof Error
          ? error.message
          : 'Invalid request';
    if (status >= 500) options.logger.error({ code }, 'API request failed');
    return reply.code(status).send({ error: code, message });
  });

  server.get('/health', async (_request, reply): Promise<HealthResponse> => {
    const healthy = options.database.isHealthy();
    const body: HealthResponse = {
      status: healthy ? 'ok' : 'degraded',
      service: 'orbit-api',
      version: ORBIT_VERSION,
      database: {
        connected: healthy,
        schemaVersion: healthy ? options.database.schemaVersion() : null,
      },
    };
    if (!healthy) reply.code(503);
    return body;
  });

  const store = createGraphStore(options.database);
  const dbPath = options.databasePath ?? options.database.path;

  // Ledger integrity and historical analysis can scan many persisted records.
  // Share a bounded per-client read budget across these expensive endpoints.
  const expensiveReadRateWindows = new Map<string, { startedAt: number; count: number }>();
  const expensiveReadRateLimit = async (request: FastifyRequest, reply: FastifyReply) => {
    const now = Date.now();
    const windowMs = 60_000;
    const maxRequests = 60;
    const key = request.ip;
    let window = expensiveReadRateWindows.get(key);

    if (!window || now - window.startedAt >= windowMs) {
      // Expire stale entries and keep the map bounded even if the API is
      // deliberately exposed to many distinct local network clients.
      for (const [client, entry] of expensiveReadRateWindows) {
        if (now - entry.startedAt >= windowMs) expensiveReadRateWindows.delete(client);
      }
      if (!expensiveReadRateWindows.has(key) && expensiveReadRateWindows.size >= 1024) {
        const oldest = expensiveReadRateWindows.keys().next().value;
        if (oldest !== undefined) expensiveReadRateWindows.delete(oldest);
      }
      window = { startedAt: now, count: 0 };
      expensiveReadRateWindows.set(key, window);
    }

    if (window.count >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((window.startedAt + windowMs - now) / 1000));
      return reply.header('Retry-After', String(retryAfter)).code(429).send({
        error: 'RATE_LIMITED',
        message: 'Resource-intensive read requests are limited to 60 per minute',
      });
    }

    window.count += 1;
    return undefined;
  };

  server.get('/api/v1/session', async () => ({
    authenticated: true,
    tokenSource: tokenInfo?.source ?? 'in-memory-test',
    tokenFile: tokenInfo?.filePath ?? null,
    note: 'The token value is never returned by the API.',
  }));

  server.get('/api/v1/repositories', async () => ({
    repositories: store.repositories.list(),
  }));

  server.post('/api/v1/repositories/scan', async (request, reply) => {
    const body = record(request.body, 'body');
    const requestedRoot = text(body.rootPath, 'rootPath', 4096);
    let rootPath: string;
    try {
      rootPath = await realpath(resolve(requestedRoot));
      const info = await stat(rootPath);
      if (!info.isDirectory()) throw new Error('not a directory');
    } catch {
      throw new OrbitError('INVALID_INPUT', 'rootPath must identify an existing local directory');
    }
    const repositoryKey =
      optionalText(body.repositoryKey, 'repositoryKey', 1024) ?? `local/${basename(rootPath)}`;
    const maxFiles = boundedInteger(body.maxFiles, 20_000, 1, 100_000, 'maxFiles');
    const maxCommits = boundedInteger(body.maxCommits, 500, 1, 10_000, 'maxCommits');
    const result = await scanRepository({
      rootPath,
      store,
      repositoryKey,
      cacheDir: resolve(dirname(dbPath), 'cache'),
      config: {
        maxFiles,
        maxCommits,
        skipGit: body.skipGit === true,
        skipCalls: body.skipCalls === true,
      },
    });
    reply.code(200);
    return { result };
  });

  server.get<{ Params: { key: string } }>('/api/v1/repositories/:key', async (request) => {
    const repository = repositoryByKey(store, request.params.key);
    return { repository };
  });

  server.get<{
    Params: { key: string };
    Querystring: {
      limit?: string;
      offset?: string;
      nodeOffset?: string;
      edgeOffset?: string;
      type?: string;
    };
  }>('/api/v1/repositories/:key/graph', async (request) => {
    const repository = repositoryByKey(store, request.params.key);
    const limit = boundedInteger(request.query.limit, 100, 1, MAX_GRAPH_LIMIT, 'limit');
    const offset = boundedInteger(request.query.offset, 0, 0, 1_000_000, 'offset');
    const nodeOffset = boundedInteger(request.query.nodeOffset, offset, 0, 1_000_000, 'nodeOffset');
    const edgeOffset = boundedInteger(request.query.edgeOffset, offset, 0, 1_000_000, 'edgeOffset');
    const type = optionalText(request.query.type, 'type', 64) as NodeType | undefined;
    const validTypes: readonly string[] = [
      'Repository',
      'File',
      'Symbol',
      'Function',
      'Class',
      'Module',
      'Dependency',
      'Commit',
      'PullRequest',
      'Issue',
      'Decision',
      'Documentation',
      'Test',
      'TestRun',
      'CIWorkflow',
      'Environment',
      'Build',
      'Artifact',
      'Firmware',
      'HardwareDevice',
      'TelemetrySession',
      'Finding',
      'ChangePassport',
    ];
    if (type && !validTypes.includes(type))
      throw new OrbitError('INVALID_INPUT', 'type is not a supported graph node type');
    const nodes = store.nodes.find(repository.id, {
      ...(type ? { type } : {}),
      limit,
      offset: nodeOffset,
    });
    const edges = store.edges.list(repository.id, { limit, offset: edgeOffset });
    const ledgerHead = store.ledger.head(repository.id);
    return {
      repository,
      nodes,
      edges,
      page: {
        limit,
        offset,
        nodeOffset,
        edgeOffset,
        hasMoreNodes: nodes.length === limit,
        hasMoreEdges: edges.length === limit,
      },
      ledger: { entries: ledgerHead?.seq ?? 0, headHash: ledgerHead?.hash ?? null },
    };
  });

  server.get<{ Params: { key: string } }>(
    '/api/v1/repositories/:key/integrity',
    { preHandler: expensiveReadRateLimit },
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      return { repository, integrity: store.verifyIntegrity(repository.id) };
    },
  );

  server.get<{
    Params: { key: string };
    Querystring: {
      limit?: string;
      offset?: string;
      commitSha?: string;
      sourceType?: string;
    };
  }>('/api/v1/repositories/:key/evidence', async (request) => {
    const repository = repositoryByKey(store, request.params.key);
    const limit = boundedInteger(request.query.limit, 100, 1, 1000, 'limit');
    const offset = boundedInteger(request.query.offset, 0, 0, 1_000_000, 'offset');
    const commitSha = optionalText(request.query.commitSha, 'commitSha', 64);
    if (commitSha && !/^[0-9a-f]{7,64}$/i.test(commitSha))
      throw new OrbitError('INVALID_INPUT', 'commitSha is invalid');
    const sourceType = optionalText(request.query.sourceType, 'sourceType', 32);
    const allowedTypes = [
      'git',
      'coverage',
      'test-report',
      'ci',
      'environment',
      'build',
      'telemetry',
      'parser',
      'manual',
      'ai-note',
    ];
    if (sourceType && !allowedTypes.includes(sourceType))
      throw new OrbitError('INVALID_INPUT', 'sourceType is invalid');
    const evidence = store.evidence.list(repository.id, {
      limit,
      offset,
      ...(commitSha ? { commitSha } : {}),
      ...(sourceType
        ? { sourceType: sourceType as 'ci' | 'test-report' | 'environment' | 'telemetry' }
        : {}),
    });
    return {
      repository,
      evidence,
      returned: evidence.length,
      limit,
      page: { limit, offset, hasMore: evidence.length === limit },
    };
  });

  function prepareRepositoryAIContext(repositoryId: string, body: JsonRecord) {
    const provider = text(body.provider, 'provider', 16) as AIProvider;
    if (!['openai', 'anthropic', 'ollama'].includes(provider)) {
      throw new OrbitError('INVALID_INPUT', 'provider must be openai, anthropic or ollama');
    }
    const model = text(body.model, 'model', 256);
    const prompt = text(body.prompt, 'prompt', 12_000);
    const evidenceIds = safeStringList(body.evidenceIds, 'evidenceIds', 50);
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      throw new OrbitError('INVALID_INPUT', 'evidenceIds must not contain duplicates');
    }
    const selected = evidenceIds.map((id) => {
      const item = store.evidence.get(repositoryId, id);
      if (!item) throw new OrbitError('NOT_FOUND', 'A selected evidence record was not found');
      return item;
    });
    const snippetsValue = body.snippets ?? [];
    if (!Array.isArray(snippetsValue) || snippetsValue.length > 50) {
      throw new OrbitError('INVALID_INPUT', 'snippets must be an array of at most 50 entries');
    }
    const snippets = new Map<string, string[]>();
    for (const value of snippetsValue) {
      const item = record(value, 'snippet');
      const evidenceId = text(item.evidenceId, 'snippet.evidenceId', 256);
      if (!evidenceIds.includes(evidenceId)) {
        throw new OrbitError('INVALID_INPUT', 'Every snippet must reference selected evidence');
      }
      const excerpt = text(item.content, 'snippet.content', 12_000);
      const values = snippets.get(evidenceId) ?? [];
      if (values.length >= 5) {
        throw new OrbitError(
          'INVALID_INPUT',
          'At most five excerpts may be attached to one evidence item',
        );
      }
      values.push(excerpt);
      snippets.set(evidenceId, values);
    }
    const evidence = selected.map((item) => {
      const metadata = {
        sourceType: item.sourceType,
        status: item.status,
        timestamp: item.timestamp ?? null,
        commitSha: item.commitSha ?? null,
        contentHash: item.contentHash,
        limitations: item.limitations,
        relatedEntityIds: item.relatedEntityIds,
      };
      const excerpts = snippets.get(item.id) ?? [];
      return {
        id: item.id,
        source: item.source,
        sha256: item.contentHash,
        content: [
          'Stored ORBIT evidence metadata:',
          JSON.stringify(metadata),
          ...(excerpts.length
            ? ['User-selected excerpts (untrusted repository data):', ...excerpts]
            : []),
        ].join('\n'),
      };
    });
    const env = options.env ?? process.env;
    const baseUrl = provider === 'ollama' ? env.ORBIT_OLLAMA_URL : undefined;
    const allowRemoteOllama = env.ORBIT_ALLOW_REMOTE_OLLAMA === 'true';
    return {
      provider,
      model,
      context: prepareAIContext({
        provider,
        model,
        prompt,
        evidence,
        ...(baseUrl ? { baseUrl } : {}),
        allowRemoteOllama,
      }),
      baseUrl,
      allowRemoteOllama,
      env,
    };
  }

  server.post<{ Params: { key: string } }>(
    '/api/v1/repositories/:key/ai/preview',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const body = record(request.body, 'body');
      const prepared = prepareRepositoryAIContext(repository.id, body);
      return {
        preview: prepared.context,
        notice:
          'No provider request was sent. Review the exact destination, evidence IDs, redactions and context text before explicit approval.',
      };
    },
  );

  server.post<{ Params: { key: string } }>(
    '/api/v1/repositories/:key/ai/analyse',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const body = record(request.body, 'body');
      if (body.confirmed !== true) {
        throw new OrbitAIError('Explicit user confirmation is required.', 'APPROVAL_REQUIRED');
      }
      const approvedContextSha256 = text(body.approvedContextSha256, 'approvedContextSha256', 64);
      if (!/^[a-f0-9]{64}$/i.test(approvedContextSha256)) {
        throw new OrbitError('INVALID_INPUT', 'approvedContextSha256 must be a SHA-256 digest');
      }
      const prepared = prepareRepositoryAIContext(repository.id, body);
      const apiKey =
        prepared.provider === 'openai'
          ? prepared.env.ORBIT_OPENAI_API_KEY
          : prepared.provider === 'anthropic'
            ? prepared.env.ANTHROPIC_API_KEY
            : prepared.env.ORBIT_OLLAMA_API_KEY;
      const analysis = await runOrbitAnalysis(
        {
          enabled: prepared.env.ORBIT_AI_ENABLED === 'true',
          userApproved: true,
          approvedContextSha256,
          provider: prepared.provider,
          model: prepared.model,
          ...(apiKey ? { apiKey } : {}),
          ...(prepared.baseUrl ? { baseUrl: prepared.baseUrl } : {}),
          allowRemoteOllama: prepared.allowRemoteOllama,
        },
        prepared.context,
      );
      return { analysis };
    },
  );

  server.get<{ Params: { key: string }; Querystring: { limit?: string; offset?: string } }>(
    '/api/v1/repositories/:key/passports',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const limit = boundedInteger(request.query.limit, 100, 1, MAX_GRAPH_LIMIT, 'limit');
      const offset = boundedInteger(request.query.offset, 0, 0, 1_000_000, 'offset');
      const passports = store.nodes
        .find(repository.id, { type: 'ChangePassport', limit, offset })
        .filter((item) => item.attrs['producer'] === 'orbit-passport');
      return {
        repository,
        passports,
        page: { limit, offset, hasMore: passports.length === limit },
      };
    },
  );

  server.get<{ Params: { key: string; id: string } }>(
    '/api/v1/repositories/:key/passports/:id/history',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      return { repository, history: getPassportHistory(store, repository.id, request.params.id) };
    },
  );

  server.get<{ Params: { key: string; before: string; after: string } }>(
    '/api/v1/repositories/:key/passports/:before/compare/:after',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      return {
        repository,
        comparison: compareChangePassports(
          store,
          repository.id,
          request.params.before,
          request.params.after,
        ),
      };
    },
  );

  server.get<{ Params: { key: string }; Querystring: { file?: string } }>(
    '/api/v1/repositories/:key/reports/impact',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const file = text(request.query.file, 'file', 4096);
      return { repository, impact: impactMap(store, repository.id, file) };
    },
  );

  server.get<{ Params: { key: string } }>(
    '/api/v1/repositories/:key/reports/atlas',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      return { repository, report: exportAtlas(store, repository.id) };
    },
  );

  server.get<{
    Params: { key: string };
    Querystring: { minSamples?: string; minFlips?: string };
  }>(
    '/api/v1/repositories/:key/reports/flare/history',
    { preHandler: expensiveReadRateLimit },
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const minSamples = boundedInteger(request.query.minSamples, 8, 2, 100_000, 'minSamples');
      const minFlips = boundedInteger(request.query.minFlips, 3, 1, 100_000, 'minFlips');
      return {
        repository,
        history: readFlareHistory(store, repository.id, { minSamples, minFlips }),
      };
    },
  );

  server.post<{ Params: { key: string } }>(
    '/api/v1/repositories/:key/ingest/ci',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const body = record(request.body, 'body');
      const status = text(body.status, 'status', 32).toLowerCase();
      const source = optionalText(body.source, 'source', 512) ?? 'api:ci-ingest';
      const commitSha = optionalText(body.commitSha, 'commitSha', 64);
      if (commitSha && !/^[0-9a-f]{7,64}$/i.test(commitSha))
        throw new OrbitError('INVALID_INPUT', 'commitSha is invalid');
      const resultValue = ['success', 'passed', 'pass'].includes(status)
        ? 'PASS'
        : ['failure', 'failed', 'fail'].includes(status)
          ? 'FAIL'
          : 'PARTIAL';
      const payload = {
        status,
        source,
        ...(commitSha ? { commitSha: commitSha.toLowerCase() } : {}),
        ...(body.runId !== undefined ? { runId: text(body.runId, 'runId', 256) } : {}),
        ...(body.workflow !== undefined ? { workflow: text(body.workflow, 'workflow', 256) } : {}),
        ...(body.branch !== undefined ? { branch: text(body.branch, 'branch', 256) } : {}),
        ...(body.summary !== undefined ? { summary: sanitizeCiSummary(body.summary) } : {}),
      };
      const encoded = hashablePayload(payload);
      const contentHash = hashArtifact(encoded);
      const key = `ci:${commitSha?.toLowerCase() ?? contentHash}`;
      const nodeId = nodeIdFor(repository.id, 'CIWorkflow', key);
      const evidence = appendEvidence(store, {
        repositoryId: repository.id,
        source,
        sourceType: 'ci',
        content: encoded,
        status: resultValue,
        ...(commitSha ? { commitSha } : {}),
        ...(resultValue === 'PARTIAL'
          ? { limitation: 'The supplied CI status is not a recognised pass or failure state.' }
          : {}),
        relatedEntityIds: [nodeId],
      });
      const node = store.nodes.upsert({
        repositoryId: repository.id,
        type: 'CIWorkflow',
        key,
        attrs: { producer: 'orbit-api', schemaVersion: 1, ...payload, status: resultValue },
        sourceEvidenceId: evidence.id,
        ...(commitSha ? { validFromCommit: commitSha } : {}),
      });
      return { evidence, node: node.record };
    },
  );

  server.post<{ Params: { key: string } }>(
    '/api/v1/repositories/:key/ingest/test-report',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const body = record(request.body, 'body');
      const format = text(body.format, 'format', 32);
      const content = text(body.content, 'content', MAX_INGEST_BYTES);
      const commitSha = optionalText(body.commitSha, 'commitSha', 64);
      if (commitSha && !/^[0-9a-f]{7,64}$/i.test(commitSha))
        throw new OrbitError('INVALID_INPUT', 'commitSha is invalid');
      let cases;
      if (format === 'junit') cases = parseInput('JUnit report', () => parseJunitXml(content));
      else if (format === 'pytest-json')
        cases = parseInput('pytest report', () => parsePytestJsonReport(content));
      else if (format === 'jest-json')
        cases = parseInput('Jest report', () => parseJestJsonReport(content));
      else if (format === 'go-json')
        cases = parseInput('Go test output', () => parseGoTestJson(content));
      else
        throw new OrbitError(
          'INVALID_INPUT',
          'format must be junit, pytest-json, jest-json or go-json',
        );
      // A report with no test cases is not evidence that anything passed.
      if (cases.length === 0)
        throw new OrbitError('INVALID_INPUT', 'The test report contains no test cases');
      const summary = {
        format,
        total: cases.length,
        passed: cases.filter((item) => item.outcome === 'passed').length,
        failed: cases.filter((item) => item.outcome === 'failed').length,
        skipped: cases.filter((item) => item.outcome === 'skipped').length,
      };
      const status: EvidenceStatus = summary.failed > 0 ? 'FAIL' : 'PASS';
      const contentHash = hashArtifact(content);
      const key = `test-report:${contentHash}`;
      const nodeId = nodeIdFor(repository.id, 'TestRun', key);
      const evidence = appendEvidence(store, {
        repositoryId: repository.id,
        source: optionalText(body.source, 'source', 512) ?? `api:test-report:${format}`,
        sourceType: 'test-report',
        content,
        status,
        ...(commitSha ? { commitSha } : {}),
        relatedEntityIds: [nodeId],
      });
      const node = store.nodes.upsert({
        repositoryId: repository.id,
        type: 'TestRun',
        key,
        attrs: {
          producer: 'orbit-api',
          schemaVersion: 1,
          ...summary,
          ...(commitSha ? { commitSha } : {}),
        },
        sourceEvidenceId: evidence.id,
        ...(commitSha ? { validFromCommit: commitSha } : {}),
      });
      return { evidence, node: node.record, summary };
    },
  );

  server.post<{ Params: { key: string } }>(
    '/api/v1/repositories/:key/ingest/environment',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const body = record(request.body, 'body');
      const snapshot = sanitizeEnvironmentSnapshot(body.snapshot);
      const encoded = hashablePayload(snapshot);
      const contentHash = hashArtifact(encoded);
      const key = `environment:${contentHash}`;
      const nodeId = nodeIdFor(repository.id, 'Environment', key);
      const evidence = appendEvidence(store, {
        repositoryId: repository.id,
        source: optionalText(body.source, 'source', 512) ?? 'api:environment-ingest',
        sourceType: 'environment',
        content: encoded,
        status: 'PARTIAL',
        limitation:
          'This is a supplied environment description, not a measurement of the actual runner or installed filesystem.',
        relatedEntityIds: [nodeId],
      });
      const node = store.nodes.upsert({
        repositoryId: repository.id,
        type: 'Environment',
        key,
        attrs: { producer: 'orbit-api', schemaVersion: 1, snapshotHash: contentHash, snapshot },
        sourceEvidenceId: evidence.id,
      });
      return { evidence, node: node.record };
    },
  );

  server.post<{ Params: { key: string } }>(
    '/api/v1/repositories/:key/ingest/telemetry',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const body = record(request.body, 'body');
      const content = text(body.content, 'content', MAX_INGEST_BYTES);
      const format = body.format as 'json' | 'ndjson' | 'csv' | 'key-value' | undefined;
      if (format !== undefined && !['json', 'ndjson', 'csv', 'key-value'].includes(format)) {
        throw new OrbitError('INVALID_INPUT', 'format must be json, ndjson, csv or key-value');
      }
      const session = parseInput('Telemetry', () => parseTelemetry(content, format));
      const analysis = parseInput('Telemetry analysis', () =>
        analyseTelemetry(session, { units: safeStringMap(body.units ?? {}, 'units') }),
      );
      const contentHash = hashArtifact(content);
      const key = `telemetry:${contentHash}`;
      const nodeId = nodeIdFor(repository.id, 'TelemetrySession', key);
      const commitSha = optionalText(body.commitSha, 'commitSha', 64);
      if (commitSha && !/^[0-9a-f]{7,64}$/i.test(commitSha))
        throw new OrbitError('INVALID_INPUT', 'commitSha is invalid');
      const summary = {
        format: session.format,
        rawSha256: session.rawSha256,
        records: session.points.length,
        metricNames: session.metricNames,
        watchdogEvents: session.watchdogEvents,
        resetEvents: session.resetEvents,
        analysis: {
          metricNames: Object.keys(analysis.metricStats),
          anomalies: analysis.anomalies.length,
          eventCounts: analysis.eventCounts,
        },
        ...(body.demo === true ? { demo: true } : {}),
      };
      const evidence = appendEvidence(store, {
        repositoryId: repository.id,
        source: optionalText(body.source, 'source', 512) ?? 'api:telemetry-ingest',
        sourceType: 'telemetry',
        content,
        status: 'PARTIAL',
        ...(commitSha ? { commitSha } : {}),
        limitation:
          'Recorded telemetry is observational evidence and does not prove correctness or imply a physical serial connection.',
        relatedEntityIds: [nodeId],
      });
      const node = store.nodes.upsert({
        repositoryId: repository.id,
        type: 'TelemetrySession',
        key,
        attrs: {
          producer: 'orbit-api',
          schemaVersion: 1,
          ...summary,
          deviceLabel: optionalText(body.deviceLabel, 'deviceLabel', 128) ?? null,
          firmwareBuildId: optionalText(body.firmwareBuildId, 'firmwareBuildId', 128) ?? null,
        },
        sourceEvidenceId: evidence.id,
        ...(commitSha ? { validFromCommit: commitSha } : {}),
      });
      return { evidence, node: node.record, summary };
    },
  );

  server.post<{ Params: { key: string } }>(
    '/api/v1/repositories/:key/passports',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const body = record(request.body, 'body');
      const input = {
        ...body,
        repositoryId: repository.id,
        repository: repository.key,
      } as unknown as PassportRecordInput;
      const result = recordChangePassport(store, input);
      return { result };
    },
  );

  server.get<{ Params: { key: string; id: string } }>(
    '/api/v1/repositories/:key/evidence/:id',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const evidence = store.evidence.get(repository.id, request.params.id);
      if (!evidence) throw new OrbitError('NOT_FOUND', 'Evidence was not found in this repository');
      return { evidence };
    },
  );

  server.get<{ Params: { key: string; id: string } }>(
    '/api/v1/repositories/:key/nodes/:id',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const node = store.nodes.get(repository.id, request.params.id);
      if (!node) throw new OrbitError('NOT_FOUND', 'Graph node was not found in this repository');
      return { node, evidence: store.evidence.forEntity(repository.id, node.id) };
    },
  );

  server.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: 'NOT_FOUND', message: 'Route not found' });
  });

  return server;
}
