import {
  canonicalJson,
  hashArtifact,
  nodeIdFor,
  type JsonValue,
  type NodeRecord,
} from '@orbit/core';
import type { GraphStore } from '@orbit/database';
import { z } from 'zod';
import { normalizeRepoPath } from './verification.js';

const MAX_BODY_CHARS = 20_000;
const MAX_QUERY_CHARS = 500;
const MAX_SEARCH_LIMIT = 50;

export const MEMORY_KINDS = [
  'architecture',
  'decision',
  'convention',
  'workflow',
  'risk',
  'fact',
  'document',
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

const sourceRefSchema = z.strictObject({
  path: z.string().min(1).max(1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  title: z.string().max(256).optional(),
});

const memoryInputSchema = z.strictObject({
  repositoryId: z.string().min(1).max(256),
  key: z.string().min(1).max(1024),
  kind: z.enum(MEMORY_KINDS),
  title: z.string().min(1).max(256),
  summary: z.string().min(1).max(2000),
  decisionStatus: z.string().max(64).optional(),
  content: z.string().max(MAX_BODY_CHARS).optional(),
  tags: z.array(z.string().min(1).max(64)).max(30).default([]),
  topic: z.string().max(256).optional(),
  sourceRefs: z.array(sourceRefSchema).max(30).default([]),
  commitSha: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/i)
    .optional(),
  supersedes: z.array(z.string().min(1).max(1024)).max(20).default([]),
  conflictsWith: z.array(z.string().min(1).max(1024)).max(20).default([]),
});
export type MemoryInput = z.input<typeof memoryInputSchema>;

export interface MemoryRecord {
  id: string;
  repositoryId: string;
  key: string;
  kind: MemoryKind;
  title: string;
  summary: string;
  decisionStatus: string | null;
  content: string;
  tags: string[];
  topic: string | null;
  sourceRefs: { path: string; sha256: string; title?: string }[];
  commitSha: string | null;
  supersedes: string[];
  conflictsWith: string[];
  version: number;
  recordedAt: string;
  evidenceId: string;
  stale: 'unknown' | 'current' | 'stale';
}

export interface MemorySearchOptions {
  query?: string;
  kind?: MemoryKind;
  tags?: string[];
  limit?: number;
  currentSources?: { path: string; sha256: string }[];
}

function nodeTypeFor(kind: MemoryKind): 'Decision' | 'Documentation' {
  return kind === 'decision' ? 'Decision' : 'Documentation';
}

function asString(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}
function asStrings(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
function sourceRefsOf(value: JsonValue | undefined): MemoryRecord['sourceRefs'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const path = item['path'];
    const sha256 = item['sha256'];
    const title = item['title'];
    if (typeof path !== 'string' || typeof sha256 !== 'string') return [];
    return [{ path, sha256, ...(typeof title === 'string' ? { title } : {}) }];
  });
}

function toMemory(node: NodeRecord, currentSources?: Map<string, string>): MemoryRecord {
  const attrs = node.attrs;
  const sourceRefs = sourceRefsOf(attrs['sourceRefs']);
  let stale: MemoryRecord['stale'] = 'unknown';
  if (currentSources && sourceRefs.length > 0) {
    const compared = sourceRefs.filter((ref) => currentSources.has(ref.path));
    stale = compared.some((ref) => currentSources.get(ref.path) !== ref.sha256)
      ? 'stale'
      : compared.length === sourceRefs.length
        ? 'current'
        : 'unknown';
  }
  const kind = asString(attrs['memoryKind']);
  return {
    id: node.id,
    repositoryId: node.repositoryId,
    key: node.key,
    kind: MEMORY_KINDS.includes(kind as MemoryKind) ? (kind as MemoryKind) : 'fact',
    title: asString(attrs['title']),
    summary: asString(attrs['summary']),
    decisionStatus: asString(attrs['decisionStatus']) || null,
    content: asString(attrs['content']),
    tags: asStrings(attrs['tags']),
    topic: asString(attrs['topic']) || null,
    sourceRefs,
    commitSha: node.validFromCommit,
    supersedes: asStrings(attrs['supersedes']),
    conflictsWith: asStrings(attrs['conflictsWith']),
    version: node.version,
    recordedAt: node.recordedAt,
    evidenceId: node.sourceEvidenceId,
    stale,
  };
}

