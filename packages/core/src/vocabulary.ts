export const NODE_TYPES = [
  'Repository',
  'File',
  'Symbol',
  'Function',
  'Class',
  'Module',
  'Dependency',
  'Commit',
  'PullRequest',
  'Issue',
  'Decision',
  'Documentation',
  'Test',
  'TestRun',
  'CIWorkflow',
  'Environment',
  'Build',
  'Artifact',
  'Firmware',
  'HardwareDevice',
  'TelemetrySession',
  'Finding',
  'ChangePassport',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = [
  'IMPORTS',
  'CALLS',
  'DEPENDS_ON',
  'MODIFIES',
  'TESTS',
  'BUILDS',
  'RUNS_IN',
  'OBSERVED_ON',
  'INTRODUCES',
  'FIXES',
  'DOCUMENTS',
  'SUPERSEDES',
  'AFFECTS',
  'VERIFIED_BY',
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export const EVIDENCE_STATUSES = ['PASS', 'FAIL', 'PARTIAL', 'NOT_MEASURED', 'INCOMPLETE'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EVIDENCE_SOURCE_TYPES = [
  'git',
  'coverage',
  'test-report',
  'ci',
  'environment',
  'build',
  'telemetry',
  'parser',
  'manual',
  'ai-note',
] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

/** Operations recorded in the hash-chained ledger. */
export const LEDGER_OPS = [
  'repository.register',
  'evidence.append',
  'node.version',
  'edge.version',
] as const;
export type LedgerOp = (typeof LEDGER_OPS)[number];

export type LedgerEntityKind = 'repository' | 'evidence' | 'node_version' | 'edge_version';

/** Hard limits that bound every stored value. */
export const LIMITS = {
  maxKeyLength: 1024,
  maxSourceLength: 512,
  maxAttrsBytes: 64 * 1024,
  maxLimitations: 50,
  maxLimitationLength: 1000,
  maxRelatedEntities: 1000,
} as const;
