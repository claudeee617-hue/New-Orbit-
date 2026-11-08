import { hashValue, nodeIdFor, type JsonValue, type NodeRecord, type NodeType } from '@orbit/core';
import type { GraphStore } from '@orbit/database';
import { OrbitError } from '@orbit/shared';
import { graphFileProbe, type FileProbe } from './probe.js';
import {
  MEMORY_CATEGORIES,
  MEMORY_LIMITS,
  NORMATIVE_CATEGORIES,
  memoryConfirmSchema,
  memoryCreateSchema,
  memoryInvalidateSchema,
  memoryUpdateSchema,
  type DecisionStatus,
  type MemoryAuthority,
  type MemoryCategory,
  type MemoryConfirmInput,
  type MemoryCreateInput,
  type MemoryInvalidateInput,
  type MemoryItem,
  type MemoryUpdateInput,
  type MemoryVersion,
  type SourceRef,
} from './types.js';
import { z } from 'zod';

const PAGE = 5000;

export function nodeTypeFor(category: MemoryCategory): NodeType {
  return NORMATIVE_CATEGORIES.has(category) ? 'Decision' : 'Documentation';
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : `item-${hashValue(text).slice(0, 8)}`;
}

export function memoryKey(category: MemoryCategory, slug: string): string {
  return `memory/${category}/${slug}`;
}

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown, what: string): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const first = issues[0];
  throw new OrbitError(
    'INVALID_INPUT',
    `Invalid ${what}: ${first ? `${first.path || '(input)'} ${first.message}` : 'unknown problem'}`,
    { details: { issues } },
  );
}

function isMemoryNode(node: NodeRecord): boolean {
  return node.attrs['producer'] === 'memory' && node.key.startsWith('memory/');
}

export interface MemoryEngineOptions {
  /** How to look files up for source-hash capture and staleness. Defaults to the ATLAS graph. */
  probe?: FileProbe;
}

/** Fields the importers may set; ordinary callers cannot (they cannot claim `imported`). */
export interface ImportedMemory {
  category: MemoryCategory;
  slug: string;
  title: string;
  body: string;
  tags: string[];
  sourceRefs: SourceRef[];
  decisionStatus?: DecisionStatus;
  adrNumber?: number;
  excerpt: boolean;
  importedFrom: string;
  supersedesAdr?: number[];
  supersededByAdr?: number[];
}

/**
 * Persistent project memory. Every item is a graph node (`Decision` for normative categories,
 * `Documentation` for descriptive ones), so it inherits versioning, immutability, the evidence
 * requirement and the ledger. Nothing here is ever overwritten or deleted.
 */
export class MemoryEngine {
  readonly probe: FileProbe;

  constructor(
    readonly store: GraphStore,
    readonly repositoryId: string,
    options: MemoryEngineOptions = {},
  ) {
    if (!store.repositories.get(repositoryId)) {
      throw new OrbitError('NOT_FOUND', `Repository ${repositoryId} is not registered`, {
        details: { repositoryId },
      });
    }
    this.probe = options.probe ?? graphFileProbe(store, repositoryId);
  }

  // ---- create / update / invalidate / confirm ------------------------------------------------

  create(input: MemoryCreateInput): MemoryItem {
    const data = parseOrThrow(memoryCreateSchema, input, 'memory');
    const slug = data.slug ?? slugify(data.title);
    const id = memoryKey(data.category, slug);
    const nodeId = nodeIdFor(this.repositoryId, nodeTypeFor(data.category), id);
    if (this.store.nodes.get(this.repositoryId, nodeId)) {
      throw new OrbitError(
        'INVALID_INPUT',
        `Memory ${id} already exists. Update it instead, or pass a different slug.`,
        { details: { reason: 'MEMORY_EXISTS', id } },
      );
    }
    return this.write({
      id,
      category: data.category,
      attrs: {
        title: data.title,
        body: data.body,
        tags: data.tags,
        ...(data.topic !== undefined && { topic: data.topic }),
        ...(data.choice !== undefined && { choice: data.choice }),
        sourceRefs: refsJson(this.captureHashes(data.sourceRefs)),
        authority: data.authority,
        status: 'active',
        createdBy: data.createdBy,
        excerpt: false,
        changeReason: 'created',
      },
    });
  }

