import { nodeIdFor, type JsonValue } from '@orbit/core';
import type { GraphStore } from '@orbit/database';
import { traverse } from '@orbit/graph';
import type { ChangePassport, ChangePassportInput, PassportEvidence } from './passport.js';
import { createGraphValidatedChangePassport } from './passport.js';
import { normalizeRepoPath } from './verification.js';

export interface PassportDimension {
  dimension: 'diff' | 'coverage' | 'tests' | 'ci' | 'environment' | 'build' | 'hardware';
  status: 'PRESENT' | 'PARTIAL' | 'MISSING' | 'NOT_APPLICABLE';
  rule: string;
  evidenceIds: string[];
}

export interface PassportImpact {
  changedFiles: string[];
  affectedFiles: string[];
  relatedTests: string[];
  affectedModules: string[];
  nodeIds: string[];
  edgeIds: string[];
  truncated: boolean;
}

export interface PassportRecordInput extends ChangePassportInput {
  repositoryId: string;
  /** Optional explicit evidence IDs; all repository evidence for commitSha is also considered. */
  evidenceIds?: string[];
}

export interface PersistedPassport {
  passport: ChangePassport;
  nodeId: string;
  evidenceId: string;
  version: number;
  impact: PassportImpact;
  dimensions: PassportDimension[];
}

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined;
}

function mapEvidenceKind(sourceType: string): PassportEvidence['kind'] {
  if (sourceType === 'git') return 'git';
  if (sourceType === 'coverage') return 'coverage';
  if (sourceType === 'test-report') return 'test-report';
  if (sourceType === 'ci') return 'ci';
  if (sourceType === 'environment') return 'environment';
  if (sourceType === 'build') return 'build';
  if (sourceType === 'telemetry') return 'telemetry';
  return 'manual';
}

function collectEvidence(
  store: GraphStore,
  repositoryId: string,
  input: PassportRecordInput,
  changedFileIds: string[],
): PassportEvidence[] {
  const records = new Map<string, ReturnType<GraphStore['evidence']['get']>>();
  for (const item of store.evidence.list(repositoryId, {
    commitSha: input.commitSha,
    limit: 10_000,
  })) {
    if (!item.source.startsWith('change-passport:')) records.set(item.id, item);
  }
  for (const entityId of changedFileIds) {
    for (const item of store.evidence.forEntity(repositoryId, entityId)) {
      if (item.commitSha === input.commitSha.toLowerCase()) records.set(item.id, item);
    }
  }
  for (const id of input.evidenceIds ?? []) {
    const item = store.evidence.get(repositoryId, id);
    if (!item) throw new Error(`Evidence ${id} does not exist in the selected repository`);
    if (item.commitSha !== input.commitSha.toLowerCase()) {
      throw new Error(`Evidence ${id} is not scoped to commit ${input.commitSha}`);
    }
    records.set(item.id, item);
  }
  for (const supplied of input.evidence ?? []) {
    const item = store.evidence.get(repositoryId, supplied.id);
    if (
      !item ||
      item.commitSha !== input.commitSha.toLowerCase() ||
      item.contentHash !== supplied.sha256?.toLowerCase() ||
      item.source !== supplied.source ||
      item.status !== supplied.status
    ) {
      throw new Error(
        `Supplied evidence ${supplied.id} does not match an immutable stored evidence record for this commit`,
      );
    }
    records.set(item.id, item);
  }
  const mapped: PassportEvidence[] = [...records.values()]
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({
      id: item.id,
      kind: mapEvidenceKind(item.sourceType),
      status: item.status,
      source: item.source,
      sha256: item.contentHash,
      limitations: item.limitations,
    }));
  return mapped.sort((a, b) => a.id.localeCompare(b.id));
}

