import type { JsonValue } from './canonical.js';
import type { EvidenceInput } from './schemas.js';
import type { EdgeType, LedgerEntityKind, LedgerOp, NodeType } from './vocabulary.js';

export interface RepositoryRecord {
  id: string;
  key: string;
  displayName: string;
  createdAt: string;
}

/** Evidence as stored. Immutable: corrections are new records that `supersedes` an older one. */
export interface EvidenceRecord extends EvidenceInput {
  id: string;
  recordedAt: string;
}

/** One version of a node. The latest non-retired version is the node's current state. */
export interface NodeRecord {
  id: string;
  repositoryId: string;
  type: NodeType;
  key: string;
  version: number;
  attrs: Record<string, JsonValue>;
  /** Commit from which this version applies, when known. */
  validFromCommit: string | null;
  /** `validFromCommit` of the next version, when there is one and it has a commit. */
  validToCommit: string | null;
  sourceEvidenceId: string;
  recordedAt: string;
  /** True for a tombstone version that retires the node. */
  deleted: boolean;
}

export interface EdgeRecord {
  id: string;
  repositoryId: string;
  type: EdgeType;
  fromId: string;
  toId: string;
  version: number;
  attrs: Record<string, JsonValue>;
  /** Parser confidence in [0, 1], or null when not produced by a parser. */
  confidence: number | null;
  validFromCommit: string | null;
  validToCommit: string | null;
  sourceEvidenceId: string;
  recordedAt: string;
  deleted: boolean;
}

export interface LedgerEntry {
  repositoryId: string;
  seq: number;
  ts: string;
  op: LedgerOp;
  entityKind: LedgerEntityKind;
  entityId: string;
  payloadHash: string;
  prevHash: string;
  hash: string;
}

/** Result of a write that may be a no-op because identical data already exists. */
export interface WriteResult<T> {
  record: T;
  /** False when the call changed nothing because an identical record already existed. */
  changed: boolean;
}

export interface IntegrityProblem {
  code:
    | 'LEDGER_GAP'
    | 'LEDGER_PREV_HASH_MISMATCH'
    | 'LEDGER_HASH_MISMATCH'
    | 'PAYLOAD_MISMATCH'
    | 'EVIDENCE_ID_MISMATCH'
    | 'ATTRS_HASH_MISMATCH'
    | 'MISSING_LEDGER_ENTRY'
    | 'MISSING_ENTITY';
  message: string;
  seq?: number;
  entityId?: string;
}

export interface IntegrityReport {
  repositoryId: string;
  ok: boolean;
  ledgerEntriesChecked: number;
  problems: IntegrityProblem[];
}
