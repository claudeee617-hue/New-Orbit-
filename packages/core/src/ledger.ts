import { hashValue } from './canonical.js';
import type { LedgerEntityKind, LedgerOp } from './vocabulary.js';

/** `prevHash` of the first entry in every repository's ledger chain. */
export const GENESIS_HASH = '0'.repeat(64);

export interface LedgerFields {
  repositoryId: string;
  seq: number;
  ts: string;
  op: LedgerOp;
  entityKind: LedgerEntityKind;
  entityId: string;
  payloadHash: string;
  prevHash: string;
}

/** Hash of one ledger entry. It covers the previous hash, so changing any past entry breaks the chain. */
export function computeLedgerHash(fields: LedgerFields): string {
  return hashValue({ ...fields });
}

export function repositoryPayloadHash(id: string, key: string): string {
  return hashValue({ kind: 'repository', id, key });
}

export interface NodeVersionPayload {
  nodeId: string;
  version: number;
  attrsHash: string;
  deleted: boolean;
  validFromCommit: string | null;
  evidenceId: string;
}

export function nodeVersionPayloadHash(payload: NodeVersionPayload): string {
  return hashValue({ kind: 'node_version', ...payload });
}

export interface EdgeVersionPayload extends NodeVersionPayload {
  confidence: number | null;
}

export function edgeVersionPayloadHash(payload: EdgeVersionPayload): string {
  return hashValue({ kind: 'edge_version', ...payload });
}