function computeImpact(
  store: GraphStore,
  repositoryId: string,
  changedFiles: string[],
): PassportImpact {
  const affectedFiles = new Set(changedFiles);
  const relatedTests = new Set<string>();
  const affectedModules = new Set<string>();
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  let truncated = false;
  const MAX_IMPACT_NODES = 5000;
  const MAX_IMPACT_EDGES = 10_000;
  for (const path of [...new Set(changedFiles)].sort()) {
    if (nodeIds.size >= MAX_IMPACT_NODES) {
      truncated = true;
      break;
    }
    const fileId = nodeIdFor(repositoryId, 'File', path);
    const file = store.nodes.get(repositoryId, fileId);
    if (!file) continue;
    nodeIds.add(file.id);
    const impactEdges = store.edges.list(repositoryId, { fromId: file.id, limit: 100 });
    for (const edge of impactEdges) {
      if (edgeIds.size < MAX_IMPACT_EDGES) edgeIds.add(edge.id);
      else truncated = true;
    }
    const module = asString(file.attrs['module']);
    if (module && affectedModules.size < 1000) affectedModules.add(module);
    const remaining = Math.max(1, MAX_IMPACT_NODES - nodeIds.size);
    const walk = traverse(store, repositoryId, file.id, {
      direction: 'in',
      types: ['IMPORTS'],
      maxDepth: 10,
      maxNodes: Math.min(100, remaining),
    });
    truncated ||= walk.truncated;
    for (const item of walk.nodes) {
      if (item.node.type === 'File') {
        if (affectedFiles.size < MAX_IMPACT_NODES) affectedFiles.add(item.node.key);
        else truncated = true;
        if (nodeIds.size < MAX_IMPACT_NODES) nodeIds.add(item.node.id);
        else truncated = true;
      }
    }
    for (const edge of walk.edges) {
      if (edgeIds.size < MAX_IMPACT_EDGES) edgeIds.add(edge.id);
      else truncated = true;
    }
    if (relatedTests.size < MAX_IMPACT_NODES) {
      const tests = store.edges.list(repositoryId, { toId: file.id, types: ['TESTS'], limit: 100 });
      for (const edge of tests) {
        const test = store.nodes.get(repositoryId, edge.fromId);
        if (test) {
          if (relatedTests.size < MAX_IMPACT_NODES) relatedTests.add(test.key);
          else truncated = true;
          if (nodeIds.size < MAX_IMPACT_NODES) nodeIds.add(test.id);
          else truncated = true;
          if (edgeIds.size < MAX_IMPACT_EDGES) edgeIds.add(edge.id);
          else truncated = true;
        }
      }
    } else {
      truncated = true;
    }
  }
  return {
    changedFiles: [...new Set(changedFiles)].sort(),
    affectedFiles: [...affectedFiles].sort(),
    relatedTests: [...relatedTests].sort(),
    affectedModules: [...affectedModules].sort(),
    nodeIds: [...nodeIds].sort(),
    edgeIds: [...edgeIds].sort(),
    truncated,
  };
}

function dimension(
  name: PassportDimension['dimension'],
  evidence: PassportEvidence[],
  rule: string,
  required = false,
): PassportDimension {
  const related = evidence.filter((item) => {
    if (name === 'diff') return item.kind === 'git';
    if (name === 'coverage') return item.kind === 'coverage';
    if (name === 'tests') return item.kind === 'test-report';
    if (name === 'ci') return item.kind === 'ci';
    if (name === 'environment') return item.kind === 'environment';
    if (name === 'build') return item.kind === 'build';
    return item.kind === 'telemetry';
  });
  const partial = related.some(
    (item) =>
      item.status === 'PARTIAL' || item.status === 'INCOMPLETE' || item.status === 'NOT_MEASURED',
  );
  return {
    dimension: name,
    status:
      related.length === 0
        ? required
          ? 'MISSING'
          : 'NOT_APPLICABLE'
        : partial
          ? 'PARTIAL'
          : 'PRESENT',
    rule,
    evidenceIds: related.map((item) => item.id).sort(),
  };
}

function completeness(evidence: PassportEvidence[]): PassportDimension[] {
  return [
    dimension('diff', evidence, 'At least one Git/diff evidence record must be attached.', true),
    dimension(
      'coverage',
      evidence,
      'At least one coverage report must be attached; coverage status is separate from presence.',
      true,
    ),
    dimension(
      'tests',
      evidence,
      'At least one parsed test-report evidence record must be attached.',
      true,
    ),
    dimension('ci', evidence, 'At least one CI result evidence record must be attached.', true),
    dimension('environment', evidence, 'Environment snapshot is optional for a passport.', false),
    dimension(
      'build',
      evidence,
      'Build evidence is optional unless required by project policy.',
      false,
    ),
    dimension(
      'hardware',
      evidence,
      'Hardware telemetry is optional unless required by project policy.',
      false,
    ),
  ];
}

function isPassportNode(node: { type: string; attrs: Record<string, JsonValue> }): boolean {
  return node.type === 'ChangePassport' && node.attrs['producer'] === 'orbit-passport';
}

