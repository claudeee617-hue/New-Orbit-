import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IN_MEMORY, createGraphStore, openDatabase } from '@orbit/database';
import {
  analyseTelemetry,
  compareEnvironments,
  createChangePassport,
  inspectEnvironment,
  parseTelemetry,
  scanRepository,
  summarizeTestHistory,
  type TestCaseResult,
} from './index.js';

/**
 * Controlled scenarios S4–S8 from docs/TEST_STRATEGY.md section 4. S1–S3, S9 and S10 live in
 * packages/witness/src/scenarios.test.ts because they exercise WITNESS. Inputs are synthetic.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const run = (_runId: string, outcome: 'passed' | 'failed'): TestCaseResult => ({
  id: 't::flaky',
  name: 'flaky',
  suite: 't',
  outcome,
  durationSeconds: 0.1,
});

describe('S4 flaky test: sample-size rule', () => {
  it('stays insufficient-data on 1 failure in 3 runs, flags suspected-flaky with enough mixed runs', () => {
    const few = summarizeTestHistory([run('1', 'passed'), run('2', 'failed'), run('3', 'passed')], {
      minSamples: 8,
      minFlips: 3,
    });
    expect(few[0]?.classification).toBe('insufficient-data');
    const outcomes = [
      'passed',
      'failed',
      'passed',
      'failed',
      'passed',
      'failed',
      'passed',
      'passed',
    ] as const;
    const many = summarizeTestHistory(
      outcomes.map((s, i) => run(String(i), s)),
      { minSamples: 8, minFlips: 3 },
    );
    expect(many[0]?.classification).toBe('suspected-flaky');
  });
});

describe('S5 missing environment dependency', () => {
  it('lists the missing tool in the CAPSULE comparison', () => {
    const before = inspectEnvironment({
      'package.json': JSON.stringify({ dependencies: { left: '1.0.0', right: '2.0.0' } }),
    });
    const after = inspectEnvironment({
      'package.json': JSON.stringify({ dependencies: { left: '1.0.0' } }),
    });
    const diff = compareEnvironments(before, after);
    expect(diff).toContainEqual(
      expect.objectContaining({ kind: 'dependency', key: 'right', after: null }),
    );
  });
});

describe('S6 architecture dependency breakage (new cycle)', () => {
  it('reports the new import cycle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orbit-s6-'));
    dirs.push(root);
    const files: Record<string, string> = {
      'package.json': '{"name":"s6"}',
      'src/a.ts': "import { b } from './b';\nexport const a = () => b;\n",
      'src/b.ts': "import { a } from './a';\nexport const b = () => a;\n",
    };
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), c);
    }
    const db = openDatabase({ path: IN_MEMORY });
    const result = await scanRepository({
      rootPath: root,
      store: createGraphStore(db),
      repositoryKey: 's6',
      cacheDir: mkdtempSync(join(tmpdir(), 'orbit-s6c-')),
      config: { skipGit: true },
    });
    expect(result.analysis.fileCycles).toEqual([['src/a.ts', 'src/b.ts']]);
  });
});

describe('S7 firmware watchdog event', () => {
  it('flags the watchdog and the passport links the telemetry session', () => {
    const log =
      'ts=1790000000 event="watchdog reset" heap=1200\nts=1790000001 event=boot heap=1900';
    const session = parseTelemetry(log, 'key-value');
    const analysis = analyseTelemetry(session);
    expect(session.watchdogEvents).toBe(1);
    expect(analysis.anomalies.length).toBeGreaterThan(0);
    const passport = createChangePassport({
      repository: 'demo',
      commitSha: 'a'.repeat(40),
      diffSha256: 'b'.repeat(64),
      changedFiles: ['src/main.c'],
      evidence: [
        {
          id: 'e1',
          kind: 'telemetry',
          status: 'PARTIAL',
          source: 'demo.log',
          sha256: session.rawSha256,
        },
      ],
      telemetrySessionSha256: session.rawSha256,
    });
    expect(passport.telemetrySessionSha256).toBe(session.rawSha256);
    expect(passport.completeness.find((d) => d.dimension === 'hardware')?.status).toBe('PARTIAL');
  });
});

describe('S8 missing hardware evidence', () => {
  it('never claims hardware verification without a device session', () => {
    const passport = createChangePassport({
      repository: 'demo',
      commitSha: 'a'.repeat(40),
      diffSha256: 'b'.repeat(64),
      changedFiles: ['src/main.c'],
      evidence: [],
    });
    expect(passport.telemetrySessionSha256).toBeNull();
    expect(passport.firmwareBuildId).toBeNull();
    const hardware = passport.completeness.find((d) => d.dimension === 'hardware');
    expect(hardware?.status).not.toBe('PRESENT');
    expect(hardware?.evidenceIds).toEqual([]);
    expect(passport.verificationStatus).not.toBe('PASS');
  });
});
