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

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(pattern)) {
    result[match[1]!] = (match[2] ?? match[3] ?? '')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }
  return result;
}

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
  const minSamples = options.minSamples ?? 8;
  const minFlips = options.minFlips ?? 3;
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
  if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES)
    throw new Error('JUnit XML exceeds the 10 MiB parser limit');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('JUnit XML DTD/entity declarations are not supported');
  const results: TestCaseResult[] = [];
  const suites = [...xml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/gi)];
  const regions = suites.length
    ? suites.map((match) => ({ attrs: attributes(match[1] ?? ''), body: match[2] ?? '' }))
    : [{ attrs: {}, body: xml }];
  for (const region of regions) {
    const suite = region.attrs.name ?? 'default';
    const cases = region.body.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/gi);
    for (const match of cases) {
      const attrs = attributes(match[1] ?? '');
      const body = match[2] ?? '';
      const name = attrs.name ?? 'unnamed';
      const className = attrs.classname ?? suite;
      const failure = /<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/i.exec(body);
      const skipped = /<skipped\b/i.test(body);
      const outcome: TestCaseResult['outcome'] = skipped
        ? 'skipped'
        : failure
          ? 'failed'
          : 'passed';
      const messageAttrs = failure ? attributes(failure[2] ?? '') : {};
      const message = failure
        ? (messageAttrs.message ?? failure[3] ?? '').replace(/<[^>]*>/g, '').slice(0, 2000)
        : undefined;
      results.push({
        id: `${className}::${name}`,
        name,
        suite: className,
        outcome,
        durationSeconds:
          attrs.time !== undefined && Number.isFinite(Number(attrs.time))
            ? Number(attrs.time)
            : null,
        ...(message && { message }),
      });
    }
  }
  return results;
}