/**
 * Correlate evidence already stored in ORBIT with changed files and impacted graph facts.
 * It never manufactures evidence: unmatched dimensions remain MISSING or NOT_APPLICABLE.
 */
export function recordChangePassport(
  store: GraphStore,
  input: PassportRecordInput,
  options: { now?: () => string } = {},
): PersistedPassport {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Passport record input must be an object');
  if (typeof input.repositoryId !== 'string' || !input.repositoryId.trim())
    throw new Error('repositoryId is required');
  if (typeof input.repository !== 'string' || !input.repository.trim())
    throw new Error('repository is required');
  if (typeof input.commitSha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(input.commitSha))
    throw new Error('commit SHA is invalid');
  if (typeof input.diffSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(input.diffSha256))
    throw new Error('diff SHA-256 is invalid');
  if (
    !Array.isArray(input.changedFiles) ||
    input.changedFiles.length > 1000 ||
    input.changedFiles.some((path) => typeof path !== 'string')
  )
    throw new Error('changedFiles must be an array of at most 1000 paths');
  if (!Array.isArray(input.evidence)) throw new Error('evidence must be an array');
  if (input.evidence.length > 500) throw new Error('at most 500 evidence records can be supplied');
  if (
    input.evidenceIds !== undefined &&
    (!Array.isArray(input.evidenceIds) ||
      input.evidenceIds.length > 500 ||
      input.evidenceIds.some((id) => typeof id !== 'string' || !id.trim()))
  )
    throw new Error('evidenceIds must contain at most 500 non-empty strings');
  if (
    input.evidence.some(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        typeof item.id !== 'string' ||
        typeof item.sha256 !== 'string' ||
        typeof item.source !== 'string' ||
        typeof item.status !== 'string',
    )
  )
    throw new Error('supplied evidence references must include ID, SHA-256, source and status');
  const repository = store.repositories.get(input.repositoryId);
  if (!repository) throw new Error('repository is not registered');
  if (input.repository !== repository.key && input.repository !== repository.id) {
    throw new Error('passport repository must match the selected graph repository key or ID');
  }
  if (!/^[0-9a-f]{7,64}$/i.test(input.commitSha)) throw new Error('commit SHA is invalid');
  const canonicalInput = { ...input, commitSha: input.commitSha.toLowerCase() };
  const changedFiles = [...new Set(input.changedFiles.map(normalizeRepoPath))].sort();
  const impact = computeImpact(store, input.repositoryId, changedFiles);
  const evidence = collectEvidence(
    store,
    input.repositoryId,
    canonicalInput,
    impact.nodeIds.filter((id) => store.nodes.get(input.repositoryId, id)?.type === 'File'),
  );
  const dimensions = completeness(evidence);
  const missing = dimensions.filter((item) => item.status === 'MISSING');
  const suppliedPassport = createGraphValidatedChangePassport(
    {
      ...canonicalInput,
      repository: repository.key,
      evidence,
      changedFiles,
      impact: {
        changedFiles: impact.changedFiles,
        affectedFiles: impact.affectedFiles,
        relatedTests: impact.relatedTests,
        affectedModules: impact.affectedModules,
        nodeIds: impact.nodeIds,
        edgeIds: impact.edgeIds,
        truncated: impact.truncated,
      },
      completeness: dimensions,
    },
    options,
  );

  const verificationStatus = suppliedPassport.verificationStatus;
  const passportNodeId = nodeIdFor(
    input.repositoryId,
    'ChangePassport',
    `passport:${suppliedPassport.commitSha}:${suppliedPassport.diffSha256}`,
  );
  return store.transaction(() => {
    const passportEvidence = store.evidence.append({
      repositoryId: input.repositoryId,
      source: `change-passport:${suppliedPassport.id}`,
      sourceType: 'manual',
      commitSha: suppliedPassport.commitSha,
      contentHash: suppliedPassport.contentSha256,
      status: verificationStatus,
      limitations: [
        'A Change Passport is a traceable evidence summary, not a correctness guarantee or certification.',
        'Completeness dimensions describe evidence presence and parser completeness; they are not a quality score.',
        ...(impact.truncated ? ['Impact traversal reached its configured 1,000-node limit.'] : []),
        ...(missing.length
          ? [
              `Missing required evidence dimensions: ${missing.map((item) => item.dimension).join(', ')}.`,
            ]
          : []),
      ],
      relatedEntityIds: [passportNodeId, ...impact.nodeIds, ...impact.edgeIds].slice(0, 1000),
    });

    const saved = store.nodes.upsert({
      repositoryId: input.repositoryId,
      type: 'ChangePassport',
      key: `passport:${suppliedPassport.commitSha}:${suppliedPassport.diffSha256}`,
      attrs: {
        producer: 'orbit-passport',
        schemaVersion: 1,
        passportId: suppliedPassport.id,
        commitSha: suppliedPassport.commitSha,
        baseSha: suppliedPassport.baseSha,
        diffSha256: suppliedPassport.diffSha256,
        contentSha256: suppliedPassport.contentSha256,
        state: suppliedPassport.state,
        verificationStatus,
        evidenceVerification: suppliedPassport.evidenceVerification,
        missingEvidence: suppliedPassport.missingEvidence,
        completeness: dimensions as unknown as JsonValue,
        impact: {
          changedFiles: impact.changedFiles.slice(0, 50).map((value) => value.slice(0, 256)),
          affectedFiles: impact.affectedFiles.slice(0, 50).map((value) => value.slice(0, 256)),
          relatedTests: impact.relatedTests.slice(0, 50).map((value) => value.slice(0, 256)),
          affectedModules: impact.affectedModules.slice(0, 50).map((value) => value.slice(0, 256)),
          nodeIds: impact.nodeIds.slice(0, 100),
          edgeIds: impact.edgeIds.slice(0, 100),
          truncated:
            impact.truncated ||
            impact.changedFiles.length > 50 ||
            impact.affectedFiles.length > 50 ||
            impact.relatedTests.length > 50 ||
            impact.affectedModules.length > 50 ||
            impact.nodeIds.length > 100 ||
            impact.edgeIds.length > 100,
        } as unknown as JsonValue,
        evidence: suppliedPassport.evidence.slice(0, 100).map((item) => ({
          id: item.id,
          kind: item.kind,
          status: item.status,
          source: item.source.slice(0, 256),
          ...(item.sha256 ? { sha256: item.sha256 } : {}),
        })) as unknown as JsonValue,
        findings: suppliedPassport.findings.slice(0, 50).map((item) => ({
          id: item.id,
          severity: item.severity,
          message: item.message.slice(0, 300),
          ...(item.path ? { path: item.path.slice(0, 256) } : {}),
          ...(item.lines ? { lines: item.lines.slice(0, 50) } : {}),
        })) as unknown as JsonValue,
        environmentFingerprint: suppliedPassport.environmentFingerprint,
        firmwareBuildId: suppliedPassport.firmwareBuildId,
        telemetrySessionSha256: suppliedPassport.telemetrySessionSha256,
        limitations: suppliedPassport.limitations,
      },
      sourceEvidenceId: passportEvidence.record.id,
      validFromCommit: suppliedPassport.commitSha,
    });

    for (const path of impact.changedFiles) {
      const fileId = nodeIdFor(input.repositoryId, 'File', path);
      if (store.nodes.get(input.repositoryId, fileId)) {
        store.edges.upsert({
          repositoryId: input.repositoryId,
          type: 'AFFECTS',
          fromId: saved.record.id,
          toId: fileId,
          attrs: { role: 'changed-file', path },
          sourceEvidenceId: passportEvidence.record.id,
          validFromCommit: suppliedPassport.commitSha,
        });
      }
    }
    for (const path of impact.relatedTests) {
      const testId = nodeIdFor(input.repositoryId, 'Test', path);
      if (store.nodes.get(input.repositoryId, testId)) {
        store.edges.upsert({
          repositoryId: input.repositoryId,
          type: 'AFFECTS',
          fromId: saved.record.id,
          toId: testId,
          attrs: { role: 'related-test', path },
          sourceEvidenceId: passportEvidence.record.id,
          validFromCommit: suppliedPassport.commitSha,
        });
      }
    }
    for (const item of evidence) {
      const telemetryNodeId = nodeIdFor(
        input.repositoryId,
        'TelemetrySession',
        `telemetry:${item.sha256 ?? ''}`,
      );
      if (item.kind === 'telemetry' && store.nodes.get(input.repositoryId, telemetryNodeId)) {
        store.edges.upsert({
          repositoryId: input.repositoryId,
          type: 'VERIFIED_BY',
          fromId: saved.record.id,
          toId: telemetryNodeId,
          attrs: { evidenceId: item.id, role: 'observational-telemetry' },
          sourceEvidenceId: passportEvidence.record.id,
        });
      }
    }

    return {
      passport: { ...suppliedPassport, completeness: dimensions, impact } as ChangePassport,
      nodeId: saved.record.id,
      evidenceId: passportEvidence.record.id,
      version: saved.record.version,
      impact,
      dimensions,
    };
  });
}