/** Store a versioned architectural fact in the existing immutable ORBIT graph. */
export function rememberMemory(store: GraphStore, input: MemoryInput): MemoryRecord {
  const parsed = memoryInputSchema.parse(input);
  const sourceRefs = parsed.sourceRefs.map((source) => ({
    path: normalizeRepoPath(source.path),
    sha256: source.sha256,
    ...(source.title ? { title: source.title } : {}),
  }));
  const tags = [...new Set(parsed.tags.map((tag) => tag.trim().toLowerCase()))].sort();
  const supersedes = [...new Set(parsed.supersedes)].sort();
  const conflictsWith = [...new Set(parsed.conflictsWith)].sort();
  const type = nodeTypeFor(parsed.kind);
  const nodeId = nodeIdFor(parsed.repositoryId, type, parsed.key);
  const attrs = {
    producer: 'atlas-memory',
    schemaVersion: 1,
    memoryKind: parsed.kind,
    title: parsed.title.trim(),
    summary: parsed.summary.trim(),
    decisionStatus: parsed.decisionStatus?.trim() ?? '',
    content: parsed.content ?? '',
    tags,
    topic: parsed.topic?.trim() ?? '',
    sourceRefs,
    supersedes,
    conflictsWith,
  } satisfies Record<string, JsonValue>;
  const canonical = canonicalJson(attrs);
  const sourceType = sourceRefs.length > 0 ? 'parser' : 'manual';
  const evidence = store.evidence.append({
    repositoryId: parsed.repositoryId,
    source: `atlas-memory:${parsed.key}`,
    sourceType,
    ...(parsed.commitSha ? { commitSha: parsed.commitSha } : {}),
    ...(sourceRefs[0] ? { location: { path: sourceRefs[0].path } } : {}),
    contentHash: hashArtifact(canonical),
    status: 'NOT_MEASURED',
    limitations: [
      'Architectural memory is contextual information, not test or correctness evidence.',
      'Source freshness is unknown until current source hashes are supplied.',
    ],
    relatedEntityIds: [nodeId],
  });
  const node = store.nodes.upsert({
    repositoryId: parsed.repositoryId,
    type,
    key: parsed.key,
    attrs,
    sourceEvidenceId: evidence.record.id,
    ...(parsed.commitSha ? { validFromCommit: parsed.commitSha } : {}),
  }).record;

  for (const key of supersedes) {
    const previous = findMemoryReference(store, parsed.repositoryId, key);
    if (previous && previous.id !== node.id && previous.type === node.type) {
      store.edges.upsert({
        repositoryId: parsed.repositoryId,
        type: 'SUPERSEDES',
        fromId: node.id,
        toId: previous.id,
        attrs: { producer: 'atlas-memory', reason: 'explicit document metadata' },
        sourceEvidenceId: evidence.record.id,
      });
    }
  }
  return toMemory(node);
}

function findMemoryReference(
  store: GraphStore,
  repositoryId: string,
  reference: string,
): NodeRecord | undefined {
  const exact = findMemoryByKey(store, repositoryId, reference);
  if (exact) return exact;
  const token = reference
    .replace(/^ADR[-_ ]?/i, '')
    .replace(/\.md$/i, '')
    .toLowerCase();
  for (const type of ['Decision', 'Documentation'] as const) {
    for (let offset = 0; ; offset += 1000) {
      const page = store.nodes.find(repositoryId, { type, limit: 1000, offset });
      const match = page.find((node) => {
        if (node.attrs['producer'] !== 'atlas-memory') return false;
        const title = asString(node.attrs['title']).toLowerCase();
        const sources = sourceRefsOf(node.attrs['sourceRefs']);
        return (
          title.includes(reference.toLowerCase()) ||
          sources.some((source) => {
            const basename = source.path.split('/').at(-1)?.toLowerCase() ?? '';
            return (
              basename.includes(reference.toLowerCase()) ||
              (token.length > 0 && basename.startsWith(token))
            );
          })
        );
      });
      if (match) return match;
      if (page.length < 1000) break;
    }
  }
  return undefined;
}

