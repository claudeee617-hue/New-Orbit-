import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { IN_MEMORY, createGraphStore, openDatabase } from '@orbit/database';
import { repositoryIdFor } from '@orbit/core';
import { createSampleRepo } from './fixture.js';
import { renderJson, renderMarkdown, renderSarif } from './render.js';
import { verifyChange, type VerifyOptions } from './verify.js';

const sample = createSampleRepo();
afterAll(() => rmSync(dirname(sample.root), { recursive: true, force: true }));

const inputs = (name: string): string => join(sample.inputsDir, name);
const full = (): VerifyOptions => ({
  rootPath: sample.root,
  base: sample.baseSha,
  head: 'feature',
  coverage: [inputs('lcov.info')],
  baseCoverage: [inputs('base-lcov.info')],
  testReport: [inputs('junit.xml')],
  baseTestReport: [inputs('base-junit.xml')],
  buildResult: inputs('build.json'),
});

describe('verifyChange on the sample pull request', () => {
  it('maps changed lines, symbols and coverage precisely', async () => {
    const r = await verifyChange(full());
    expect(r.head.sha).toBe(sample.headSha);
    expect(r.files.map((f) => f.path)).toEqual([
      '.github/workflows/ci.yml',
      'src/auth.ts',
      'src/math.ts',
    ]);
    const math = r.files.find((f) => f.path === 'src/math.ts')!;
    expect(math.coverage).toMatchObject({
      covered: [5],
      uncovered: [6, 10, 11],
      nonExecutable: [7, 12],
      status: 'PARTIAL',
    });
    const div = r.symbols.find((s) => s.qualifiedName === 'div')!;
    expect(div).toMatchObject({
      changedLines: [5, 6, 7],
      covered: [5],
      uncovered: [6],
      coverage: 'PARTIAL',
    });
    const mul = r.symbols.find((s) => s.qualifiedName === 'mul')!;
    expect(mul).toMatchObject({ covered: [], uncovered: [10, 11], coverage: 'PARTIAL' });
    // `add` was not touched, so it is not reported even though the file has coverage.
    expect(r.symbols.map((s) => s.qualifiedName)).not.toContain('add');
  });

  it('never assumes a file without a coverage entry is covered', async () => {
    const r = await verifyChange(full());
    const auth = r.files.find((f) => f.path === 'src/auth.ts')!;
    expect(auth.coverage?.status).toBe('NOT_MEASURED');
    expect(auth.coverage?.covered).toEqual([]);
    expect(r.symbols.find((s) => s.path === 'src/auth.ts')?.coverage).toBe('NOT_MEASURED');
    expect(r.findings.map((f) => f.rule)).toContain('NO-COVERAGE');
  });

  it('distinguishes statuses per dimension and overall', async () => {
    const r = await verifyChange(full());
    const dim = Object.fromEntries(r.dimensions.map((d) => [d.name, d.status]));
    expect(dim['coverage']).toBe('PARTIAL');
    expect(dim['tests']).toBe('FAIL');
    expect(dim['build']).toBe('PASS');
    expect(r.overall).toBe('FAIL');
    expect(r.tests.regressions).toEqual([
      { id: 'math::div by zero', baseStatus: 'passed', headStatus: 'failed' },
      { id: 'math::legacy', baseStatus: 'passed', headStatus: 'missing' },
    ]);
  });

  it('links tests statically and flags files without one', async () => {
    const r = await verifyChange(full());
    const math = r.files.find((f) => f.path === 'src/math.ts')!;
    expect(math.linkage).toMatchObject({ status: 'PASS', direct: ['src/math.test.ts'] });
    const auth = r.files.find((f) => f.path === 'src/auth.ts')!;
    expect(auth.linkage?.status).toBe('PARTIAL');
    expect(r.findings.map((f) => f.rule)).toContain('NO-RELATED-TEST');
  });

  it('reports sensitive files, regressions and relevant decisions', async () => {
    const r = await verifyChange(full());
    const rules = r.findings.map((f) => f.rule);
    expect(rules).toEqual(
      expect.arrayContaining([
        'SENSITIVE-FILE',
        'COVERAGE-REGRESSION',
        'UNCOVERED-LINES',
        'UNTESTED-SYMBOL',
        'TEST-FAILURE',
        'TEST-REGRESSION',
      ]),
    );
    expect(r.decisions.map((d) => d.path)).toEqual(['docs/DECISIONS/0001-math-module.md']);
    expect(r.decisions[0]).toMatchObject({
      title: 'ADR-0001: Keep arithmetic in src/math.ts',
      status: 'Accepted',
    });
    const sensitive = r.findings.find((f) => f.rule === 'SENSITIVE-FILE')!;
    expect(sensitive.location?.path).toBe('.github/workflows/ci.yml');
    for (const f of r.findings) {
      expect(f.id).toMatch(/^WIT-[A-Z-]+-[0-9a-f]{8}$/);
      expect(f.explanation).not.toBe('');
      expect(f.suggestedAction).not.toBe('');
      expect(f.evidence.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic', async () => {
    expect(renderJson(await verifyChange(full()))).toBe(renderJson(await verifyChange(full())));
  });

  it('says NOT_MEASURED (never PASS) when nothing was supplied', async () => {
    const r = await verifyChange({ rootPath: sample.root, base: sample.baseSha, head: 'feature' });
    const dim = Object.fromEntries(r.dimensions.map((d) => [d.name, d.status]));
    expect(dim['coverage']).toBe('NOT_MEASURED');
    expect(dim['tests']).toBe('NOT_MEASURED');
    expect(dim['build']).toBe('NOT_MEASURED');
    expect(r.overall).toBe('PARTIAL');
    expect(r.findings.map((f) => f.rule)).toEqual(
      expect.arrayContaining(['COVERAGE-NOT-MEASURED', 'TESTS-NOT-MEASURED', 'BUILD-NOT-MEASURED']),
    );
  });

  it('marks malformed inputs INCOMPLETE rather than passing them', async () => {
    const dir = dirname(sample.inputsDir);
    const badCov = join(dir, 'bad.lcov');
    const badXml = join(dir, 'bad.xml');
    const badBuild = join(dir, 'bad.json');
    writeFileSync(badCov, 'SF:src/math.ts\nDA:5,1\nDA:oops\n');
    writeFileSync(badXml, '<testsuite><testcase name="a">');
    writeFileSync(badBuild, '{"status": 12');
    const r = await verifyChange({
      rootPath: sample.root,
      base: sample.baseSha,
      head: 'feature',
      coverage: [badCov],
      testReport: [badXml],
      buildResult: badBuild,
    });
    const dim = Object.fromEntries(r.dimensions.map((d) => [d.name, d.status]));
    expect(dim['coverage']).toBe('INCOMPLETE');
    expect(dim['tests']).toBe('INCOMPLETE');
    expect(dim['build']).toBe('INCOMPLETE');
    expect(r.overall).toBe('INCOMPLETE');
    expect(r.findings.map((f) => f.rule)).toEqual(
      expect.arrayContaining(['COVERAGE-MALFORMED', 'TEST-REPORT-MALFORMED', 'BUILD-UNREADABLE']),
    );
  });

  it('FAILs coverage only when a threshold is requested', async () => {
    const strict = await verifyChange({ ...full(), minChangedLineCoverage: 0.9 });
    expect(strict.dimensions.find((d) => d.name === 'coverage')?.status).toBe('FAIL');
    const lax = await verifyChange({ ...full(), minChangedLineCoverage: 0.1 });
    expect(lax.dimensions.find((d) => d.name === 'coverage')?.status).toBe('PARTIAL');
  });

  it('treats coverage from another commit as INCOMPLETE', async () => {
    const r = await verifyChange({ ...full(), coverageCommit: sample.baseSha });
    expect(r.dimensions.find((d) => d.name === 'coverage')?.status).toBe('INCOMPLETE');
    expect(r.limitations.join('\n')).toMatch(/Coverage was produced from/);
  });

  it('rejects hostile refs and missing inputs', async () => {
    await expect(
      verifyChange({ rootPath: sample.root, base: '--output=x', head: 'feature' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      verifyChange({ rootPath: sample.root, base: 'nope-ref', head: 'feature' }),
    ).rejects.toBeDefined();
    await expect(
      verifyChange({ ...full(), coverage: [inputs('missing.info')] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(verifyChange({ ...full(), minChangedLineCoverage: 2 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('persists evidence and findings, idempotently, with an intact ledger', async () => {
    const db = openDatabase({ path: IN_MEMORY });
    try {
      const store = createGraphStore(db);
      const key = 'local/sample';
      const id = repositoryIdFor(key);
      const first = await verifyChange({ ...full(), store, repositoryKey: key });
      const evidence = store.evidence.list(id, {});
      expect(evidence.map((e) => e.sourceType)).toEqual(
        expect.arrayContaining(['git', 'coverage', 'test-report', 'build']),
      );
      const findings = store.nodes.find(id, { type: 'Finding' });
      expect(findings).toHaveLength(first.findings.length);
      expect(findings.map((n) => n.key).sort()).toEqual(first.findings.map((f) => f.id).sort());
      const head = store.ledger.head(id)?.seq;
      await verifyChange({ ...full(), store, repositoryKey: key });
      expect(store.ledger.head(id)?.seq).toBe(head);
      expect(store.verifyIntegrity(id).ok).toBe(true);
      expect(store.edges.list(id, { types: ['AFFECTS'] }).length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('degrades test linkage honestly when the tree is not at head', async () => {
    const r = await verifyChange({ ...full(), scan: 'never' });
    expect(r.dimensions.find((d) => d.name === 'test-linkage')?.status).toBe('NOT_MEASURED');
    expect(r.limitations.join('\n')).toMatch(/Test linkage is NOT_MEASURED/);
  });
});

describe('renderers', () => {
  it('produces SARIF 2.1.0 with fingerprints and locations', async () => {
    const r = await verifyChange(full());
    const sarif = JSON.parse(renderSarif(r)) as {
      version: string;
      $schema: string;
      runs: {
        tool: { driver: { name: string; rules: { id: string }[] } };
        results: {
          ruleId: string;
          level: string;
          message: { text: string };
          partialFingerprints: Record<string, string>;
          locations?: {
            physicalLocation: { artifactLocation: { uri: string }; region?: { startLine: number } };
          }[];
        }[];
      }[];
    };
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toContain('sarif-2.1.0');
    const run = sarif.runs[0]!;
    expect(run.results).toHaveLength(r.findings.length);
    const ruleIds = new Set(run.tool.driver.rules.map((x) => x.id));
    for (const res of run.results) {
      expect(ruleIds.has(res.ruleId)).toBe(true);
      expect(['error', 'warning', 'note']).toContain(res.level);
      expect(res.message.text.length).toBeGreaterThan(0);
      expect(res.partialFingerprints['orbitFindingId/v1']).toMatch(/^WIT-/);
    }
    const uncovered = run.results.find((x) => x.ruleId === 'UNCOVERED-LINES')!;
    expect(uncovered.locations?.[0]?.physicalLocation.region?.startLine).toBeGreaterThan(0);
  });

  it('markdown states every dimension and each finding field', async () => {
    const r = await verifyChange(full());
    const md = renderMarkdown(r);
    expect(md).toContain('# WITNESS verification: FAIL');
    for (const d of ['coverage', 'tests', 'build', 'test-linkage'])
      expect(md).toContain(`| ${d} |`);
    for (const f of r.findings) expect(md).toContain(f.id);
    expect(md).toContain('- Suggested action:');
    expect(md).toContain('- Evidence:');
    expect(md).toContain('## Relevant architecture decisions');
    expect(md).toContain('does not prove correctness');
  });

  it('matches the committed golden sample report', async () => {
    const r = await verifyChange(full());
    const dir = join(__dirname, '..', 'samples');
    const check = (name: string, content: string): void => {
      const file = join(dir, name);
      if (process.env['UPDATE_GOLDEN'] === '1') writeFileSync(file, content);
      expect(content).toBe(readFileSync(file, 'utf8'));
    };
    check('sample-report.md', renderMarkdown(r));
    check('sample-report.json', renderJson(r));
    check('sample-report.sarif', renderSarif(r));
  });
});