export interface PassportVersionSummary {
  version: number;
  recordedAt: string;
  commitSha: string | null;
  contentSha256: string | null;
  state: string | null;
  verificationStatus: string | null;
  changed: boolean;
}

export function getPassportHistory(
  store: GraphStore,
  repositoryId: string,
  passportNodeId: string,
): PassportVersionSummary[] {
  const current = store.nodes.get(repositoryId, passportNodeId);
  if (!current || !isPassportNode(current)) throw new Error('Change Passport does not exist');
  return store.nodes.history(repositoryId, passportNodeId).map((item) => ({
    version: item.version,
    recordedAt: item.recordedAt,
    commitSha: asString(item.attrs['commitSha']) ?? null,
    contentSha256: asString(item.attrs['contentSha256']) ?? null,
    state: asString(item.attrs['state']) ?? null,
    verificationStatus: asString(item.attrs['verificationStatus']) ?? null,
    changed: item.version > 1,
  }));
}

export interface PassportComparison {
  beforeNodeId: string;
  afterNodeId: string;
  changedEvidenceIds: string[];
  addedEvidenceIds: string[];
  removedEvidenceIds: string[];
  changedFiles: { added: string[]; removed: string[] };
  changedFindings: { added: string[]; removed: string[] };
  completenessChanges: Array<{ dimension: string; before: string; after: string }>;
  beforeStatus: string;
  afterStatus: string;
}

