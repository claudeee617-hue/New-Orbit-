import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyChange } from './verify.js';

/**
 * Controlled scenarios S1, S2, S3, S9, S10 from docs/TEST_STRATEGY.md section 4, run through the
 * real `verifyChange` on a real Git repository. Coverage and test reports are hand-written inputs
 * (parser fixtures), not output of a real test run.
 */
const parent = mkdtempSync(join(tmpdir(), 'orbit-scenarios-'));
afterAll(() => rmSync(parent, { recursive: true, force: true }));

const BASE = 'export function a(): number {\n  return 1;\n}\n';
const HEAD = `${BASE}export function b(x: number): number {\n  if (x > 0) {\n    return x;\n  }\n  return 0;\n}\n`;
const TEST_FILE = "import { b } from './calc';\nb(1);\n";

function git(root: string, args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
    },
  ).trim();
}

let counter = 0;
function repo(): { root: string; inputs: string; base: string } {
  const dir = join(parent, `r${counter++}`);
  const root = join(dir, 'repo');
  const inputs = join(dir, 'in');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(inputs, { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'src/calc.ts'), BASE);
  writeFileSync(join(root, 'src/calc.test.ts'), TEST_FILE);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'src/calc.ts'), HEAD);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'head']);
  return { root, inputs, base };
}

const lcov = (hits: Record<number, number>): string =>
  `TN:\nSF:src/calc.ts\n${Object.entries(hits)
    .map(([line, n]) => `DA:${line},${n}`)
    .join('\n')}\nend_of_record\n`;
const ALL_HIT = lcov({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1 });
const PASSING =
  '<testsuites><testsuite name="calc"><testcase classname="calc" name="b"/></testsuite></testsuites>';

function write(dir: string, name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe('S1 clean change, fully covered, tests pass', () => {
  it('reports coverage PASS and no high findings', async () => {
    const r = repo();
    const report = await verifyChange({
      rootPath: r.root,
      base: r.base,
      head: 'HEAD',
      coverage: [write(r.inputs, 'c.info', ALL_HIT)],
      testReport: [write(r.inputs, 't.xml', PASSING)],
      buildResult: write(r.inputs, 'b.json', '{"status":"success"}'),
    });
    expect(report.files.find((f) => f.path === 'src/calc.ts')?.coverage?.status).toBe('PASS');
    expect(report.findings.filter((f) => f.severity === 'high')).toEqual([]);
  });
});

describe('S2 uncovered changed lines', () => {
  it('is PARTIAL and lists the exact uncovered lines', async () => {
    const r = repo();
    const report = await verifyChange({
      rootPath: r.root,
      base: r.base,
      head: 'HEAD',
      coverage: [
        write(r.inputs, 'c.info', lcov({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 0, 7: 0, 8: 1 })),
      ],
    });
    const file = report.files.find((f) => f.path === 'src/calc.ts')!;
    expect(file.coverage?.status).toBe('PARTIAL');
    expect(file.coverage?.uncovered).toEqual([6, 7]);
    const finding = report.findings.find((f) => f.rule === 'UNCOVERED-LINES');
    expect(finding?.location).toMatchObject({ path: 'src/calc.ts', startLine: 6, endLine: 7 });
    expect(finding?.title).toContain('src/calc.ts:6-7');
  });
});

describe('S3 coverage regression versus base', () => {
  it('raises a regression finding carrying before and after', async () => {
    const r = repo();
    const report = await verifyChange({
      rootPath: r.root,
      base: r.base,
      head: 'HEAD',
      baseCoverage: [write(r.inputs, 'base.info', lcov({ 1: 1, 2: 1, 3: 1 }))],
      coverage: [write(r.inputs, 'c.info', lcov({ 1: 0, 2: 0, 3: 1, 5: 1, 6: 0 }))],
    });
    const finding = report.findings.find((f) => f.rule === 'COVERAGE-REGRESSION');
    expect(finding).toBeDefined();
    expect(JSON.stringify(finding)).toMatch(/100/);
  });
});

describe('S9 malformed or missing coverage file', () => {
  it('is never reported as 0% or PASS when the file is garbage', async () => {
    const r = repo();
    const report = await verifyChange({
      rootPath: r.root,
      base: r.base,
      head: 'HEAD',
      coverage: [write(r.inputs, 'bad.info', '\u0000\u0001 not coverage at all')],
    });
    const file = report.files.find((f) => f.path === 'src/calc.ts')!;
    expect(['INCOMPLETE', 'NOT_MEASURED']).toContain(file.coverage?.status);
    expect(
      report.findings.some((f) => /COVERAGE-(MALFORMED|NOT-MEASURED)|NO-COVERAGE/.test(f.rule)),
    ).toBe(true);
  });

  it('rejects a coverage path that does not exist with a safe error', async () => {
    const r = repo();
    await expect(
      verifyChange({
        rootPath: r.root,
        base: r.base,
        head: 'HEAD',
        coverage: [join(r.inputs, 'missing.info')],
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('S10 malicious report', () => {
  it('rejects an XXE/DOCTYPE JUnit report without expanding entities', async () => {
    const r = repo();
    const secret = write(r.inputs, 'secret.txt', 'TOP-SECRET-CONTENT');
    const xxe = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file://${secret}">]><testsuites><testsuite name="&e;"><testcase name="&e;"/></testsuite></testsuites>`;
    const report = await verifyChange({
      rootPath: r.root,
      base: r.base,
      head: 'HEAD',
      testReport: [write(r.inputs, 'xxe.xml', xxe)],
    });
    expect(JSON.stringify(report)).not.toContain('TOP-SECRET-CONTENT');
    expect(report.findings.some((f) => f.rule === 'TEST-REPORT-MALFORMED')).toBe(true);
  });

  it('does not read files outside the root for a traversal path in coverage', async () => {
    const r = repo();
    const traversal = 'TN:\nSF:../../../../etc/passwd\nDA:1,1\nend_of_record\n';
    const report = await verifyChange({
      rootPath: r.root,
      base: r.base,
      head: 'HEAD',
      coverage: [write(r.inputs, 't.info', traversal)],
    });
    expect(JSON.stringify(report)).not.toContain('root:');
    expect(report.files.find((f) => f.path === 'src/calc.ts')?.coverage?.status).not.toBe('PASS');
  });

  it('rejects an oversized report instead of reading it', async () => {
    const r = repo();
    const big = write(r.inputs, 'big.info', '');
    truncateSync(big, 65 * 1024 * 1024);
    await expect(
      verifyChange({ rootPath: r.root, base: r.base, head: 'HEAD', coverage: [big] }),
    ).rejects.toThrow(/larger than/);
  });
});
