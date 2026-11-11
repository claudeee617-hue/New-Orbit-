import { describe, expect, it } from 'vitest';
import {
  changedLineCoverage,
  matchCoverage,
  parseCobertura,
  parseCoverage,
  parseLcov,
} from './coverage.js';
import { parseHunks, parseRawZ } from './diff.js';
import { parseJUnit, summarizeTests } from './junit.js';
import { detectSensitive } from './sensitive.js';
import { parseXml, XmlError } from '@orbit/atlas';

const LCOV = `TN:
SF:/work/repo/src/a.ts
FN:1,a
DA:1,2
DA:2,0
DA:4,5
LF:3
LH:2
end_of_record
SF:src/b.ts
DA:1,0
end_of_record
`;

describe('LCOV parser', () => {
  it('reads line hits and strips the checkout prefix', () => {
    const { data, problems } = parseLcov(LCOV, '/work/repo');
    expect(problems).toEqual([]);
    expect(data?.files.map((f) => f.keys[0])).toEqual(['src/a.ts', 'src/b.ts']);
    expect([...(data?.files[0]?.lines ?? [])]).toEqual([
      [1, 2],
      [2, 0],
      [4, 5],
    ]);
  });

  it.each([
    ['empty input', ''],
    ['garbage', 'hello world\nthis is not coverage'],
    ['binary-ish', '\u0000\u0001\u0002'],
  ])('rejects %s', (_n, text) => {
    expect(parseCoverage(text).data).toBeUndefined();
    expect(parseCoverage(text).problems.length).toBeGreaterThan(0);
  });

  it('reports truncation, bad DA records and orphan records as problems', () => {
    const truncated = parseLcov('SF:a.ts\nDA:1,1\nDA:2,1');
    expect(truncated.data?.files).toHaveLength(1);
    expect(truncated.problems.join('\n')).toMatch(/truncated/);
    const bad = parseLcov(
      'SF:a.ts\nDA:x,1\nDA:3\nDA:-1,2\nDA:4,1.5\nend_of_record\nDA:9,1\nend_of_record\n',
    );
    expect(bad.problems.length).toBeGreaterThanOrEqual(5);
    expect(bad.data?.files[0]?.lines.size).toBe(0);
  });

  it('sums duplicate DA records for the same line', () => {
    const { data } = parseLcov('SF:a.ts\nDA:1,1\nDA:1,2\nend_of_record\n');
    expect(data?.files[0]?.lines.get(1)).toBe(3);
  });

  it('tolerates CRLF line endings', () => {
    expect(parseLcov(LCOV.replace(/\n/g, '\r\n')).problems).toEqual([]);
  });
});

const COBERTURA = `<?xml version="1.0"?>
<coverage line-rate="0.5">
  <sources><source>/work/repo</source></sources>
  <packages><package name="p"><classes>
    <class name="A" filename="src/a.ts"><lines>
      <line number="1" hits="3"/><line number="2" hits="0"/>
    </lines></class>
    <class name="A$inner" filename="src/a.ts"><lines><line number="2" hits="0"/></lines></class>
  </classes></package></packages>
</coverage>`;

describe('Cobertura parser', () => {
  it('reads classes, merges classes of the same file', () => {
    const { data, problems } = parseCobertura(COBERTURA, '/work/repo');
    expect(problems).toEqual([]);
    expect(data?.files).toHaveLength(1);
    expect([...(data?.files[0]?.lines ?? [])]).toEqual([
      [1, 3],
      [2, 0],
    ]);
    expect(parseCoverage(COBERTURA).data?.format).toBe('cobertura');
  });

  it.each([
    ['not xml', '<coverage><packages>'],
    ['wrong root', '<report></report>'],
    ['no classes', '<coverage></coverage>'],
    ['mismatched tags', '<coverage><a></b></coverage>'],
    ['doctype', '<!DOCTYPE coverage [<!ENTITY x "y">]><coverage/>'],
  ])('rejects %s', (_n, text) => {
    const r = parseCobertura(text);
    expect(r.data).toBeUndefined();
    expect(r.problems.length).toBeGreaterThan(0);
  });

  it('flags malformed line elements but keeps the rest', () => {
    const r = parseCobertura(
      '<coverage><class filename="a.ts"><lines><line number="1" hits="1"/><line number="x" hits="1"/></lines></class></coverage>',
    );
    expect(r.data?.files[0]?.lines.size).toBe(1);
    expect(r.problems).toHaveLength(1);
  });
});

describe('XML reader', () => {
  it('decodes entities without expanding custom ones', () => {
    const el = parseXml('<a x="1 &amp; 2 &lt; &#65;"/>');
    expect(el.attrs['x']).toBe('1 & 2 < A');
  });
  it('refuses runaway nesting', () => {
    expect(() => parseXml('<a>'.repeat(500) + '</a>'.repeat(500))).toThrow(XmlError);
  });
});

