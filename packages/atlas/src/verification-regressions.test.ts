import { describe, expect, it } from 'vitest';
import { parseCobertura, parseUnifiedDiff } from './verification.js';

describe('unified diff parsing keeps line numbers exact', () => {
  it('counts added lines that begin with "++" and does not shift later lines', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,2 +1,4 @@',
      '+++counter;',
      '+b();',
      ' keep',
      '+c();',
    ].join('\n');
    expect(parseUnifiedDiff(diff)[0]?.addedLines).toEqual([1, 2, 4]);
  });

  it('does not treat removed lines that look like headers as headers', () => {
    const diff = [
      'diff --git a/y.ts b/y.ts',
      '--- a/y.ts',
      '+++ b/y.ts',
      '@@ -1,3 +1,2 @@',
      '--- a/not-a-header',
      ' keep',
      '+new',
      'diff --git a/z.ts b/z.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/z.ts',
      '@@ -0,0 +1 @@',
      '+z',
    ].join('\n');
    const files = parseUnifiedDiff(diff);
    expect(files.map((f) => [f.path, f.status, f.addedLines])).toEqual([
      ['y.ts', 'modified', [2]],
      ['z.ts', 'added', [1]],
    ]);
  });

  it('survives "No newline" markers, truncation and lying headers', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1,5 @@',
      '+one',
      '\\ No newline at end of file',
      '+two',
    ].join('\n');
    expect(parseUnifiedDiff(diff)[0]?.addedLines).toEqual([1, 2]);
    expect(() => parseUnifiedDiff('@@ -1 +1 @@\n+x')).not.toThrow();
  });
});

describe('Cobertura parsing', () => {
  it('does not let a self-closing <class/> swallow the next class', () => {
    const xml =
      '<coverage><packages><package><classes><class name="E" filename="e.ts"/><class name="F" filename="f.ts"><lines><line number="1" hits="1"/></lines></class></classes></package></packages></coverage>';
    const files = parseCobertura(xml).map((f) => [f.path, [...f.lines]]);
    expect(files).toEqual([['f.ts', [[1, 1]]]]);
  });

  it('accepts ">" inside attribute values', () => {
    const xml =
      '<coverage><class name="a&gt;b" filename="s.ts" tag="x>y"><lines><line number="2" hits="0"/></lines></class></coverage>';
    expect(parseCobertura(xml).map((f) => [f.path, [...f.lines]])).toEqual([['s.ts', [[2, 0]]]]);
  });
});

import { parseJunitXml } from './flare.js';

describe('XML report parsing does not invent or lose test cases', () => {
  const suite = (body: string) => `<testsuite name="s">${body}</testsuite>`;
  it('handles ">" in attributes', () => {
    const [c] = parseJunitXml(
      suite('<testcase classname="c" name="a>b"><failure message="m"/></testcase>'),
    );
    expect(c).toMatchObject({ name: 'a>b', suite: 'c', outcome: 'failed', message: 'm' });
  });
  it('ignores tags inside CDATA and comments', () => {
    const cases = parseJunitXml(
      suite(
        '<!-- <testcase name="ghost"><failure/></testcase> -->' +
          '<testcase classname="c" name="a"><failure><![CDATA[</testcase><testcase name="zz"/>]]></failure></testcase>' +
          '<testcase classname="c" name="real"/>',
      ),
    );
    expect(cases.map((c) => `${c.name}:${c.outcome}`)).toEqual(['a:failed', 'real:passed']);
    expect(cases[0]?.message).toContain('</testcase>');
  });
  it('walks nested suites and keeps the nearest suite name', () => {
    const cases = parseJunitXml(
      '<testsuites><testsuite name="outer"><testsuite name="inner"><testcase name="a"/></testsuite><testcase name="b"/></testsuite></testsuites>',
    );
    expect(cases.map((c) => [c.suite, c.name])).toEqual([
      ['inner', 'a'],
      ['outer', 'b'],
    ]);
  });
  it('rejects malformed or wrong-root XML instead of returning nothing', () => {
    expect(() => parseJunitXml('')).toThrow(/not well-formed|no root/);
    expect(() => parseJunitXml('<testsuite><testcase name="a">')).toThrow(/not well-formed/);
    expect(() => parseJunitXml('<html/>')).toThrow(/root/);
    expect(() => parseCobertura('<coverage><class filename="a.ts">')).toThrow(/not well-formed/);
  });
});

import { parseTelemetry, parseTelemetryTimestamp } from './index.js';

describe('telemetry timestamps are never invented', () => {
  it.each([
    ['2026-11-08T10:00:00Z', '2026-11-08T10:00:00.000Z'],
    ['2026-11-08T10:00:00+05:30', '2026-11-08T04:30:00.000Z'],
    ['2026-11-08 10:00:00', '2026-11-08T10:00:00.000Z'],
    ['2026-11-08', '2026-11-08T00:00:00.000Z'],
    [1_762_596_000, '2025-11-08T10:00:00.000Z'],
    [1_762_596_000_000, '2025-11-08T10:00:00.000Z'],
    ['1762596000', '2025-11-08T10:00:00.000Z'],
  ])('reads %s', (input, expected) => {
    expect(parseTelemetryTimestamp(input)).toBe(expected);
  });

  it.each([
    1,
    42,
    0,
    -5,
    '1',
    '7',
    'tomorrow',
    'Jan 5',
    '2026-13-45T99:99:99Z',
    null,
    {},
    1e20,
    Number.NaN,
  ])('does not turn %s into a date', (input) => {
    expect(parseTelemetryTimestamp(input)).toBeNull();
  });

  it('keeps uptime-style CSV rows timestamp-less and deterministic', () => {
    const session = parseTelemetry('time,temp\n1,20\n2,21', 'csv');
    expect(session.points.map((p) => p.timestamp)).toEqual([null, null]);
    expect(session.points.map((p) => p.metrics['temp'])).toEqual([20, 21]);
  });
});
