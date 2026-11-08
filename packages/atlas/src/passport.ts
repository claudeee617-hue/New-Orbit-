import { createHash } from 'node:crypto';
import { normalizeRepoPath } from './verification.js';

export interface PassportEvidence {
  id: string;
  kind:
    'git' | 'coverage' | 'test-report' | 'ci' | 'environment' | 'build' | 'telemetry' | 'manual';
  status: 'PASS' | 'FAIL' | 'PARTIAL' | 'NOT_MEASURED' | 'INCOMPLETE';
  source: string;
  sha256?: string;
  limitations?: string[];
}

export interface PassportCompletenessDimension {
  dimension: 'diff' | 'coverage' | 'tests' | 'ci' | 'environment' | 'build' | 'hardware';
  status: 'PRESENT' | 'PARTIAL' | 'MISSING' | 'NOT_APPLICABLE';
  rule: string;
  evidenceIds: string[];
}

export interface PassportImpactSummary {
  changedFiles: string[];
  affectedFiles: string[];
  relatedTests: string[];
  affectedModules: string[];
  nodeIds: string[];
  edgeIds: string[];
  truncated: boolean;
}

export interface ChangePassportInput {
  repository: string;
  commitSha: string;
  baseSha?: string;
  diffSha256: string;
  changedFiles: string[];
  evidence: PassportEvidence[];
  findings?: Array<{
    id: string;
    severity: string;
    message: string;
    path?: string;
    lines?: number[];
  }>;
  environmentFingerprint?: string;
  firmwareBuildId?: string;
  telemetrySessionSha256?: string;
  /** Per-dimension, rule-based completeness. No aggregate score is calculated. */
  completeness?: PassportCompletenessDimension[];
  /** Bounded graph impact context already computed from the indexed repository. */
  impact?: PassportImpactSummary;
}