export function compareChangePassports(
  store: GraphStore,
  repositoryId: string,
  beforeNodeId: string,
  afterNodeId: string,
): PassportComparison {
  const before = store.nodes.get(repositoryId, beforeNodeId);
  const after = store.nodes.get(repositoryId, afterNodeId);
  if (!before || !isPassportNode(before) || !after || !isPassportNode(after)) {
    throw new Error('both passport IDs must identify current Change Passports in this repository');
  }
  const beforeAttrs = before.attrs;
  const afterAttrs = after.attrs;
  const beforeEvidence = new Set(
    (Array.isArray(beforeAttrs['evidence'])
      ? (beforeAttrs['evidence'] as unknown as PassportEvidence[])
      : []
    ).map((item) => item.id),
  );
  const afterEvidence = new Set(
    (Array.isArray(afterAttrs['evidence'])
      ? (afterAttrs['evidence'] as unknown as PassportEvidence[])
      : []
    ).map((item) => item.id),
  );
  const beforeFiles = new Set(
    Array.isArray((asRecord(beforeAttrs['impact']) ?? {})['changedFiles'])
      ? ((asRecord(beforeAttrs['impact']) ?? {})['changedFiles'] as string[])
      : [],
  );
  const afterFiles = new Set(
    Array.isArray((asRecord(afterAttrs['impact']) ?? {})['changedFiles'])
      ? ((asRecord(afterAttrs['impact']) ?? {})['changedFiles'] as string[])
      : [],
  );
  const beforeFindings = new Set(
    (Array.isArray(beforeAttrs['findings'])
      ? (beforeAttrs['findings'] as unknown as Array<{ id: string }>)
      : []
    ).map((item) => item.id),
  );
  const afterFindings = new Set(
    (Array.isArray(afterAttrs['findings'])
      ? (afterAttrs['findings'] as unknown as Array<{ id: string }>)
      : []
    ).map((item) => item.id),
  );
  const beforeDimensions = Array.isArray(beforeAttrs['completeness'])
    ? (beforeAttrs['completeness'] as unknown as PassportDimension[])
    : [];
  const afterDimensions = Array.isArray(afterAttrs['completeness'])
    ? (afterAttrs['completeness'] as unknown as PassportDimension[])
    : [];
  const beforeDimensionMap = new Map(beforeDimensions.map((item) => [item.dimension, item.status]));
  const completenessChanges = afterDimensions
    .filter((item) => beforeDimensionMap.get(item.dimension) !== item.status)
    .map((item) => ({
      dimension: item.dimension,
      before: beforeDimensionMap.get(item.dimension) ?? 'MISSING',
      after: item.status,
    }));

  const addedEvidenceIds = [...afterEvidence].filter((id) => !beforeEvidence.has(id)).sort();
  const removedEvidenceIds = [...beforeEvidence].filter((id) => !afterEvidence.has(id)).sort();
  const addedFiles = [...afterFiles].filter((value) => !beforeFiles.has(value)).sort();
  const removedFiles = [...beforeFiles].filter((value) => !afterFiles.has(value)).sort();
  const addedFindings = [...afterFindings].filter((id) => !beforeFindings.has(id)).sort();
  const removedFindings = [...beforeFindings].filter((id) => !afterFindings.has(id)).sort();
  return {
    beforeNodeId,
    afterNodeId,
    changedEvidenceIds:
      addedEvidenceIds.length || removedEvidenceIds.length
        ? [...addedEvidenceIds, ...removedEvidenceIds]
        : [],
    addedEvidenceIds,
    removedEvidenceIds,
    changedFiles: { added: addedFiles, removed: removedFiles },
    changedFindings: { added: addedFindings, removed: removedFindings },
    completenessChanges,
    beforeStatus: asString(beforeAttrs['verificationStatus']) ?? 'NOT_MEASURED',
    afterStatus: asString(afterAttrs['verificationStatus']) ?? 'NOT_MEASURED',
  };
}