describe('JUnit parser', () => {
  const XML = `<testsuites><testsuite name="s">
    <testcase classname="c" name="ok"/>
    <testcase classname="c" name="bad"><failure message="boom"/></testcase>
    <testcase classname="c" name="err"><error message="crash"/></testcase>
    <testcase classname="c" name="skip"><skipped/></testcase>
    <testcase classname="c" name="ok"/>
  </testsuite></testsuites>`;
  it('classifies results and de-duplicates ids', () => {
    const { report, problems } = parseJUnit(XML);
    expect(problems).toEqual([]);
    expect(summarizeTests(report!)).toEqual({
      total: 5,
      passed: 2,
      failed: 1,
      errored: 1,
      skipped: 1,
    });
    expect(report!.cases.map((c) => c.id)).toContain('c::ok#2');
  });
  it.each([
    ['empty', ''],
    ['not xml', 'nope'],
    ['wrong root', '<html></html>'],
    ['no cases', '<testsuite></testsuite>'],
    ['truncated', '<testsuite><testcase name="a">'],
  ])('rejects %s', (_n, text) => {
    const r = parseJUnit(text);
    expect(r.report).toBeUndefined();
    expect(r.problems.length).toBeGreaterThan(0);
  });
  it('notes nameless test cases', () => {
    const r = parseJUnit('<testsuite><testcase/><testcase name="a"/></testsuite>');
    expect(r.report?.cases).toHaveLength(1);
    expect(r.problems).toHaveLength(1);
  });
});

describe('diff hunks', () => {
  it('parses added, modified and deleted-only hunks', () => {
    const h = parseHunks(
      [
        'diff --git a/x b/x',
        '@@ -3,0 +4,2 @@',
        '+a',
        '+b',
        '@@ -10 +12 @@',
        '-x',
        '+y',
        '@@ -20,3 +21,0 @@',
        '-1',
        '-2',
        '-3',
      ].join('\n'),
    );
    expect(h).toHaveLength(3);
    expect(h[0]).toMatchObject({ addedLines: { start: 4, end: 5 }, modifiedExisting: false });
    expect(h[1]).toMatchObject({ addedLines: { start: 12, end: 12 }, modifiedExisting: true });
    expect(h[2]).toMatchObject({ addedLines: undefined, deletedAfterLine: 21, removedCount: 3 });
  });
  it('ignores garbage', () => {
    expect(parseHunks('@@ nonsense @@\nrandom\n')).toEqual([]);
  });
  it('parses raw -z output incl. renames', () => {
    const raw =
      ':100644 100644 a b M\0src/a.ts\0:100644 100644 a b R087\0old.ts\0new.ts\0:000000 100644 0 b A\0n.ts\0';
    expect(parseRawZ(raw)).toEqual([
      { status: 'M', path: 'src/a.ts', oldPath: undefined },
      { status: 'R', path: 'new.ts', oldPath: 'old.ts' },
      { status: 'A', path: 'n.ts', oldPath: undefined },
    ]);
    expect(parseRawZ('garbage\0more')).toEqual([]);
  });
});

describe('changed-line coverage', () => {
  const data = parseLcov(
    'SF:src/a.ts\nDA:1,1\nDA:2,0\nend_of_record\nSF:lib/index.ts\nDA:1,1\nend_of_record\nSF:other/index.ts\nDA:1,1\nend_of_record\n',
  ).data!;
  it('classifies each line; never infers from other lines', () => {
    const m = matchCoverage(['src/a.ts'], data).get('src/a.ts');
    const c = changedLineCoverage('src/a.ts', [1, 2, 3], m);
    expect(c).toMatchObject({
      covered: [1],
      uncovered: [2],
      nonExecutable: [3],
      status: 'PARTIAL',
    });
  });
  it('reports NOT_MEASURED when the file has no entry', () => {
    const m = matchCoverage(['src/zzz.ts'], data).get('src/zzz.ts');
    expect(changedLineCoverage('src/zzz.ts', [1], m).status).toBe('NOT_MEASURED');
  });
  it('treats ambiguous suffix matches as unmeasured', () => {
    const two = parseLcov(
      'SF:a/x/index.ts\nDA:1,1\nend_of_record\nSF:b/x/index.ts\nDA:1,1\nend_of_record\n',
    ).data!;
    const m = matchCoverage(['x/index.ts'], two).get('x/index.ts');
    expect(m?.file).toBeUndefined();
    expect(m?.note).toMatch(/ambiguous/);
  });
  it('accepts a unique suffix match and says so', () => {
    const m = matchCoverage(['pkg/lib/index.ts'], data).get('pkg/lib/index.ts');
    expect(m?.file?.reportedPath).toBe('lib/index.ts');
    expect(m?.note).toMatch(/suffix/);
  });
  it('does not let one coverage entry serve two changed files', () => {
    const d = parseLcov('SF:index.ts\nDA:1,1\nend_of_record\n').data!;
    const r = matchCoverage(['a/index.ts', 'b/index.ts'], d);
    expect(r.get('a/index.ts')?.file).toBeUndefined();
    expect(r.get('b/index.ts')?.file).toBeUndefined();
  });
  it('NOT_MEASURED when no changed line is instrumented', () => {
    const m = matchCoverage(['src/a.ts'], data).get('src/a.ts');
    expect(changedLineCoverage('src/a.ts', [9], m).status).toBe('NOT_MEASURED');
  });
});

describe('sensitive files', () => {
  it.each([
    ['.env', 'secret'],
    ['config/.env.production', 'secret'],
    ['keys/server.pem', 'secret'],
    ['.github/workflows/ci.yml', 'ci-workflow'],
    ['package.json', 'dependency-manifest'],
    ['pnpm-lock.yaml', 'lockfile'],
    ['Dockerfile', 'container'],
    ['src/auth/login.ts', 'auth-security'],
    ['db/migrations/001.sql', 'database-migration'],
    ['infra/main.tf', 'infrastructure'],
  ])('flags %s as %s', (path, category) => {
    expect(detectSensitive(path).map((m) => m.category)).toContain(category);
  });
  it.each(['src/math.ts', '.env.example', 'README.md', 'src/author.ts'])('ignores %s', (path) => {
    expect(detectSensitive(path)).toEqual([]);
  });
});