export interface ChangePassport {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  repository: string;
  commitSha: string;
  baseSha: string | null;
  diffSha256: string;
  changedFiles: string[];
  evidence: PassportEvidence[];
  findings: NonNullable<ChangePassportInput['findings']>;
  environmentFingerprint: string | null;
  firmwareBuildId: string | null;
  telemetrySessionSha256: string | null;
  state: 'COMPLETE' | 'PARTIAL';
  verificationStatus: 'PASS' | 'FAIL' | 'PARTIAL' | 'NOT_MEASURED';
  evidenceVerification: 'GRAPH_VALIDATED' | 'UNVERIFIED_INPUT';
  completeness: PassportCompletenessDimension[];
  impact: PassportImpactSummary | null;
  missingEvidence: string[];
  limitations: string[];
  contentSha256: string;
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

/** Assemble a passport from supplied facts. Missing evidence is explicit; no test result is inferred. */
export function createChangePassport(
  input: ChangePassportInput,
  options: {
    now?: () => string;
    evidenceVerification?: 'GRAPH_VALIDATED' | 'UNVERIFIED_INPUT';
  } = {},
): ChangePassport {
  if (!input.repository.trim()) throw new Error('repository is required');
  if (!/^[0-9a-f]{7,64}$/i.test(input.commitSha)) throw new Error('commitSha must be a Git SHA');
  if (!/^[0-9a-f]{64}$/i.test(input.diffSha256))
    throw new Error('diffSha256 must be a SHA-256 hash');
  if (input.evidence.length > 500) throw new Error('at most 500 evidence records can be included');
  if (input.changedFiles.length > 1000)
    throw new Error('at most 1000 changed files can be included');
  const seenEvidence = new Set<string>();
  for (const item of input.evidence) {
    if (!item.id.trim() || !item.source.trim())
      throw new Error('evidence id and source are required');
    if (seenEvidence.has(item.id)) throw new Error(`duplicate evidence ID: ${item.id}`);
    seenEvidence.add(item.id);
    if (
      ![
        'git',
        'coverage',
        'test-report',
        'ci',
        'environment',
        'build',
        'telemetry',
        'manual',
      ].includes(item.kind)
    )
      throw new Error(`evidence ${item.id} has an invalid kind`);
    if (!['PASS', 'FAIL', 'PARTIAL', 'NOT_MEASURED', 'INCOMPLETE'].includes(item.status))
      throw new Error(`evidence ${item.id} has an invalid status`);
    if (item.sha256 && !/^[0-9a-f]{64}$/i.test(item.sha256))
      throw new Error(`evidence ${item.id} has an invalid SHA-256 digest`);
  }
  if (input.baseSha && !/^[0-9a-f]{7,64}$/i.test(input.baseSha))
    throw new Error('baseSha must be a Git SHA');
  if (input.environmentFingerprint && !/^[0-9a-f]{64}$/i.test(input.environmentFingerprint)) {
    throw new Error('environmentFingerprint must be a SHA-256 hash');
  }
  if (input.telemetrySessionSha256 && !/^[0-9a-f]{64}$/i.test(input.telemetrySessionSha256)) {
    throw new Error('telemetrySessionSha256 must be a SHA-256 hash');
  }
  const evidence = [...input.evidence]
    .map((item) => ({
      ...item,
      ...(item.sha256 ? { sha256: item.sha256.toLowerCase() } : {}),
      source: item.source.slice(0, 512),
      limitations: item.limitations?.slice(0, 10).map((value) => value.slice(0, 500)),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const changedFiles = [...new Set(input.changedFiles.map(normalizeRepoPath))].sort();
  if (changedFiles.some((path) => path.length > 1024))
    throw new Error('changed file paths must not exceed 1024 characters');
  const findings = [...(input.findings ?? [])]
    .slice(0, 200)
    .map((item) => ({ ...item, message: item.message.slice(0, 1000) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const completeness =
    input.completeness ??
    (
      [
        ['diff', 'git', true],
        ['coverage', 'coverage', true],
        ['tests', 'test-report', true],
        ['ci', 'ci', true],
        ['environment', 'environment', false],
        ['build', 'build', false],
        ['hardware', 'telemetry', false],
      ] as const
    ).map(([dimension, kind, required]) => {
      const matching = evidence.filter((item) => item.kind === kind);
      const partial = matching.some(
        (item) =>
          item.status === 'PARTIAL' ||
          item.status === 'INCOMPLETE' ||
          item.status === 'NOT_MEASURED',
      );
      return {
        dimension,
        status:
          matching.length === 0
            ? required
              ? ('MISSING' as const)
              : ('NOT_APPLICABLE' as const)
            : partial
              ? ('PARTIAL' as const)
              : ('PRESENT' as const),
        rule: `Presence of ${kind} evidence; measurement outcome is reported separately.`,
        evidenceIds: matching.map((item) => item.id).sort(),
      };
    });
  if (completeness.length > 7) throw new Error('at most seven completeness dimensions are allowed');
  const seenDimensions = new Set<string>();
  for (const item of completeness) {
    if (seenDimensions.has(item.dimension))
      throw new Error(`duplicate completeness dimension: ${item.dimension}`);
    seenDimensions.add(item.dimension);
    if (!['PRESENT', 'PARTIAL', 'MISSING', 'NOT_APPLICABLE'].includes(item.status))
      throw new Error(`completeness dimension ${item.dimension} has an invalid status`);
    if (!item.rule.trim())
      throw new Error(`completeness dimension ${item.dimension} requires a rule`);
    if (item.evidenceIds.length > 500)
      throw new Error(
        `completeness dimension ${item.dimension} exceeds the evidence reference limit`,
      );
  }
  const requiredDimensions = new Set(['diff', 'coverage', 'tests', 'ci']);
  const missingEvidence = completeness
    .filter((item) => requiredDimensions.has(item.dimension) && item.status === 'MISSING')
    .map((item) => `No ${item.dimension} evidence attached`);
  const state = completeness.some(
    (item) => requiredDimensions.has(item.dimension) && item.status !== 'PRESENT',
  )
    ? ('PARTIAL' as const)
    : ('COMPLETE' as const);
  const evidenceVerification = options.evidenceVerification ?? 'UNVERIFIED_INPUT';
  const verificationStatus = evidence.some((item) => item.status === 'FAIL')
    ? ('FAIL' as const)
    : evidenceVerification !== 'GRAPH_VALIDATED' || missingEvidence.length > 0
      ? ('NOT_MEASURED' as const)
      : evidence.some(
            (item) =>
              item.status === 'PARTIAL' ||
              item.status === 'INCOMPLETE' ||
              item.status === 'NOT_MEASURED',
          )
        ? ('PARTIAL' as const)
        : ('PASS' as const);
  const createdAt = (options.now ?? (() => new Date().toISOString()))();
  if (!Number.isFinite(Date.parse(createdAt)))
    throw new Error('createdAt must be a valid timestamp');
  const unsigned = {
    schemaVersion: 1 as const,
    repository: input.repository,
    commitSha: input.commitSha,
    baseSha: input.baseSha ?? null,
    diffSha256: input.diffSha256,
    changedFiles,
    evidence,
    findings,
    environmentFingerprint: input.environmentFingerprint ?? null,
    firmwareBuildId: input.firmwareBuildId ?? null,
    telemetrySessionSha256: input.telemetrySessionSha256 ?? null,
    state,
    verificationStatus,
    evidenceVerification,
    completeness,
    impact: input.impact ?? null,
    missingEvidence,
    limitations: [
      'A passport records supplied evidence and does not independently prove software correctness.',
      'Evidence status is copied from its source; absent evidence is listed as missing, not assumed to pass.',
      'Hardware observations are associated only when an explicit firmware build or telemetry reference is supplied.',
    ],
  };
  const contentSha256 = createHash('sha256').update(stableJson(unsigned)).digest('hex');
  const id = `cp_${createHash('sha256').update(`${input.repository}\0${input.commitSha}\0${input.diffSha256}`).digest('hex').slice(0, 20)}`;
  return { ...unsigned, id, createdAt, contentSha256 };
}
