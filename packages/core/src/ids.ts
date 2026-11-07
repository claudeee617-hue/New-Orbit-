import { hashValue } from './canonical.js';
import type { EdgeType, NodeType } from './vocabulary.js';

/**
 * Identifiers are derived from content, never random, so the same input always produces the same
 * ID. That is what makes graphs reproducible and re-ingestion idempotent.
 * Each ID is a short prefix plus 128 bits of a SHA-256 digest.
 */
function short(value: unknown): string {
  return hashValue(value).slice(0, 32);
}

export function repositoryIdFor(key: string): string {
  return `r_${short(['repository', key])}`;
}

export function nodeIdFor(repositoryId: string, type: NodeType, key: string): string {
  return `n_${short(['node', repositoryId, type, key])}`;
}

export function edgeIdFor(
  repositoryId: string,
  type: EdgeType,
  fromId: string,
  toId: string,
): string {
  return `e_${short(['edge', repositoryId, type, fromId, toId])}`;
}

/** Evidence IDs are derived from every identifying field of the (normalised) evidence input. */
export function evidenceIdFor(normalisedEvidence: object): string {
  return `ev_${short(['evidence', normalisedEvidence])}`;
}
