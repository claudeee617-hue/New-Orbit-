import { describe, expect, it } from 'vitest';
import { IN_MEMORY, openDatabase, createGraphStore } from '@orbit/database';
import { createChangePassport } from './passport.js';
import {
  compareChangePassports,
  createReproductionPlan,
  getPassportHistory,
  recordChangePassport,
} from './passport-engine.js';

function setup() {
  const database = openDatabase({ path: IN_MEMORY });
  const store = createGraphStore(database, { now: () => '2026-11-08T10:00:00.000Z' });
  const repository = store.repositories.register({
    key: 'test/passport',
    displayName: 'Passport Test',
  }).record;
  const evidence = store.evidence.append({
    repositoryId: repository.id,
    source: 'fixture:atlas-index',
    sourceType: 'parser',
    contentHash: 'f'.repeat(64),
    status: 'PASS',
    limitations: [],
    relatedEntityIds: [],
  });
  const fileA = store.nodes.upsert({
    repositoryId: repository.id,
    type: 'File',
    key: 'src/a.ts',
    attrs: { producer: 'atlas', module: 'src' },
    sourceEvidenceId: evidence.record.id,
  }).record;
  const fileB = store.nodes.upsert({
    repositoryId: repository.id,
    type: 'File',
    key: 'src/b.ts',
    attrs: { producer: 'atlas', module: 'src' },
    sourceEvidenceId: evidence.record.id,
  }).record;
  const test = store.nodes.upsert({
    repositoryId: repository.id,
    type: 'Test',
    key: 'test/a.test.ts',
    attrs: { producer: 'atlas' },
    sourceEvidenceId: evidence.record.id,
  }).record;
  store.edges.upsert({
    repositoryId: repository.id,
    type: 'IMPORTS',
    fromId: fileB.id,
    toId: fileA.id,
    attrs: {},
    sourceEvidenceId: evidence.record.id,
  });
  store.edges.upsert({
    repositoryId: repository.id,
    type: 'TESTS',
    fromId: test.id,
    toId: fileA.id,
    attrs: {},
    sourceEvidenceId: evidence.record.id,
  });
  return { database, store, repository, evidence, fileA, fileB, test };
}

function addRequiredEvidence(
  store: ReturnType<typeof setup>['store'],
  repositoryId: string,
  commitSha: string,
  fileId: string,
  suffix: string,
) {
  for (const sourceType of ['git', 'coverage', 'test-report', 'ci'] as const) {
    store.evidence.append({
      repositoryId,
      source: `fixture:${sourceType}:${suffix}`,
      sourceType,
      commitSha,
      contentHash:
        sourceType === 'git'
          ? '1'.repeat(64)
          : sourceType === 'coverage'
            ? '2'.repeat(64)
            : sourceType === 'test-report'
              ? '3'.repeat(64)
              : '4'.repeat(64),
      status: 'PASS',
      limitations: [],
      relatedEntityIds: [fileId],
    });
  }
}