function findMemoryByKey(
  store: GraphStore,
  repositoryId: string,
  key: string,
): NodeRecord | undefined {
  for (const type of ['Decision', 'Documentation'] as const) {
    const found = store.nodes
      .find(repositoryId, { type, keyPrefix: key, limit: 100 })
      .find((node) => node.key === key && node.attrs['producer'] === 'atlas-memory');
    if (found) return found;
  }
  return undefined;
}

/** Search active memories. Output is stable and bounded; this is lexical retrieval, not AI ranking. */
export function searchMemories(
  store: GraphStore,
  repositoryId: string,
  options: MemorySearchOptions = {},
): MemoryRecord[] {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
  if (options.query && options.query.length > MAX_QUERY_CHARS) throw new Error('query is too long');
  const current = options.currentSources
    ? new Map(
        options.currentSources.map((source) => [normalizeRepoPath(source.path), source.sha256]),
      )
    : undefined;
  const query = options.query?.trim().toLowerCase();
  const tags = new Set((options.tags ?? []).map((tag) => tag.toLowerCase()));
  const records: MemoryRecord[] = [];
  for (const type of ['Decision', 'Documentation'] as const) {
    for (let offset = 0; ; offset += 1000) {
      const page = store.nodes.find(repositoryId, { type, limit: 1000, offset });
      for (const node of page) {
        if (node.attrs['producer'] !== 'atlas-memory') continue;
        const record = toMemory(node, current);
        if (options.kind && record.kind !== options.kind) continue;
        if (tags.size > 0 && ![...tags].every((tag) => record.tags.includes(tag))) continue;
        const haystack = [record.title, record.summary, record.content, record.key, ...record.tags]
          .join('\n')
          .toLowerCase();
        if (query && !haystack.includes(query)) continue;
        records.push(record);
      }
      if (page.length < 1000) break;
    }
  }
  return records
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.key.localeCompare(b.key))
    .slice(0, Math.min(limit, MAX_SEARCH_LIMIT));
}

export function getMemory(
  store: GraphStore,
  repositoryId: string,
  key: string,
): MemoryRecord | undefined {
  const node = findMemoryByKey(store, repositoryId, key);
  return node ? toMemory(node) : undefined;
}

/** Invalidation is an append-only tombstone; historical versions remain queryable. */
export function invalidateMemory(
  store: GraphStore,
  repositoryId: string,
  key: string,
  reason: string,
): boolean {
  if (!reason.trim()) throw new Error('reason is required');
  const node = findMemoryByKey(store, repositoryId, key);
  if (!node) return false;
  const evidence = store.evidence.append({
    repositoryId,
    source: `atlas-memory-invalidation:${key}`,
    sourceType: 'manual',
    contentHash: hashArtifact(canonicalJson({ key, reason: reason.trim(), nodeId: node.id })),
    status: 'NOT_MEASURED',
    limitations: [
      'Invalidation is an administrative memory lifecycle event, not verification evidence.',
    ],
    relatedEntityIds: [node.id],
  });
  store.nodes.retire({ repositoryId, nodeId: node.id, sourceEvidenceId: evidence.record.id });
  return true;
}

