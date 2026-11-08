import { OrbitError } from '@orbit/shared';
import { snippet, tokenize } from './text.js';
import {
  MEMORY_LIMITS,
  type MemoryAuthority,
  type MemoryCategory,
  type MemoryItem,
} from './types.js';

export interface MemorySearchQuery {
  /** Free text. Empty or omitted lists items instead of ranking them. */
  text?: string;
  categories?: readonly MemoryCategory[];
  authorities?: readonly MemoryAuthority[];
  tag?: string;
  /** Only items that cite this file path. */
  path?: string;
  /** Include invalidated items (default false). */
  includeInvalidated?: boolean;
  /** Only items a person or a repository document stands behind (excludes AI suggestions). */
  authoritativeOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface MemoryHit {
  item: MemoryItem;
  score: number;
  /** Which fields matched, e.g. ["title", "body"]. */
  matched: string[];
  snippet: string;
}

export interface MemorySearchResult {
  hits: MemoryHit[];
  /** Matches before paging. */
  total: number;
  truncated: boolean;
  /** AI suggestions left out because `authoritativeOnly` was set. */
  hiddenUnverified: number;
}

const FIELD_WEIGHTS = { title: 5, topic: 4, tags: 3, choice: 3, body: 1, path: 1 } as const;

/**
 * Rank memory items by term overlap. Pure and deterministic: ties break on the item id, so the
 * same store and query always give the same list. Memory sets are small enough that an in-process
 * scan beats maintaining a full-text index (revisit if a workspace holds tens of thousands).
 */
export function searchMemory(
  items: readonly MemoryItem[],
  query: MemorySearchQuery,
): MemorySearchResult {
  const limit = query.limit ?? MEMORY_LIMITS.defaultResults;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MEMORY_LIMITS.maxResults) {
    throw new OrbitError(
      'INVALID_INPUT',
      `limit must be an integer from 1 to ${MEMORY_LIMITS.maxResults}`,
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new OrbitError('INVALID_INPUT', 'offset must be a non-negative integer');
  }
  const terms = tokenize(query.text ?? '');
  const wanted = [...new Set(terms)];
  const tag = query.tag?.toLowerCase();

  let hiddenUnverified = 0;
  const candidates: MemoryHit[] = [];
  for (const item of items) {
    if (!query.includeInvalidated && item.status === 'invalidated') continue;
    if (query.categories && !query.categories.includes(item.category)) continue;
    if (query.authorities && !query.authorities.includes(item.authority)) continue;
    if (tag !== undefined && !item.tags.includes(tag)) continue;
    if (
      query.path !== undefined &&
      !item.sourceRefs.some((r) => r.kind === 'file' && r.path === query.path)
    )
      continue;
    if (query.authoritativeOnly && item.authority === 'ai-suggested') {
      hiddenUnverified += 1;
      continue;
    }
    if (wanted.length === 0) {
      candidates.push({ item, score: 0, matched: [], snippet: snippet(item.body, [], 200) });
      continue;
    }
    const fields: Record<keyof typeof FIELD_WEIGHTS, Set<string>> = {
      title: new Set(tokenize(item.title)),
      topic: new Set(tokenize(item.topic ?? '')),
      tags: new Set(item.tags.flatMap((t) => tokenize(t))),
      choice: new Set(tokenize(item.choice ?? '')),
      body: new Set(tokenize(item.body)),
      path: new Set(item.sourceRefs.flatMap((r) => (r.kind === 'file' ? tokenize(r.path) : []))),
    };
    let score = 0;
    const matched: string[] = [];
    for (const [field, tokens] of Object.entries(fields) as [
      keyof typeof FIELD_WEIGHTS,
      Set<string>,
    ][]) {
      const hits = wanted.filter((t) => tokens.has(t)).length;
      if (hits > 0) {
        score += hits * FIELD_WEIGHTS[field];
        matched.push(field);
      }
    }
    if (score === 0) continue;
    // Prefer items that cover more of the query, and trusted statements over unverified ones.
    const coverage =
      wanted.filter((t) => matched.some((f) => fields[f as keyof typeof FIELD_WEIGHTS].has(t)))
        .length / wanted.length;
    score = Math.round(score * (0.5 + coverage) * (item.authoritative ? 1.2 : 1) * 100) / 100;
    candidates.push({ item, score, matched, snippet: snippet(item.body, wanted, 240) });
  }
  candidates.sort(
    (a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0),
  );
  const page = candidates.slice(offset, offset + limit);
  return {
    hits: page,
    total: candidates.length,
    truncated: offset + page.length < candidates.length,
    hiddenUnverified,
  };
}
