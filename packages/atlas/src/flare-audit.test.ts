import { describe, expect, it } from 'vitest';
import {
  analyseTestHistory,
  failureSignature,
  parseGoTestJson,
  parseJestJsonReport,
  parsePytestJsonReport,
} from './flare-extended.js';
import { parseJunitXml, summarizeTestHistory } from './flare.js';

/** Regression tests for findings of the manual FLARE audit (docs/audits/FLARE.md). */
describe('FL-1 durations are sanitised at parse time', () => {
  it('JUnit negative, absurd, blank and non-numeric times become null and stay analysable', () => {
    const xml = `<testsuite name="s">
      <testcase classname="a" name="neg" time="-3"/>
      <testcase classname="a" name="huge" time="1e12"/>
      <testcase classname="a" name="blank" time=" "/>
      <testcase classname="a" name="text" time="abc"/>
      <testcase classname="a" name="ok" time="0.25"/></testsuite>`;
    const results = parseJunitXml(xml);
    expect(results.map((r) => r.durationSeconds)).toEqual([null, null, null, null, 0.25]);
    expect(() => analyseTestHistory(results)).not.toThrow();
  });

  it('pytest, Jest and Go durations outside the accepted range become null', () => {
    const pytest = parsePytestJsonReport(
      JSON.stringify({ tests: [{ nodeid: 'a.py::t', outcome: 'passed', duration: 1e12 }] }),
    );
    const jest = parseJestJsonReport(
      JSON.stringify({
        testResults: [
          { name: 's', assertionResults: [{ title: 't', status: 'passed', duration: 1e18 }] },
        ],
      }),
    );
    const go = parseGoTestJson('{"Action":"pass","Package":"p","Test":"T","Elapsed":1e12}\n');
    for (const r of [...pytest, ...jest, ...go]) expect(r.durationSeconds).toBeNull();
    expect(() => analyseTestHistory([...pytest, ...jest, ...go])).not.toThrow();
  });
});

