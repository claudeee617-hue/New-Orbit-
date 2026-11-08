import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDoctor, runGraphSummary, runInit, runTestHistory, ingestCiReport, ingestTestReport } from './operations.js';

const directories: string[] = [];

function workspace(): { directory: string; database: string } {
  const directory = mkdtempSync(join(tmpdir(), 'orbit-prompt-11-'));
  directories.push(directory);
  return { directory, database: join(directory, '.orbit', 'orbit.db') };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
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

  it('rejects unsupported test-report formats', async () => {
    const { database } = workspace();
    runInit(database, 'local/sample');
    await expect(ingestTestReport(database, 'local/sample', 'missing', 'bad')).rejects.toThrow(
      /format must be/,
    );
  });
});
