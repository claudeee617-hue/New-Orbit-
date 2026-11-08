import { createHash } from 'node:crypto';
import { summarizeTestHistory, type TestCaseResult, type TestHistorySummary } from './flare.js';

const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_TESTS = 100_000;
const MAX_HISTORY = 100_000;

function parseBoundedJson(content: string, label: string): unknown {
  if (Buffer.byteLength(content, 'utf8') > MAX_JSON_BYTES)
    throw new Error(`${label} exceeds the 10 MiB parser limit`);
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function duration(value: unknown, unit: 'seconds' | 'milliseconds' = 'seconds'): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return unit === 'milliseconds' ? value / 1000 : value;
}

function outcome(value: unknown): TestCaseResult['outcome'] | undefined {
  if (value === 'passed' || value === 'pass' || value === 'success') return 'passed';
  if (value === 'failed' || value === 'fail' || value === 'failure' || value === 'error')
    return 'failed';
  if (value === 'skipped' || value === 'skip' || value === 'pending' || value === 'todo')
    return 'skipped';
  return undefined;
}

function makeResult(input: {
  id: string;
  name: string;
  suite: string;
  outcome: TestCaseResult['outcome'];
  durationSeconds: number | null;
  message?: string;
}): TestCaseResult {
  return {
    id: input.id.slice(0, 1000),
    name: input.name.slice(0, 500),
    suite: input.suite.slice(0, 500),
    outcome: input.outcome,
    durationSeconds: input.durationSeconds,
    ...(input.message ? { message: input.message.slice(0, 2000) } : {}),
  };
}

/** Parse pytest-json-report output (the JSON report plugin's documented tests[] structure). */
export function parsePytestJsonReport(content: string): TestCaseResult[] {
  const root = record(parseBoundedJson(content, 'pytest JSON report'));
  if (!root || !Array.isArray(root.tests))
    throw new Error('pytest JSON report must contain a tests array');
  if (root.tests.length > MAX_TESTS)
    throw new Error('pytest JSON report exceeds the 100000 test limit');
  const results: TestCaseResult[] = [];
  for (const raw of root.tests) {
    const item = record(raw);
    if (!item) continue;
    const nodeid = text(item.nodeid, text(item.name, 'unnamed'));
    const phase = record(item.call);
    const setup = record(item.setup);
    const teardown = record(item.teardown);
    const phaseOutcomes = [setup?.outcome, phase?.outcome, teardown?.outcome].filter(
      (v) => typeof v === 'string',
    );
    const parsed = phaseOutcomes
      .map(outcome)
      .filter((v): v is TestCaseResult['outcome'] => v !== undefined);
    const result = parsed.includes('failed')
      ? 'failed'
      : parsed.includes('passed')
        ? 'passed'
        : (parsed[0] ?? outcome(item.outcome));
    if (!result) continue;
    const seconds = duration(item.duration);
    const longrepr = text(phase?.longrepr, text(setup?.longrepr, text(teardown?.longrepr)));
    const suite = nodeid.includes('::') ? nodeid.split('::').slice(0, -1).join('::') : 'pytest';
    results.push(
      makeResult({
        id: nodeid,
        name: nodeid.split('::').at(-1) ?? nodeid,
        suite,
        outcome: result,
        durationSeconds: seconds,
        ...(result === 'failed' && longrepr ? { message: longrepr } : {}),
      }),
    );
  }
  return results;
}