describe('Change Passport evidence engine', () => {
  it('does not treat caller-supplied evidence as graph-verified', () => {
    const passport = createChangePassport({
      repository: 'example/repo',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
      diffSha256: 'a'.repeat(64),
      changedFiles: ['src/a.ts'],
      evidence: [
        { id: 'git', kind: 'git', status: 'PASS', source: 'user-input', sha256: '1'.repeat(64) },
        { id: 'coverage', kind: 'coverage', status: 'PASS', source: 'user-input', sha256: '2'.repeat(64) },
        { id: 'tests', kind: 'test-report', status: 'PASS', source: 'user-input', sha256: '3'.repeat(64) },
        { id: 'ci', kind: 'ci', status: 'PASS', source: 'user-input', sha256: '4'.repeat(64) },
      ],
    });
    expect(passport.state).toBe('COMPLETE');
    expect(passport.evidenceVerification).toBe('UNVERIFIED_INPUT');
    expect(passport.verificationStatus).toBe('NOT_MEASURED');
  });


  it('correlates required evidence, graph impact and related tests into a versioned passport', () => {
    const { database, store, repository, fileA } = setup();
    try {
      const commitSha = '0123456789abcdef0123456789abcdef01234567';
      addRequiredEvidence(store, repository.id, commitSha, fileA.id, 'first');
      const result = recordChangePassport(
        store,
        {
          repositoryId: repository.id,
          repository: repository.key,
          commitSha,
          diffSha256: 'a'.repeat(64),
          changedFiles: ['src/a.ts'],
          evidence: [],
        },
        { now: () => '2026-11-08T10:00:00.000Z' },
      );
      expect(result.passport.state).toBe('COMPLETE');
      expect(result.passport.verificationStatus).toBe('PASS');
      expect(result.passport.missingEvidence).toEqual([]);
      expect(result.impact.affectedFiles).toContain('src/b.ts');
      expect(result.impact.relatedTests).toContain('test/a.test.ts');
      expect(result.dimensions.map((item) => item.status).slice(0, 4)).toEqual([
        'PRESENT',
        'PRESENT',
        'PRESENT',
        'PRESENT',
      ]);
      expect(store.nodes.get(repository.id, result.nodeId)?.type).toBe('ChangePassport');
      expect(getPassportHistory(store, repository.id, result.nodeId)).toHaveLength(1);
      expect(store.verifyIntegrity(repository.id).ok).toBe(true);
    } finally {
      database.close();
    }
  });

  it('records a new immutable version when evidence changes and builds a non-executing reproduction plan', () => {
    const { database, store, repository, fileA } = setup();
    try {
      const commitSha = '0123456789abcdef0123456789abcdef01234567';
      addRequiredEvidence(store, repository.id, commitSha, fileA.id, 'initial');
      const input = {
        repositoryId: repository.id,
        repository: repository.key,
        commitSha,
        diffSha256: 'b'.repeat(64),
        changedFiles: ['src/a.ts'],
        evidence: [],
      };
      const first = recordChangePassport(store, input, { now: () => '2026-11-08T10:00:00.000Z' });
      store.evidence.append({
        repositoryId: repository.id,
        source: 'fixture:extra-ci-run',
        sourceType: 'ci',
        commitSha,
        contentHash: '5'.repeat(64),
        status: 'FAIL',
        limitations: ['A failing CI run is preserved as evidence, not hidden.'],
        relatedEntityIds: [fileA.id],
      });
      const second = recordChangePassport(store, input, { now: () => '2026-11-08T10:01:00.000Z' });
      expect(second.version).toBe(first.version + 1);
      expect(second.passport.verificationStatus).toBe('FAIL');
      expect(getPassportHistory(store, repository.id, second.nodeId)).toHaveLength(2);
      const plan = createReproductionPlan(store, repository.id, second.nodeId);
      expect(plan.steps.every((step) => step.automaticExecution === false)).toBe(true);
      expect(plan.steps.some((step) => step.id === 'tests')).toBe(true);
      expect(store.verifyIntegrity(repository.id).ok).toBe(true);
    } finally {
      database.close();
    }
  });

  it('compares two passports without inventing evidence or a composite score', () => {
    const { database, store, repository, fileA } = setup();
    try {
      const commitSha = '0123456789abcdef0123456789abcdef01234567';
      addRequiredEvidence(store, repository.id, commitSha, fileA.id, 'compare');
      const before = recordChangePassport(store, {
        repositoryId: repository.id,
        repository: repository.key,
        commitSha,
        diffSha256: 'c'.repeat(64),
        changedFiles: ['src/a.ts'],
        evidence: [],
      });
      store.evidence.append({
        repositoryId: repository.id,
        source: 'fixture:telemetry',
        sourceType: 'telemetry',
        commitSha,
        contentHash: '6'.repeat(64),
        status: 'PARTIAL',
        limitations: ['Synthetic hardware log only.'],
        relatedEntityIds: [fileA.id],
      });
      const after = recordChangePassport(store, {
        repositoryId: repository.id,
        repository: repository.key,
        commitSha,
        diffSha256: 'd'.repeat(64),
        changedFiles: ['src/a.ts'],
        evidence: [],
      });
      const comparison = compareChangePassports(store, repository.id, before.nodeId, after.nodeId);
      expect(comparison.addedEvidenceIds.length).toBeGreaterThan(0);
      expect(comparison.beforeStatus).toBe('PASS');
      expect(comparison.afterStatus).toBe('PARTIAL');
      expect('score' in comparison).toBe(false);
    } finally {
      database.close();
    }
  });
});
