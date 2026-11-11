import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runDoctor,
  runGraphSummary,
  runInit,
  runTestHistory,
  runFlareHistory,
  ingestCiReport,
  ingestTestReport,
} from './operations.js';

const directories: string[] = [];

function workspace(): { directory: string; database: string } {
  const directory = mkdtempSync(join(tmpdir(), 'orbit-prompt-11-'));
  directories.push(directory);
  return { directory, database: join(directory, '.orbit', 'orbit.db') };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('Prompt 11 workspace commands', () => {
  it('initialises an empty database without requiring a repository', () => {
    const { database } = workspace();
    const result = runInit(database);
    expect(result.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(result.repository).toBeUndefined();
  });

  it('registers a repository and reports integrity diagnostics without leaking tokens', () => {
    const { database } = workspace();
    runInit(database, 'local/sample', 'Sample repository');
    const report = runDoctor(database, { ORBIT_API_TOKEN: 't'.repeat(48) });
    expect(report.ok).toBe(true);
    expect(report.repositories).toMatchObject({ count: 1, keys: ['local/sample'] });
    expect(report.integrity).toEqual([{ repositoryKey: 'local/sample', ok: true, problems: 0 }]);
    expect(JSON.stringify(report)).not.toContain('t'.repeat(48));
    expect(report.apiAuthentication.source).toBe('environment');
  });

  it('summarises the graph for the selected workspace', () => {
    const { database } = workspace();
    runInit(database, 'local/sample');
    const result = runGraphSummary(database);
    expect(result.repository.key).toBe('local/sample');
    expect(result.nodes).toEqual({});
    expect(result.ledger.entries).toBeGreaterThan(0);
    expect(result.integrity.ok).toBe(true);
  });
});

describe('Prompt 11 evidence ingestion', () => {
  it('ingests CI JSON as immutable evidence and a CIWorkflow node', async () => {
    const { database } = workspace();
    runInit(database, 'local/sample');
    const result = await ingestCiReport(database, 'local/sample', {
      status: 'failure',
      commitSha: 'a'.repeat(40),
      workflow: 'CI',
      runId: '123',
    });
    expect(result.evidence.status).toBe('FAIL');
    expect(result.evidence.sourceType).toBe('ci');
    expect(result.node.type).toBe('CIWorkflow');
    const history = runGraphSummary(database);
    expect(history.nodes['CIWorkflow']).toBe(1);
  });

  it('rejects unknown CI summary fields that could contain secrets', async () => {
    const { database } = workspace();
    runInit(database, 'local/sample');
    await expect(
      ingestCiReport(database, 'local/sample', {
        status: 'success',
        summary: { passed: 10, apiToken: 'do-not-store' },
      }),
    ).rejects.toThrow(/summary field apiToken is not supported/);
    expect(runGraphSummary(database).nodes['CIWorkflow']).toBeUndefined();
  });

  it('ingests a JUnit file and exposes the test-run record in history', async () => {
    const { directory, database } = workspace();
    runInit(database, 'local/sample');
    const reportFile = join(directory, 'junit.xml');
    writeFileSync(
      reportFile,
      '<testsuite name="unit"><testcase classname="api" name="ok"/><testcase classname="api" name="failed"><failure message="bad"/></testcase></testsuite>',
    );
    const result = await ingestTestReport(database, 'local/sample', reportFile, 'junit');
    expect(result.summary).toEqual({ format: 'junit', total: 2, passed: 1, failed: 1, skipped: 0 });
    expect(result.evidence.status).toBe('FAIL');
    const history = runTestHistory(database, 'local/sample', 10, 0);
    expect(history.runs).toHaveLength(1);
    expect(history.runs[0]?.attrs['failed']).toBe(1);
  });

  it('paginates aggregate test reports independently of their per-case graph records', async () => {
    const { directory, database } = workspace();
    runInit(database, 'local/sample');
    const reportFile = join(directory, 'junit.xml');
    const makeReport = (run: number) => {
      const cases = Array.from(
        { length: 40 },
        (_, index) => `<testcase classname="api" name="case-${index}" time="0.01"/>`,
      ).join('');
      return `<testsuite name="unit-${run}">${cases}</testsuite>`;
    };

    writeFileSync(reportFile, makeReport(1));
    await ingestTestReport(database, 'local/sample', reportFile, 'junit', 'page-run-1');
    writeFileSync(reportFile, makeReport(2));
    await ingestTestReport(database, 'local/sample', reportFile, 'junit', 'page-run-2');

    const firstPage = runTestHistory(database, 'local/sample', 1, 0);
    expect(firstPage.runs).toHaveLength(1);
    expect(firstPage.page).toMatchObject({ limit: 1, offset: 0, hasMore: true, truncated: false });

    const secondPage = runTestHistory(database, 'local/sample', 1, 1);
    expect(secondPage.runs).toHaveLength(1);
    expect(secondPage.page).toMatchObject({
      limit: 1,
      offset: 1,
      hasMore: false,
      truncated: false,
    });
    expect(secondPage.runs[0]?.attrs['runId']).toBe('page-run-2');
  });

  it('persists per-test outcomes and detects a flaky test across separate CLI ingestions', async () => {
    const { directory, database } = workspace();
    runInit(database, 'local/sample');
    const reportFile = join(directory, 'junit.xml');
    for (let index = 0; index < 8; index += 1) {
      const failed = index % 2 === 1;
      writeFileSync(
        reportFile,
        failed
          ? '<testsuite name="unit"><testcase classname="api" name="flaky"><failure message="intermittent failure"/></testcase></testsuite>'
          : '<testsuite name="unit"><testcase classname="api" name="flaky" time="0.1"/></testsuite>',
      );
      await ingestTestReport(database, 'local/sample', reportFile, 'junit', `ci-run-${index}`);
    }

    const reportHistory = runTestHistory(database, 'local/sample', 20, 0);
    expect(reportHistory.runs).toHaveLength(8);
    const flare = runFlareHistory(database, 'local/sample');
    expect(flare).toMatchObject({
      repository: 'local/sample',
      testExecutions: 8,
      distinctRuns: 8,
      tests: 1,
      truncated: false,
    });
    expect(flare.summaries[0]).toMatchObject({
      testId: 'api::flaky',
      samples: 8,
      passed: 4,
      failed: 4,
      flipCount: 7,
      classification: 'suspected-flaky',
    });
    expect(flare.limitations.join(' ').toLowerCase()).toContain(
      'legacy aggregate-only testrun records',
    );
  });

  it('deduplicates identical reports unless a distinct external run ID is supplied', async () => {
    const { directory, database } = workspace();
    runInit(database, 'local/sample');
    const reportFile = join(directory, 'junit.xml');
    writeFileSync(
      reportFile,
      '<testsuite name="unit"><testcase classname="api" name="stable"/></testsuite>',
    );
    const first = await ingestTestReport(database, 'local/sample', reportFile, 'junit');
    const second = await ingestTestReport(database, 'local/sample', reportFile, 'junit');
    expect(first.runId).toBe(second.runId);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    const history = runFlareHistory(database, 'local/sample');
    expect(history.testExecutions).toBe(1);
    expect(history.distinctRuns).toBe(1);
    expect(history.summaries[0]?.classification).toBe('insufficient-data');
  });

  it('rejects reusing an external run ID for different report content', async () => {
    const { directory, database } = workspace();
    runInit(database, 'local/sample');
    const reportFile = join(directory, 'junit.xml');
    writeFileSync(
      reportFile,
      '<testsuite name="unit"><testcase classname="api" name="same"/></testsuite>',
    );
    await ingestTestReport(database, 'local/sample', reportFile, 'junit', 'ci-duplicate');
    writeFileSync(
      reportFile,
      '<testsuite name="unit"><testcase classname="api" name="same"><failure message="changed"/></testcase></testsuite>',
    );
    await expect(
      ingestTestReport(database, 'local/sample', reportFile, 'junit', 'ci-duplicate'),
    ).rejects.toThrow(/already exists with different report content/);
    expect(runFlareHistory(database, 'local/sample').testExecutions).toBe(1);
  });

  it('marks an empty test report PARTIAL instead of treating it as a pass', async () => {
    const { directory, database } = workspace();
    runInit(database, 'local/sample');
    const reportFile = join(directory, 'empty.xml');
    writeFileSync(reportFile, '<testsuite name="empty"></testsuite>');
    const result = await ingestTestReport(database, 'local/sample', reportFile, 'junit');
    expect(result.summary.total).toBe(0);
    expect(result.evidence.status).toBe('PARTIAL');
    expect(result.evidence.limitations).toContain(
      'The report contained no test cases; no test execution was measured.',
    );
    expect(runFlareHistory(database, 'local/sample').testExecutions).toBe(0);
  });

  it('redacts common credentials from persisted failure messages', async () => {
    const { directory, database } = workspace();
    runInit(database, 'local/sample');
    const reportFile = join(directory, 'junit.xml');
    writeFileSync(
      reportFile,
      '<testsuite name="unit"><testcase classname="api" name="failure"><failure message="Authorization: Bearer abcdefghijklmnopqrstuvwxyz API_KEY=super-secret-value"/></testcase></testsuite>',
    );
    await ingestTestReport(database, 'local/sample', reportFile, 'junit', 'ci-redaction-1');
    const history = runFlareHistory(database, 'local/sample', { minSamples: 2 });
    const serialized = JSON.stringify(history);
    expect(serialized).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(serialized).not.toContain('super-secret-value');
    expect(serialized.toLowerCase()).toContain('[redacted]');
    expect(history.limitations.join(' ')).toContain('best-effort');
  });

  it('rejects unsupported test-report formats', async () => {
    const { database } = workspace();
    runInit(database, 'local/sample');
    await expect(ingestTestReport(database, 'local/sample', 'missing', 'bad')).rejects.toThrow(
      /format must be/,
    );
  });
});