/** Parse Jest --json output, including assertion results and their millisecond durations. */
export function parseJestJsonReport(content: string): TestCaseResult[] {
  const root = record(parseBoundedJson(content, 'Jest JSON report'));
  if (!root || !Array.isArray(root.testResults))
    throw new Error('Jest JSON report must contain testResults');
  const results: TestCaseResult[] = [];
  for (const rawSuite of root.testResults) {
    const suite = record(rawSuite);
    if (!suite || !Array.isArray(suite.assertionResults)) continue;
    const suiteName = text(suite.name, 'jest-suite');
    for (const rawTest of suite.assertionResults) {
      const test = record(rawTest);
      if (!test) continue;
      const title = text(
        test.fullName,
        [
          ...(Array.isArray(test.ancestorTitles)
            ? test.ancestorTitles.filter((v): v is string => typeof v === 'string')
            : []),
          text(test.title, 'unnamed'),
        ].join(' '),
      );
      const parsed = outcome(test.status);
      if (!parsed) continue;
      const failureMessages = Array.isArray(test.failureMessages)
        ? test.failureMessages.filter((v): v is string => typeof v === 'string')
        : [];
      results.push(
        makeResult({
          id: `${suiteName}::${title}`,
          name: text(test.title, title),
          suite: suiteName,
          outcome: parsed,
          durationSeconds: duration(test.duration, 'milliseconds'),
          ...(failureMessages.length ? { message: failureMessages.join('\n').slice(0, 2000) } : {}),
        }),
      );
      if (results.length > MAX_TESTS)
        throw new Error('Jest JSON report exceeds the 100000 test limit');
    }
  }
  return results;
}

