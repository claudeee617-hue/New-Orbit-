import { XmlError, parseXml, type XmlElement } from './xml.js';
import { OrbitError } from '@orbit/shared';
export interface TestCaseResult {
  id: string;
  name: string;
  suite: string;
  outcome: 'passed' | 'failed' | 'skipped';
  durationSeconds: number | null;
  message?: string;
}

export interface TestHistorySummary {
  testId: string;
  suite: string;
  name: string;
  samples: number;
  passed: number;
  failed: number;
  skipped: number;
  failureRate: number;
  flipCount: number;
  wilson95: { lower: number; upper: number };
  classification: 'insufficient-data' | 'stable-pass' | 'stable-fail' | 'suspected-flaky';
}

const MAX_XML_BYTES = 10 * 1024 * 1024;
const MAX_TEST_CASES = 100_000;

function wilson(successes: number, samples: number): { lower: number; upper: number } {
  if (samples === 0) return { lower: 0, upper: 1 };
  const z = 1.96;
  const p = successes / samples;
  const denominator = 1 + (z * z) / samples;
  const centre = p + (z * z) / (2 * samples);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * samples)) / samples);
  return {
    lower: Math.max(0, (centre - margin) / denominator),
    upper: Math.min(1, (centre + margin) / denominator),
  };
}

/** Summarise ordered historical outcomes. At least eight executions and three flips are required to flag suspicion. */
export function summarizeTestHistory(
  history: readonly TestCaseResult[],
  options: { minSamples?: number; minFlips?: number } = {},
): TestHistorySummary[] {
  if (!Array.isArray(history) || history.length > MAX_TEST_CASES) {
    throw new Error('FLARE history must contain at most 100000 executions');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('FLARE summary options must be an object');
  }
  const minSamples = options.minSamples ?? 8;
  const minFlips = options.minFlips ?? 3;
  if (!Number.isInteger(minSamples) || minSamples < 2 || minSamples > MAX_TEST_CASES) {
    throw new Error('minSamples must be an integer between 2 and 100000');
  }
  if (!Number.isInteger(minFlips) || minFlips < 1 || minFlips > MAX_TEST_CASES) {
    throw new Error('minFlips must be an integer between 1 and 100000');
  }
  for (const item of history) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      !item.id ||
      item.id.length > 1000 ||
      typeof item.name !== 'string' ||
      item.name.length > 500 ||
      typeof item.suite !== 'string' ||
      item.suite.length > 500 ||
      !['passed', 'failed', 'skipped'].includes(item.outcome) ||
      (item.durationSeconds !== null &&
        (typeof item.durationSeconds !== 'number' ||
          !Number.isFinite(item.durationSeconds) ||
          item.durationSeconds < 0 ||
          item.durationSeconds > 1_000_000_000)) ||
      (item.message !== undefined &&
        (typeof item.message !== 'string' || item.message.length > 10_000))
    ) {
      throw new Error('FLARE history entry fields are invalid or exceed their limits');
    }
  }
  const groups = new Map<string, TestCaseResult[]>();
  for (const result of history) {
    const list = groups.get(result.id) ?? [];
    list.push(result);
    groups.set(result.id, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, items]) => {
      const executed = items.filter((item) => item.outcome !== 'skipped');
      let flips = 0;
      for (let i = 1; i < executed.length; i += 1) {
        if (executed[i]!.outcome !== executed[i - 1]!.outcome) flips += 1;
      }
      const passed = executed.filter((item) => item.outcome === 'passed').length;
      const failed = executed.filter((item) => item.outcome === 'failed').length;
      const skipped = items.length - executed.length;
      const failureRate = executed.length ? failed / executed.length : 0;
      let classification: TestHistorySummary['classification'];
      if (executed.length < minSamples) classification = 'insufficient-data';
      else if (failed === 0) classification = 'stable-pass';
      else if (passed === 0) classification = 'stable-fail';
      else if (flips >= minFlips) classification = 'suspected-flaky';
      else classification = 'insufficient-data';
      return {
        testId: id,
        suite: items[0]!.suite,
        name: items[0]!.name,
        samples: executed.length,
        passed,
        failed,
        skipped,
        failureRate: Math.round(failureRate * 10000) / 10000,
        flipCount: flips,
        wilson95: wilson(failed, executed.length),
        classification,
      };
    });
}

/** Safe subset parser for JUnit XML. DTD and entity declarations are rejected. */
export function parseJunitXml(xml: string): TestCaseResult[] {
  if (typeof xml !== 'string') throw new OrbitError('INVALID_INPUT', 'JUnit input must be text');
  if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES)
    throw new OrbitError('INVALID_INPUT', 'JUnit XML exceeds the 10 MiB parser limit');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new OrbitError('INVALID_INPUT', 'JUnit XML DTD/entity declarations are not supported');
  const results: TestCaseResult[] = [];
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (error) {
    if (error instanceof XmlError)
      throw new OrbitError('INVALID_INPUT', `JUnit XML is not well-formed: ${error.message}`);
    throw error;
  }
  if (root.name !== 'testsuites' && root.name !== 'testsuite')
    throw new OrbitError(
      'INVALID_INPUT',
      `JUnit XML root must be <testsuites> or <testsuite>, found <${root.name}>`,
    );
  const visit = (element: XmlElement, suiteName: string): void => {
    for (const child of element.children) {
      if (child.name === 'testsuite') {
        visit(child, child.attrs['name'] ?? suiteName);
        continue;
      }
      if (child.name !== 'testcase') {
        visit(child, suiteName);
        continue;
      }
      const attrs = child.attrs;
      const name = attrs['name'] ?? 'unnamed';
      const className = attrs['classname'] ?? suiteName;
      const failure = child.children.find((c) => c.name === 'failure' || c.name === 'error');
      const skipped = child.children.some((c) => c.name === 'skipped');
      const outcome: TestCaseResult['outcome'] = skipped
        ? 'skipped'
        : failure
          ? 'failed'
          : 'passed';
      const message = failure
        ? (failure.attrs['message'] ?? failure.text).trim().slice(0, 2000)
        : undefined;
      if (results.length >= MAX_TEST_CASES) {
        throw new OrbitError('INVALID_INPUT', 'JUnit XML exceeds the 100000 test-case limit');
      }
      results.push({
        id: `${className}::${name}`,
        name,
        suite: className,
        outcome,
        durationSeconds:
          attrs['time'] !== undefined && Number.isFinite(Number(attrs['time']))
            ? Number(attrs['time'])
            : null,
        ...(message && { message }),
      });
    }
  };
  visit(root, root.attrs['name'] ?? 'default');
  return results;
}