describe('FL-5 failure signatures are computed in linear time', () => {
  it('handles long dot-free tokens quickly (was quadratic)', () => {
    const started = performance.now();
    for (let i = 0; i < 200; i++) failureSignature('A'.repeat(4000));
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('keeps masking URLs, locations, addresses and numbers', () => {
    const sig = failureSignature(
      'Error at src/app/main.ts:12:5 and C:\\work\\x.py:7 see https://ex.com/a.ts:3 ptr 0xDEADBEEF count 42',
    );
    expect(sig).toBe('error at <location> and <location> see <url> ptr <address> count <n>');
  });

  it('masks drive-letter paths and dotted file names the same way across runs', () => {
    expect(failureSignature('boom (/a/b/c.test.js:10:2)')).toBe('boom <location>)');
    expect(failureSignature('boom (/x/y/c.test.js:99:7)')).toBe(
      failureSignature('boom (/a/b/c.test.js:10:2)'),
    );
  });

  it('does not treat a bare extension as a location', () => {
    expect(failureSignature('see .ts:3 now')).toBe('see .ts:<n> now');
  });
});

describe('FL-6 pytest outcome precedence', () => {
  const run = (test: object): string | undefined =>
    parsePytestJsonReport(JSON.stringify({ tests: [{ nodeid: 'a.py::t', ...test }] }))[0]?.outcome;

  it('a skipped test whose teardown passed is skipped, not passed', () => {
    expect(
      run({ outcome: 'skipped', setup: { outcome: 'skipped' }, teardown: { outcome: 'passed' } }),
    ).toBe('skipped');
  });
  it('pytest.skip inside the body is skipped', () => {
    expect(
      run({
        setup: { outcome: 'passed' },
        call: { outcome: 'skipped' },
        teardown: { outcome: 'passed' },
      }),
    ).toBe('skipped');
  });
  it('a failing teardown fails the test even if the call passed', () => {
    expect(
      run({
        setup: { outcome: 'passed' },
        call: { outcome: 'passed' },
        teardown: { outcome: 'failed' },
      }),
    ).toBe('failed');
  });
  it('all phases passing is a pass', () => {
    expect(
      run({
        setup: { outcome: 'passed' },
        call: { outcome: 'passed' },
        teardown: { outcome: 'passed' },
      }),
    ).toBe('passed');
  });
  it('xfailed is not a reliability signal; xpassed is a pass', () => {
    expect(run({ outcome: 'xfailed' })).toBe('skipped');
    expect(run({ outcome: 'xpassed' })).toBe('passed');
  });
});

describe('FL-10 pytest parametrised ids', () => {
  it('does not split on :: inside parameter brackets', () => {
    const [r] = parsePytestJsonReport(
      JSON.stringify({
        tests: [{ nodeid: 'tests/a.py::TestX::test_y[a::b-1]', outcome: 'passed' }],
      }),
    );
    expect(r?.suite).toBe('tests/a.py::TestX');
    expect(r?.name).toBe('test_y[a::b-1]');
    expect(r?.id).toBe('tests/a.py::TestX::test_y[a::b-1]');
  });
});

describe('Go and Jest details', () => {
  it('Go output is attached to failures only', () => {
    const stream = [
      '{"Action":"output","Package":"p","Test":"A","Output":"noise\\n"}',
      '{"Action":"pass","Package":"p","Test":"A","Elapsed":0.1}',
      '{"Action":"output","Package":"p","Test":"B","Output":"boom\\n"}',
      '{"Action":"fail","Package":"p","Test":"B","Elapsed":0.1}',
    ].join('\n');
    const [a, b] = parseGoTestJson(stream);
    expect(a?.message).toBeUndefined();
    expect(b?.message).toBe('boom');
  });

  it('a Go test with no terminal event (timeout/panic) is not recorded as a pass', () => {
    const stream =
      '{"Action":"run","Package":"p","Test":"Hangs"}\n{"Action":"output","Package":"p","Test":"Hangs","Output":"x"}\n';
    expect(parseGoTestJson(stream)).toEqual([]);
  });

  it('Jest disabled tests are skipped', () => {
    const [r] = parseJestJsonReport(
      JSON.stringify({
        testResults: [{ name: 's', assertionResults: [{ title: 't', status: 'disabled' }] }],
      }),
    );
    expect(r?.outcome).toBe('skipped');
  });
});

describe('FL-2/FL-4 documented classification behaviour', () => {
  const mk = (outcomes: Array<'passed' | 'failed'>) =>
    outcomes.map((outcome, i) => ({
      id: 't',
      name: 't',
      suite: 's',
      outcome,
      durationSeconds: i / 10,
    }));

  it('an alternating history is flagged suspected-flaky', () => {
    const [s] = summarizeTestHistory(
      mk(['passed', 'failed', 'passed', 'failed', 'passed', 'failed', 'passed', 'failed']),
    );
    expect(s?.classification).toBe('suspected-flaky');
  });

  it('a clean regression (pass...pass, fail...fail) is never called flaky', () => {
    const [s] = summarizeTestHistory(
      mk(['passed', 'passed', 'passed', 'passed', 'failed', 'failed', 'failed', 'failed']),
    );
    expect(s?.flipCount).toBe(1);
    expect(s?.classification).toBe('insufficient-data');
  });

  it('input order is treated as chronological: callers must supply runs in time order', () => {
    const chronological = mk([
      'passed',
      'passed',
      'passed',
      'passed',
      'failed',
      'failed',
      'failed',
      'failed',
    ]);
    const shuffled = mk([
      'passed',
      'failed',
      'passed',
      'failed',
      'passed',
      'failed',
      'passed',
      'failed',
    ]);
    expect(summarizeTestHistory(chronological)[0]?.classification).not.toBe('suspected-flaky');
    expect(summarizeTestHistory(shuffled)[0]?.classification).toBe('suspected-flaky');
  });

  it('duplicate ids inside one JUnit report stay separate samples (no silent merge)', () => {
    const xml = `<testsuite><testcase classname="a" name="p"/><testcase classname="a" name="p"><failure message="x"/></testcase></testsuite>`;
    const r = parseJunitXml(xml);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.id)).toEqual(['a::p', 'a::p']);
  });
});