function extractFirstHeading(markdown: string, fallback: string): string {
  const match = /^#\s+(.+)$/m.exec(markdown);
  return match?.[1]?.trim().slice(0, 256) || fallback;
}
function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`^#{1,6}\\s+${heading}\\b`, 'i').test(line));
  if (index < 0) return '';
  const content: string[] = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s+/.test(lines[i] ?? '')) break;
    const line = (lines[i] ?? '').trim();
    if (line) content.push(line);
    if (content.join(' ').length > 1800) break;
  }
  return content.join(' ').slice(0, 2000);
}
function frontMatterValue(markdown: string, label: string): string[] {
  const line = markdown
    .split(/\r?\n/)
    .map((value) => value.replace(/\*/g, '').trim())
    .find((value) => value.toLowerCase().startsWith(`${label.toLowerCase()}:`));
  if (!line) return [];
  const value = line
    .slice(line.indexOf(':') + 1)
    .replace(/[`*_]/g, '')
    .trim();
  return value
    ? value
        .split(/[,;]/)
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
}
function statusText(markdown: string): string | undefined {
  return frontMatterValue(markdown, 'Status')[0];
}

/** Import an ADR or Markdown design document as versioned ATLAS memory. */
export function importMarkdownMemory(
  store: GraphStore,
  input: { repositoryId: string; path: string; content: string; commitSha?: string },
): MemoryRecord {
  if (input.content.length > MAX_BODY_CHARS)
    throw new Error(`document exceeds ${MAX_BODY_CHARS} characters`);
  const path = normalizeRepoPath(input.path);
  const title = extractFirstHeading(input.content, path.split('/').at(-1) ?? path);
  const isAdr =
    /(?:^|\/)ADR[-_ ]?\d+/i.test(path) ||
    /\/DECISIONS\//i.test(path) ||
    /\bArchitecture Decision Record\b/i.test(input.content);
  const supersedes = frontMatterValue(input.content, 'Supersedes');
  const conflictsWith = frontMatterValue(input.content, 'Conflicts with');
  const explicitTags = frontMatterValue(input.content, 'Tags');
  const summary =
    extractSection(input.content, isAdr ? 'Context' : 'Summary') ||
    input.content
      .split(/\r?\n\s*\r?\n/)
      .map((part) => part.trim())
      .find((part) => part && !part.startsWith('#'))
      ?.slice(0, 2000) ||
    title;
  const digest = hashArtifact(input.content);
  const key = `document:${path}`;
  return rememberMemory(store, {
    repositoryId: input.repositoryId,
    key,
    kind: isAdr ? 'decision' : 'document',
    title,
    summary,
    decisionStatus: statusText(input.content),
    content: input.content,
    tags: [...explicitTags, ...(isAdr ? ['adr'] : ['documentation'])],
    topic: (
      extractSection(input.content, isAdr ? 'Decision' : 'Purpose') ||
      frontMatterValue(input.content, 'Status')[0] ||
      ''
    ).slice(0, 256),
    sourceRefs: [{ path, sha256: digest, title }],
    ...(input.commitSha ? { commitSha: input.commitSha } : {}),
    supersedes,
    conflictsWith,
  });
}

export interface MemoryConflict {
  memoryKey: string;
  referencedKey: string;
  relation: 'explicit-conflict' | 'unresolved-supersedes';
  message: string;
}

/** Only reports document-authored conflict/supersedes declarations; it does not infer semantic contradictions. */
export function detectMemoryConflicts(store: GraphStore, repositoryId: string): MemoryConflict[] {
  const memories = searchMemories(store, repositoryId, { limit: MAX_SEARCH_LIMIT });
  const conflicts: MemoryConflict[] = [];
  for (const memory of memories) {
    for (const key of memory.conflictsWith) {
      conflicts.push({
        memoryKey: memory.key,
        referencedKey: key,
        relation: 'explicit-conflict',
        message: 'The imported source explicitly declares a conflict; human review is required.',
      });
    }
    for (const key of memory.supersedes) {
      if (!findMemoryReference(store, repositoryId, key)) {
        conflicts.push({
          memoryKey: memory.key,
          referencedKey: key,
          relation: 'unresolved-supersedes',
          message:
            'The source references a superseded decision that is not present in current memory.',
        });
      }
    }
  }
  return conflicts.sort(
    (a, b) =>
      a.memoryKey.localeCompare(b.memoryKey) || a.referencedKey.localeCompare(b.referencedKey),
  );
}

/** Compare recorded source hashes with a caller-supplied current manifest. */
export function assessMemoryFreshness(
  store: GraphStore,
  repositoryId: string,
  currentSources: { path: string; sha256: string }[],
): { current: number; stale: number; unknown: number; items: MemoryRecord[] } {
  const items = searchMemories(store, repositoryId, { limit: MAX_SEARCH_LIMIT, currentSources });
  return {
    current: items.filter((item) => item.stale === 'current').length,
    stale: items.filter((item) => item.stale === 'stale').length,
    unknown: items.filter((item) => item.stale === 'unknown').length,
    items,
  };
}
