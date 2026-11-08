import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGraphStore, openDatabase } from '@orbit/database';
import { buildProgram, type CliIo } from './program.js';

const directories: string[] = [];
function tempDir(): string {
  const path = mkdtempSync(join(tmpdir(), 'orbit-prompt-9-10-'));
  directories.push(path);
  return path;
}
function capture(): { io: CliIo; output: () => string } {
  let value = '';
  return {
    io: { stdout: (text) => (value += text), stderr: (text) => (value += text), env: {} },
    output: () => value,
  };
}
async function run(args: string[]): Promise<string> {
  const result = capture();
  await buildProgram(result.io).parseAsync(['node', 'orbit', ...args]);
  return result.output();
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Prompt 9 — Flight Recorder CLI', () => {
  it('renders typed analysis, normalized events and explicit transport availability', async () => {
    const root = tempDir();
    const log = join(root, 'record.ndjson');
    writeFileSync(log, [
      '{"timestamp":"2026-11-08T10:00:00Z","voltage":3.3,"event":"boot","api_token":"DO_NOT_LEAK"}',
      '{"timestamp":"2026-11-08T10:00:01Z","voltage":3.8,"event":"watchdog reset"}',
    ].join('\n'));
    const report = JSON.parse(await run([
      'device', 'replay', log,
      '--units', '{"voltage":"V"}',
      '--thresholds', '[{"id":"vmax","metric":"voltage","max":3.5,"severity":"warning"}]',
    ])) as {
      mode: string;
      analysis: { anomalies: Array<{ kind: string }>; metricStats: Record<string, { unit: string | null }> };
      serialTransport: { available: boolean };
      points: Array<{ event: string; raw: string }>;
    };
    expect(report.mode).toBe('read-only-recorded-file-replay');
    expect(report.analysis.metricStats.voltage?.unit).toBe('V');
    expect(report.analysis.anomalies.map((item) => item.kind)).toEqual(['reset', 'watchdog', 'threshold']);
    expect(report.points[0]?.event).toBe('boot');
    expect(report.points.every((item) => item.raw === '')).toBe(true);
    expect(report.serialTransport.available).toBe(false);
    expect(JSON.stringify(report)).not.toContain('DO_NOT_LEAK');
  });

  it('reports physical serial transport as unavailable instead of pretending to connect', async () => {
    const report = JSON.parse(await run(['device', 'serial-status'])) as { available: boolean; reason: string };
    expect(report.available).toBe(false);
    expect(report.reason).toContain('No USB serial adapter');
  });

  it('persists only a hash-verified repo-local telemetry artifact and labels DEMO', async () => {
    const root = tempDir();
    const dbPath = join(root, '.orbit', 'orbit.db');
    const repoRoot = join(root, 'repo');
    const log = join(repoRoot, 'fixtures', 'record.ndjson');
    const database = openDatabase({ path: dbPath });
    const store = createGraphStore(database);
    store.repositories.register({ key: 'test/cli-telemetry', displayName: 'CLI Telemetry' });
    database.close();
    const fs = await import('node:fs/promises');
    await fs.mkdir(join(repoRoot, 'fixtures'), { recursive: true });
    const raw = '{"timestamp":"2026-11-08T10:00:00Z","event":"watchdog reset","voltage":3.2}';
    await fs.writeFile(log, raw);
    const report = JSON.parse(await run([
      'device', 'replay', log,
      '--db', dbPath,
      '--repo', 'test/cli-telemetry',
      '--repo-root', repoRoot,
      '--artifact-path', 'fixtures/record.ndjson',
      '--demo',
    ])) as { demoLabel: string; persistence: { isDemo: boolean; pointCount: number; evidenceId: string } };
    expect(report.demoLabel).toContain('DEMO');
    expect(report.persistence.isDemo).toBe(true);
    expect(report.persistence.pointCount).toBe(1);
    expect(report.persistence.evidenceId).toMatch(/^ev_/);
  });
});