export interface ReproductionStep {
  id: string;
  title: string;
  purpose: string;
  command: string | null;
  automaticExecution: false;
  evidenceRequired: string[];
}

export interface ReproductionPlan {
  schemaVersion: 1;
  passportNodeId: string;
  commitSha: string;
  steps: ReproductionStep[];
  missingInputs: string[];
  limitations: string[];
}

/** A human-readable plan only. No build, test, package manager or hardware command is executed. */
export function createReproductionPlan(
  store: GraphStore,
  repositoryId: string,
  passportNodeId: string,
): ReproductionPlan {
  const node = store.nodes.get(repositoryId, passportNodeId);
  if (!node || !isPassportNode(node)) throw new Error('Change Passport does not exist');
  const attrs = node.attrs;
  const evidence = Array.isArray(attrs['evidence'])
    ? (attrs['evidence'] as unknown as PassportEvidence[])
    : [];
  const missing = Array.isArray(attrs['missingEvidence'])
    ? (attrs['missingEvidence'] as string[])
    : [];
  const commitSha = asString(attrs['commitSha']) ?? '';
  const environmentFingerprint = asString(attrs['environmentFingerprint']);
  const steps: ReproductionStep[] = [
    {
      id: 'checkout',
      title: 'Check out the recorded commit',
      purpose: 'Recreate the source revision represented by the passport.',
      command: commitSha ? `git checkout --detach ${commitSha}` : null,
      automaticExecution: false,
      evidenceRequired: ['git commit object'],
    },
    {
      id: 'environment',
      title: 'Inspect the declared environment',
      purpose: environmentFingerprint
        ? `Compare the current manifest fingerprint with ${environmentFingerprint}.`
        : 'Capture a fresh CAPSULE manifest snapshot; this passport contains no environment fingerprint.',
      command: 'orbit capsule inspect . --out capsule.json',
      automaticExecution: false,
      evidenceRequired: ['CAPSULE manifest snapshot'],
    },
    {
      id: 'tests',
      title: 'Re-run the recorded test suite',
      purpose:
        'Run project-approved test commands and attach the resulting report; the passport does not imply that commands were executed.',
      command: null,
      automaticExecution: false,
      evidenceRequired: ['test report', 'CI result'],
    },
  ];
  if (evidence.some((item) => item.kind === 'telemetry') || asString(attrs['firmwareBuildId'])) {
    steps.push({
      id: 'hardware',
      title: 'Replay the linked device recording',
      purpose:
        'Use the original hashed telemetry artifact; do not connect to or control a physical device as part of replay.',
      command: 'orbit device replay <recorded-log> --format ndjson',
      automaticExecution: false,
      evidenceRequired: ['original telemetry artifact', 'firmware build identifier'],
    });
  } else {
    missing.push('No linked firmware/device session is recorded.');
  }
  return {
    schemaVersion: 1,
    passportNodeId,
    commitSha,
    steps,
    missingInputs: [...new Set(missing)].sort(),
    limitations: [
      'This is a proposed human-run reproduction plan; ORBIT does not execute any command.',
      'Commands are examples and must be reviewed against the repository instructions before use.',
      'Reproducing an environment from manifest declarations does not guarantee byte-identical builds.',
    ],
  };
}