  update(id: string, input: MemoryUpdateInput): MemoryItem {
    const patch = parseOrThrow(memoryUpdateSchema, input, 'memory update');
    const current = this.requireItem(id);
    if (current.status === 'invalidated') {
      throw new OrbitError(
        'INVALID_INPUT',
        `Memory ${id} is invalidated. Reinstate it before editing.`,
        { details: { reason: 'MEMORY_INVALIDATED', id } },
      );
    }
    const refs = patch.sourceRefs ?? current.sourceRefs;
    return this.write({
      id,
      category: current.category,
      attrs: {
        ...this.attrsOf(current),
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.body !== undefined && { body: patch.body }),
        ...(patch.tags !== undefined && { tags: patch.tags }),
        ...(patch.topic !== undefined && { topic: patch.topic }),
        ...(patch.choice !== undefined && { choice: patch.choice }),
        // Updating means "I checked this against the files as they are now": re-baseline hashes.
        sourceRefs: refsJson(this.captureHashes(refs, true)),
        changeReason: patch.reason,
        updatedBy: patch.updatedBy,
        // A person editing an imported excerpt makes it their own text.
        excerpt: patch.body !== undefined ? false : current.excerpt,
      },
    });
  }

  /** Mark a memory as no longer true. History is kept; it stops appearing in default searches. */
  invalidate(id: string, input: MemoryInvalidateInput): MemoryItem {
    const data = parseOrThrow(memoryInvalidateSchema, input, 'invalidation');
    const current = this.requireItem(id);
    if (current.status === 'invalidated') {
      throw new OrbitError('INVALID_INPUT', `Memory ${id} is already invalidated`, {
        details: { reason: 'ALREADY_INVALIDATED', id },
      });
    }
    let replacement: MemoryItem | undefined;
    if (data.supersededBy !== undefined) {
      replacement = this.requireItem(data.supersededBy);
      if (nodeTypeFor(replacement.category) !== nodeTypeFor(current.category)) {
        throw new OrbitError(
          'INVALID_INPUT',
          'A memory can only be superseded by one of the same kind (normative or descriptive)',
          { details: { reason: 'INVALID_RELATIONSHIP' } },
        );
      }
      if (replacement.status !== 'active' || replacement.id === current.id) {
        throw new OrbitError(
          'INVALID_INPUT',
          'The replacement must be a different, active memory',
          {
            details: { reason: 'INVALID_REPLACEMENT' },
          },
        );
      }
    }
    return this.write({
      id,
      category: current.category,
      attrs: {
        ...this.attrsOf(current),
        status: 'invalidated',
        invalidation: { reason: data.reason, by: data.invalidatedBy },
        changeReason: `invalidated: ${data.reason}`,
      },
      ...(replacement && { supersededByNodeId: replacement.nodeId }),
    });
  }

  /** Undo an invalidation (for example when it was a mistake). Recorded as a new version. */
  reinstate(id: string, input: { reason: string; by: string }): MemoryItem {
    const reason = parseOrThrow(
      z.string().trim().min(1).max(MEMORY_LIMITS.maxReason),
      input.reason,
      'reason',
    );
    const current = this.requireItem(id);
    if (current.status !== 'invalidated') {
      throw new OrbitError('INVALID_INPUT', `Memory ${id} is not invalidated`, {
        details: { reason: 'NOT_INVALIDATED', id },
      });
    }
    const { invalidation: _dropped, ...attrs } = this.attrsOf(current);
    return this.write({
      id,
      category: current.category,
      attrs: {
        ...attrs,
        status: 'active',
        changeReason: `reinstated: ${reason}`,
        updatedBy: input.by,
      },
    });
  }

  /** A person vouches for an AI suggestion. Only then does it count as authoritative. */
  confirm(id: string, input: MemoryConfirmInput): MemoryItem {
    const data = parseOrThrow(memoryConfirmSchema, input, 'confirmation');
    const current = this.requireItem(id);
    if (current.authority !== 'ai-suggested') {
      throw new OrbitError('INVALID_INPUT', `Memory ${id} is not an AI suggestion`, {
        details: { reason: 'NOT_AI_SUGGESTED', id },
      });
    }
    return this.write({
      id,
      category: current.category,
      attrs: {
        ...this.attrsOf(current),
        authority: 'human',
        confirmation: { by: data.confirmedBy, ...(data.note !== undefined && { note: data.note }) },
        changeReason: `confirmed by ${data.confirmedBy}`,
      },
    });
  }

  // ---- reads ---------------------------------------------------------------------------------

  get(id: string): MemoryItem | undefined {
    const node = this.nodeFor(id);
    return node ? this.items([node])[0] : undefined;
  }

  /** Every version, oldest first, including AI suggestions that were later confirmed. */
  history(id: string): MemoryVersion[] {
    const category = this.categoryOf(id);
    const nodeId = nodeIdFor(this.repositoryId, nodeTypeFor(category), id);
    const versions = this.store.nodes.history(this.repositoryId, nodeId);
    if (versions.length === 0) {
      throw new OrbitError('NOT_FOUND', `No memory ${id}`, { details: { id } });
    }
    return versions.map((record) => ({
      version: record.version,
      item: this.toItem(record, [], []),
      evidenceId: record.sourceEvidenceId,
      recordedAt: record.recordedAt,
      deleted: record.deleted,
    }));
  }

  /** All current memory items (active and invalidated), sorted by id. */
  all(): MemoryItem[] {
    const nodes: NodeRecord[] = [];
    for (const type of ['Decision', 'Documentation'] as const) {
      for (let offset = 0; ; offset += PAGE) {
        const page = this.store.nodes.find(this.repositoryId, {
          type,
          keyPrefix: 'memory/',
          limit: PAGE,
          offset,
        });
        nodes.push(...page.filter(isMemoryNode));
        if (page.length < PAGE) break;
      }
    }
    return this.items(nodes);
  }

  // ---- internals shared with the importers ---------------------------------------------------

  /** Create or update an item read from a repository document. Idempotent. */
  upsertImported(item: ImportedMemory): {
    item: MemoryItem;
    outcome: 'created' | 'updated' | 'unchanged' | 'skipped';
    note?: string;
  } {
    const id = memoryKey(item.category, item.slug);
    const existing = this.get(id);
    if (existing && existing.authority !== 'imported') {
      return {
        item: existing,
        outcome: 'skipped',
        note: `${id} already exists and is maintained by a person; the document was not imported over it`,
      };
    }
    const attrs: Record<string, JsonValue> = {
      title: item.title,
      body: item.body,
      tags: item.tags,
      sourceRefs: refsJson(item.sourceRefs),
      authority: 'imported',
      status: existing?.status === 'invalidated' ? 'invalidated' : 'active',
      createdBy: 'orbit-import',
      excerpt: item.excerpt,
      importedFrom: item.importedFrom,
      changeReason: existing ? 'source document changed' : 'imported from repository document',
      ...(item.decisionStatus !== undefined && { decisionStatus: item.decisionStatus }),
      ...(item.adrNumber !== undefined && { adrNumber: item.adrNumber }),
      ...(item.supersedesAdr &&
        item.supersedesAdr.length > 0 && { supersedesAdr: item.supersedesAdr }),
      ...(item.supersededByAdr &&
        item.supersededByAdr.length > 0 && { supersededByAdr: item.supersededByAdr }),
    };
    if (existing && sameContent(this.attrsOf(existing), attrs)) {
      return { item: existing, outcome: 'unchanged' };
    }
    const written = this.write({ id, category: item.category, attrs });
    return { item: written, outcome: existing ? 'updated' : 'created' };
  }

  attrsOf(item: MemoryItem): Record<string, JsonValue> {
    const node = this.nodeFor(item.id);
    return node ? { ...node.attrs } : {};
  }

  private captureHashes(refs: readonly SourceRef[], refresh = false): SourceRef[] {
    return refs.map((ref) => {
      if (ref.kind !== 'file') return ref;
      if (ref.contentHash !== undefined && !refresh) return ref;
      const seen = this.probe(ref.path);
      if (seen?.exists === true && seen.hash !== undefined)
        return { ...ref, contentHash: seen.hash };
      // Cannot baseline (file unknown): drop a stale baseline rather than keep a misleading one.
      const { contentHash: _old, ...rest } = ref;
      return refresh ? rest : ref;
    });
  }

  /** Persist one new version: evidence, node, and the links implied by the source references. */
  private write(args: {
    id: string;
    category: MemoryCategory;
    attrs: Record<string, JsonValue>;
    supersededByNodeId?: string;
  }): MemoryItem {
    const type = nodeTypeFor(args.category);
    const nodeId = nodeIdFor(this.repositoryId, type, args.id);
    const attrs: Record<string, JsonValue> = {
      ...args.attrs,
      producer: 'memory',
      kind: 'memory',
      category: args.category,
    };
    const authority = attrs['authority'] as MemoryAuthority;
    const refs = (attrs['sourceRefs'] ?? []) as unknown as SourceRef[];

    return this.store.transaction(() => {
      const previous = this.store.nodes.get(this.repositoryId, nodeId);
      const nextVersion = (previous?.version ?? 0) + 1;
      const firstFile = refs.find((r) => r.kind === 'file');
      const evidence = this.store.evidence.append({
        repositoryId: this.repositoryId,
        source: `memory:${args.id}@v${nextVersion}`,
        sourceType:
          authority === 'imported' ? 'parser' : authority === 'ai-suggested' ? 'ai-note' : 'manual',
        ...(firstFile?.kind === 'file' && {
          location: {
            path: firstFile.path,
            ...(firstFile.startLine !== undefined && { startLine: firstFile.startLine }),
            ...(firstFile.endLine !== undefined && { endLine: firstFile.endLine }),
          },
        }),
        contentHash: hashValue({ id: args.id, version: nextVersion, attrs }),
        status:
          authority === 'imported' ? 'PASS' : authority === 'human' ? 'PARTIAL' : 'NOT_MEASURED',
        limitations:
          authority === 'imported'
            ? [
                'ORBIT recorded what the document says. It did not check that the code still follows it.',
              ]
            : authority === 'human'
              ? ['Written by a person. ORBIT did not verify the statement against the code.']
              : [
                  'Generated by an AI. Not reviewed by a person, so it is not an authoritative engineering decision.',
                ],
        relatedEntityIds: [nodeId],
      });
      const node = this.store.nodes.upsert({
        repositoryId: this.repositoryId,
        type,
        key: args.id,
        attrs,
        sourceEvidenceId: evidence.record.id,
      });
      this.syncLinks(node.record, refs, evidence.record.id, args.supersededByNodeId);
      return this.items([node.record])[0] as MemoryItem;
    });
  }

  /** DOCUMENTS edges from this memory to the code files it cites (only files ATLAS knows). */
  private syncLinks(
    node: NodeRecord,
    refs: readonly SourceRef[],
    evidenceId: string,
    supersededByNodeId?: string,
  ): void {
    const wanted = new Map<string, string>();
    for (const ref of refs) {
      if (ref.kind !== 'file') continue;
      const fileId = nodeIdFor(this.repositoryId, 'File', ref.path);
      if (this.store.nodes.get(this.repositoryId, fileId)) wanted.set(fileId, ref.path);
    }
    const existing = this.store.edges.list(this.repositoryId, {
      fromId: node.id,
      types: ['DOCUMENTS'],
    });
    for (const edge of existing) {
      if (edge.attrs['producer'] === 'memory' && !wanted.has(edge.toId)) {
        this.store.edges.retire({
          repositoryId: this.repositoryId,
          edgeId: edge.id,
          sourceEvidenceId: evidenceId,
        });
      }
    }
    for (const [fileId, path] of wanted) {
      this.store.edges.upsert({
        repositoryId: this.repositoryId,
        type: 'DOCUMENTS',
        fromId: node.id,
        toId: fileId,
        confidence: 1,
        attrs: { producer: 'memory', basis: 'explicit source reference', path },
        sourceEvidenceId: evidenceId,
      });
    }
    if (supersededByNodeId !== undefined) {
      this.store.edges.upsert({
        repositoryId: this.repositoryId,
        type: 'SUPERSEDES',
        fromId: supersededByNodeId,
        toId: node.id,
        attrs: { producer: 'memory', basis: 'invalidated in favour of the replacement' },
        sourceEvidenceId: evidenceId,
      });
    }
  }

  private requireItem(id: string): MemoryItem {
    const item = this.get(id);
    if (!item) throw new OrbitError('NOT_FOUND', `No memory ${id}`, { details: { id } });
    return item;
  }

  private categoryOf(id: string): MemoryCategory {
    const [prefix, category] = id.split('/');
    if (prefix !== 'memory' || !(MEMORY_CATEGORIES as readonly string[]).includes(category ?? '')) {
      throw new OrbitError(
        'INVALID_INPUT',
        `"${id}" is not a memory id (memory/<category>/<slug>)`,
        {
          details: { id },
        },
      );
    }
    return category as MemoryCategory;
  }

  private nodeFor(id: string): NodeRecord | undefined {
    const category = this.categoryOf(id);
    const node = this.store.nodes.get(
      this.repositoryId,
      nodeIdFor(this.repositoryId, nodeTypeFor(category), id),
    );
    return node && isMemoryNode(node) ? node : undefined;
  }

  private items(nodes: NodeRecord[]): MemoryItem[] {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const supersedes = new Map<string, string[]>();
    const supersededBy = new Map<string, string[]>();
    for (const node of nodes) {
      for (const edge of this.store.edges.list(this.repositoryId, {
        fromId: node.id,
        types: ['SUPERSEDES'],
      })) {
        const target = byId.get(edge.toId) ?? this.store.nodes.get(this.repositoryId, edge.toId);
        if (!target) continue;
        push(supersedes, node.id, target.key);
        push(supersededBy, target.id, node.key);
      }
      for (const edge of this.store.edges.list(this.repositoryId, {
        toId: node.id,
        types: ['SUPERSEDES'],
      })) {
        const source =
          byId.get(edge.fromId) ?? this.store.nodes.get(this.repositoryId, edge.fromId);
        if (!source) continue;
        push(supersededBy, node.id, source.key);
        push(supersedes, source.id, node.key);
      }
    }
    return nodes
      .map((n) => this.toItem(n, uniq(supersedes.get(n.id)), uniq(supersededBy.get(n.id))))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private toItem(node: NodeRecord, supersedes: string[], supersededBy: string[]): MemoryItem {
    const a = node.attrs;
    const str = (key: string): string | undefined =>
      typeof a[key] === 'string' ? (a[key] as string) : undefined;
    const authority = (str('authority') ?? 'ai-suggested') as MemoryAuthority;
    const status = (str('status') ?? 'active') as MemoryItem['status'];
    const decisionStatus = str('decisionStatus') as DecisionStatus | undefined;
    const inactiveDecision =
      decisionStatus === 'proposed' ||
      decisionStatus === 'rejected' ||
      decisionStatus === 'deprecated' ||
      decisionStatus === 'superseded';
    const item: MemoryItem = {
      id: node.key,
      nodeId: node.id,
      category: (str('category') ?? 'repository-discovery') as MemoryCategory,
      title: str('title') ?? node.key,
      body: str('body') ?? '',
      tags: Array.isArray(a['tags']) ? (a['tags'] as string[]) : [],
      authority,
      status,
      authoritative:
        authority !== 'ai-suggested' &&
        status === 'active' &&
        !inactiveDecision &&
        supersededBy.length === 0 &&
        !node.deleted,
      sourceRefs: Array.isArray(a['sourceRefs']) ? (a['sourceRefs'] as unknown as SourceRef[]) : [],
      version: node.version,
      createdBy: str('createdBy') ?? 'unknown',
      excerpt: a['excerpt'] === true,
      supersedes,
      supersededBy,
      evidenceId: node.sourceEvidenceId,
      recordedAt: node.recordedAt,
    };
    const topic = str('topic');
    const choice = str('choice');
    const changeReason = str('changeReason');
    const importedFrom = str('importedFrom');
    if (topic !== undefined) item.topic = topic;
    if (choice !== undefined) item.choice = choice;
    if (changeReason !== undefined) item.changeReason = changeReason;
    if (importedFrom !== undefined) item.importedFrom = importedFrom;
    if (decisionStatus !== undefined) item.decisionStatus = decisionStatus;
    if (typeof a['adrNumber'] === 'number') item.adrNumber = a['adrNumber'];
    const invalidation = a['invalidation'] as { reason: string; by: string } | undefined;
    if (invalidation) item.invalidation = invalidation;
    const confirmation = a['confirmation'] as { by: string; note?: string } | undefined;
    if (confirmation) item.confirmation = confirmation;
    return item;
  }
}

/** SourceRef objects only hold JSON values; this drops `undefined` members so they satisfy JsonValue. */
function refsJson(refs: readonly SourceRef[]): JsonValue {
  return JSON.parse(JSON.stringify(refs)) as JsonValue;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
const uniq = (values: string[] | undefined): string[] => [...new Set(values ?? [])].sort();

function sameContent(a: Record<string, JsonValue>, b: Record<string, JsonValue>): boolean {
  const strip = (x: Record<string, JsonValue>): unknown => {
    const { changeReason: _c, producer: _p, kind: _k, category: _cat, ...rest } = x;
    return rest;
  };
  return hashValue(strip(a)) === hashValue(strip(b));
}
