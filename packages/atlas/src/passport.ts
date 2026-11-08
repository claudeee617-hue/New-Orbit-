import { createHash } from 'node:crypto';

export interface PassportEvidence {
  id: string;
  kind:
    'git' | 'coverage' | 'test-report' | 'ci' | 'environment' | 'build' | 'telemetry' | 'manual';
  status: 'PASS' | 'FAIL' | 'PARTIAL' | 'NOT_MEASURED' | 'INCOMPLETE';
  source: string;
  sha256?: string;
  limitations?: string[];
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
  missingEvidence: string[];
  limitations: string[];
  contentSha256: string;
}

function stableJson(value: unknown): string {
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
  options: { now?: () => string } = {},
): ChangePassport {
  if (!input.repository.trim()) throw new Error('repository is required');
  if (!/^[0-9a-f]{7,64}$/i.test(input.commitSha)) throw new Error('commitSha must be a Git SHA');
  if (!/^[0-9a-f]{64}$/i.test(input.diffSha256))
    throw new Error('diffSha256 must be a SHA-256 hash');
  const evidence = [...input.evidence].sort((a, b) => a.id.localeCompare(b.id));
  const changedFiles = [...new Set(input.changedFiles)].sort();
  const findings = [...(input.findings ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const kinds = new Set(evidence.map((item) => item.kind));
  const missingEvidence = (['git', 'coverage', 'test-report', 'ci'] as const)
    .filter((kind) => !kinds.has(kind))
    .map((kind) => `No ${kind} evidence attached`);
  const createdAt = (options.now ?? (() => new Date().toISOString()))();
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
    state: missingEvidence.length === 0 ? ('COMPLETE' as const) : ('PARTIAL' as const),
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