/** Parse Go test JSON event stream. Only terminal per-test events become samples. */
export function parseGoTestJson(content: string): TestCaseResult[] {
  if (Buffer.byteLength(content, 'utf8') > MAX_JSON_BYTES)
    throw new Error('Go test JSON stream exceeds the 10 MiB parser limit');
  const terminal = new Map<string, TestCaseResult>();
  const outputByTest = new Map<string, string[]>();
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let event: Record<string, unknown> | undefined;
    try {
      event = record(JSON.parse(line) as unknown);
    } catch {
      throw new Error(`Go test JSON stream contains invalid JSON on line ${index + 1}`);
    }
    if (!event) continue;
    const testName = text(event.Test);
    const packageName = text(event.Package, 'go-test');
    if (!testName) continue;
    const id = `${packageName}::${testName}`;
    if (event.Action === 'output') {
      const output = text(event.Output).trim();
      if (output) {
        const list = outputByTest.get(id) ?? [];
        if (list.join('').length < 4000) list.push(output);
        outputByTest.set(id, list);
      }
      continue;
    }
    const parsed =
      event.Action === 'pass'
        ? 'passed'
        : event.Action === 'fail'
          ? 'failed'
          : event.Action === 'skip'
            ? 'skipped'
            : undefined;
    if (!parsed) continue;
    const message = outputByTest.get(id)?.join('\n');
    terminal.set(
      id,
      makeResult({
        id,
        name: testName,
        suite: packageName,
        outcome: parsed,
        durationSeconds: duration(event.Elapsed),
        ...(message ? { message } : {}),
      }),
    );
  }
  return [...terminal.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export interface FailureCluster {
  id: string;
  signature: string;
  occurrences: number;
  affectedTests: string[];
}

export interface SlowTest {
  testId: string;
  name: string;
  suite: string;
  samples: number;
  meanSeconds: number;
  p95Seconds: number;
  maxSeconds: number;
}

export interface TestReliabilityReport {
  summaries: TestHistorySummary[];
  failureClusters: FailureCluster[];
  slowTests: SlowTest[];
  limitations: string[];
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? null;
}

function failureSignature(message: string): string {
  return message
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/(?:[a-z]:)?[^\s:]+\.(?:ts|tsx|js|jsx|py|java|go|rs):\d+(?::\d+)?/g, '<location>')
    .replace(/0x[0-9a-f]+/g, '<address>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

/** Adds failure clustering and duration trends; low-sample histories remain explicitly insufficient. */
export function analyseTestHistory(
  history: readonly TestCaseResult[],
  options: { minSamples?: number; minFlips?: number; slowLimit?: number } = {},
): TestReliabilityReport {
  if (!Array.isArray(history) || history.length > MAX_HISTORY) {
    throw new Error(`FLARE history must contain at most ${MAX_HISTORY} executions`);
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('FLARE analysis options must be an object');
  }
  const minSamples = options.minSamples ?? 8;
  const minFlips = options.minFlips ?? 3;
  const slowLimit = options.slowLimit ?? 20;
  if (!Number.isInteger(minSamples) || minSamples < 2 || minSamples > MAX_HISTORY) {
    throw new Error('minSamples must be an integer between 2 and 100000');
  }
  if (!Number.isInteger(minFlips) || minFlips < 1 || minFlips > MAX_HISTORY) {
    throw new Error('minFlips must be an integer between 1 and 100000');
  }
  if (!Number.isInteger(slowLimit) || slowLimit < 1 || slowLimit > 100) {
    throw new Error('slowLimit must be an integer between 1 and 100');
  }
  for (const item of history) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('FLARE history entries must be objects');
    }
    if (
      typeof item.id !== 'string' || !item.id || item.id.length > 1000 ||
      typeof item.name !== 'string' || item.name.length > 500 ||
      typeof item.suite !== 'string' || item.suite.length > 500 ||
      !['passed', 'failed', 'skipped'].includes(item.outcome) ||
      (item.durationSeconds !== null && (
        typeof item.durationSeconds !== 'number' || !Number.isFinite(item.durationSeconds) ||
        item.durationSeconds < 0 || item.durationSeconds > 1_000_000_000
      )) ||
      (item.message !== undefined && (
        typeof item.message !== 'string' || item.message.length > 10_000
      ))
    ) {
      throw new Error('FLARE history entry fields are invalid or exceed their limits');
    }
  }
  const summaries = summarizeTestHistory(history, { minSamples, minFlips });
  const clusters = new Map<string, { occurrences: number; tests: Set<string> }>();
  const durations = new Map<string, { name: string; suite: string; values: number[] }>();
  for (const result of history) {
    if (result.outcome === 'failed' && result.message?.trim()) {
      const signature = failureSignature(result.message);
      if (signature) {
        const cluster = clusters.get(signature) ?? { occurrences: 0, tests: new Set<string>() };
        cluster.occurrences += 1;
        cluster.tests.add(result.id);
        clusters.set(signature, cluster);
      }
    }
    if (
      result.durationSeconds !== null &&
      Number.isFinite(result.durationSeconds) &&
      result.durationSeconds >= 0
    ) {
      const item = durations.get(result.id) ?? {
        name: result.name,
        suite: result.suite,
        values: [],
      };
      item.values.push(result.durationSeconds);
      durations.set(result.id, item);
    }
  }
  const failureClusters = [...clusters.entries()]
    .map(([signature, value]) => ({
      id: createHash('sha256').update(signature).digest('hex').slice(0, 16),
      signature,
      occurrences: value.occurrences,
      affectedTests: [...value.tests].sort(),
    }))
    .sort((a, b) => b.occurrences - a.occurrences || a.id.localeCompare(b.id));
  const limit = slowLimit;
  const slowTests = [...durations.entries()]
    .map(([testId, item]) => {
      const values = item.values;
      return {
        testId,
        name: item.name,
        suite: item.suite,
        samples: values.length,
        meanSeconds:
          Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10000) /
          10000,
        p95Seconds: Math.round((percentile(values, 0.95) ?? 0) * 10000) / 10000,
        maxSeconds: values.reduce((maximum, value) => Math.max(maximum, value), Number.NEGATIVE_INFINITY),
      };
    })
    .sort((a, b) => b.p95Seconds - a.p95Seconds || a.testId.localeCompare(b.testId))
    .slice(0, limit);
  return {
    summaries,
    failureClusters,
    slowTests,
    limitations: [
      'Flakiness classifications require repeated ordered executions and are statistical signals, not proof of root cause.',
      'Failure clusters use normalized text signatures; similar-looking failures may differ in cause, and different messages may share a cause.',
      'Duration rankings are computed only from durations included in supplied reports; they are not adjusted for machine or runner differences.',
    ],
  };
}