describe('Prompt 10 — Change Passport CLI', () => {
  it('persists, lists history, compares and creates a non-executing reproduction plan', async () => {
    const root = tempDir();
    const dbPath = join(root, '.orbit', 'orbit.db');
    const database = openDatabase({ path: dbPath });
    const store = createGraphStore(database);
    const repository = store.repositories.register({
      key: 'test/cli-passport',
      displayName: 'CLI Passport',
    }).record;
    const commitSha = '0123456789abcdef0123456789abcdef01234567';
    const parserEvidence = store.evidence.append({
      repositoryId: repository.id,
      source: 'fixture:parser',
      sourceType: 'parser',
      contentHash: 'f'.repeat(64),
      status: 'PASS',
      limitations: [],
      relatedEntityIds: [],
    });
    const file = store.nodes.upsert({
      repositoryId: repository.id,
      type: 'File',
      key: 'src/a.ts',
      attrs: { producer: 'atlas', module: 'src' },
      sourceEvidenceId: parserEvidence.record.id,
    }).record;
    const testNode = store.nodes.upsert({
      repositoryId: repository.id,
      type: 'Test',
      key: 'test/a.test.ts',
      attrs: { producer: 'atlas' },
      sourceEvidenceId: parserEvidence.record.id,
    }).record;
    store.edges.upsert({
      repositoryId: repository.id,
      type: 'TESTS',
      fromId: testNode.id,
      toId: file.id,
      attrs: {},
      sourceEvidenceId: parserEvidence.record.id,
    });
    const addEvidence = (suffix: string, statuses: { git?: 'PASS'; coverage?: 'PASS'; 'test-report'?: 'PASS'; ci?: 'PASS' | 'FAIL' }) => {
      for (const [sourceType, status] of Object.entries(statuses) as Array<['git' | 'coverage' | 'test-report' | 'ci', 'PASS' | 'FAIL']>) {
        store.evidence.append({
          repositoryId: repository.id,
          source: `fixture:${sourceType}:${suffix}`,
          sourceType,
          commitSha,
          contentHash: sourceType === 'git' ? '1'.repeat(64) :
            sourceType === 'coverage' ? '2'.repeat(64) :
            sourceType === 'test-report' ? '3'.repeat(64) : (suffix === 'second' ? '5'.repeat(64) : '4'.repeat(64)),
          status,
          limitations: status === 'PASS' ? [] : ['CI run failed.'],
          relatedEntityIds: [file.id],
        });
      }
    };
    addEvidence('first', { git: 'PASS', coverage: 'PASS', 'test-report': 'PASS', ci: 'PASS' });
    database.close();

    const beforeFile = join(root, 'before.json');
    const afterFile = join(root, 'after.json');
    const base = {
      repository: repository.key,
      commitSha,
      changedFiles: ['src/a.ts'],
      evidence: [],
    };
    writeFileSync(beforeFile, JSON.stringify({ ...base, diffSha256: 'a'.repeat(64) }));
    writeFileSync(afterFile, JSON.stringify({ ...base, diffSha256: 'b'.repeat(64) }));
    const before = JSON.parse(await run(['passport', 'create', beforeFile, '--db', dbPath, '--repo', repository.key])) as {
      nodeId: string;
      passport: { state: string; verificationStatus: string };
    };
    expect(before.passport.state).toBe('COMPLETE');
    expect(before.passport.verificationStatus).toBe('PASS');
    const history = JSON.parse(await run(['passport', 'history', before.nodeId, '--db', dbPath, '--repo', repository.key])) as Array<{ version: number }>;
    expect(history).toHaveLength(1);
    const plan = JSON.parse(await run(['passport', 'plan', before.nodeId, '--db', dbPath, '--repo', repository.key])) as {
      steps: Array<{ automaticExecution: boolean }>;
    };
    expect(plan.steps.every((item) => item.automaticExecution === false)).toBe(true);

    const writable = openDatabase({ path: dbPath });
    const mutableStore = createGraphStore(writable);
    for (const sourceType of ['git', 'coverage', 'test-report', 'ci'] as const) {
      mutableStore.evidence.append({
        repositoryId: repository.id,
        source: `fixture:${sourceType}:second`,
        sourceType,
        commitSha,
        contentHash: sourceType === 'git' ? '6'.repeat(64) :
          sourceType === 'coverage' ? '7'.repeat(64) :
          sourceType === 'test-report' ? '8'.repeat(64) : '9'.repeat(64),
        status: sourceType === 'ci' ? 'FAIL' : 'PASS',
        limitations: sourceType === 'ci' ? ['CI run failed.'] : [],
        relatedEntityIds: [file.id],
      });
    }
    writable.close();

    const after = JSON.parse(await run(['passport', 'create', afterFile, '--db', dbPath, '--repo', repository.key])) as {
      nodeId: string;
      passport: { verificationStatus: string };
    };
    expect(after.passport.verificationStatus).toBe('FAIL');
    const comparison = JSON.parse(await run([
      'passport', 'compare', before.nodeId, after.nodeId, '--db', dbPath, '--repo', repository.key,
    ])) as { addedEvidenceIds: string[]; beforeStatus: string; afterStatus: string };
    expect(comparison.addedEvidenceIds.length).toBeGreaterThan(0);
    expect(comparison.beforeStatus).toBe('PASS');
    expect(comparison.afterStatus).toBe('FAIL');
  });
});
