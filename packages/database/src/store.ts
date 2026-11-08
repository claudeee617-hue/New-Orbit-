import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  GENESIS_HASH,
  canonicalJson,
  computeLedgerHash,
  edgeIdFor,
  edgeInputSchema,
  edgeRetireSchema,
  edgeVersionPayloadHash,
  assertEdgeAllowed,
  evidenceIdFor,
  evidenceInputSchema,
  nodeIdFor,
  nodeInputSchema,
  nodeRetireSchema,
  nodeVersionPayloadHash,
  parseInput,
  repositoryIdFor,
  repositoryInputSchema,
  repositoryPayloadHash,
  sha256Hex,
  verifyArtifactHash,
  type EdgeRecord,
  type EdgeType,
  type EvidenceInput,
  type EvidenceRecord,
  type EvidenceSourceType,
  type EvidenceStatus,
  type IntegrityProblem,
  type IntegrityReport,
  type JsonValue,
  type LedgerEntityKind,
  type LedgerEntry,
  type LedgerOp,
  type NodeRecord,
  type NodeType,
  type RepositoryRecord,
  type WriteResult,
} from '@orbit/core';
import { OrbitError } from '@orbit/shared';
import type { OrbitDatabase } from './index.js';
import * as t from './schema.js';

type Db = OrbitDatabase['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const DEFAULT_LIST_LIMIT = 1000;
const MAX_LIST_LIMIT = 10_000;

export interface GraphStoreOptions {
  /** Clock used for `recordedAt` and ledger timestamps. Inject a fixed clock for reproducible tests. */
  now?: () => string;
}

export interface NodeQuery {
  type?: NodeType;
  /** Exact (not wildcard) key prefix. */
  keyPrefix?: string;
  limit?: number;
  /** Rows to skip, for paging through large result sets (stable order: key, id). */
  offset?: number;
}

export interface EdgeQuery {
  fromId?: string;
  toId?: string;
  types?: readonly EdgeType[];
  limit?: number;
  /** Rows to skip, for paging through large result sets (stable order: type, id). */
  offset?: number;
}

export interface EvidenceQuery {
  commitSha?: string;
  sourceType?: EvidenceSourceType;
  limit?: number;
}

export interface GraphStore {
  /**
   * Run several writes atomically. If `fn` throws, every write made inside is rolled back
   * (including ledger entries). Calls may be nested.
   */
  transaction<T>(fn: () => T): T;
  repositories: {
    register(input: unknown): WriteResult<RepositoryRecord>;
    get(repositoryId: string): RepositoryRecord | undefined;
    list(): RepositoryRecord[];
  };
  evidence: {
    /** Append immutable evidence. Re-appending identical content is a no-op that returns the original. */
    append(input: unknown): WriteResult<EvidenceRecord>;
    get(repositoryId: string, evidenceId: string): EvidenceRecord | undefined;
    list(repositoryId: string, query?: EvidenceQuery): EvidenceRecord[];
    /** Evidence whose `relatedEntityIds` include the entity. */
    forEntity(repositoryId: string, entityId: string): EvidenceRecord[];
    /** True when `artifact` hashes to the evidence's recorded `contentHash`. */
    verifyArtifact(
      repositoryId: string,
      evidenceId: string,
      artifact: string | Uint8Array,
    ): boolean;
  };
  nodes: {
    upsert(input: unknown): WriteResult<NodeRecord>;
    /** Append a tombstone version. History stays; the node disappears from current-state queries. */
    retire(input: unknown): WriteResult<NodeRecord>;
    /** Current (latest, non-retired) state. */
    get(repositoryId: string, nodeId: string): NodeRecord | undefined;
    find(repositoryId: string, query?: NodeQuery): NodeRecord[];
    /** Every version, oldest first, including tombstones. */
    history(repositoryId: string, nodeId: string): NodeRecord[];
  };
  edges: {
    upsert(input: unknown): WriteResult<EdgeRecord>;
    retire(input: unknown): WriteResult<EdgeRecord>;
    get(repositoryId: string, edgeId: string): EdgeRecord | undefined;
    list(repositoryId: string, query?: EdgeQuery): EdgeRecord[];
    history(repositoryId: string, edgeId: string): EdgeRecord[];
  };
  ledger: {
    entries(repositoryId: string, options?: { afterSeq?: number; limit?: number }): LedgerEntry[];
    head(repositoryId: string): LedgerEntry | undefined;
  };
  /** Recompute every hash and compare with what is stored. Detects tampering, including direct SQL edits. */
  verifyIntegrity(repositoryId: string): IntegrityReport;
}

type RepoRow = typeof t.repositories.$inferSelect;
type EvidenceRow = typeof t.evidence.$inferSelect;
type NodeVersionRow = typeof t.nodeVersions.$inferSelect;
type EdgeVersionRow = typeof t.edgeVersions.$inferSelect;
type LedgerRow = typeof t.ledger.$inferSelect;

interface NodeCurrentRow {
  id: string;
  repository_id: string;
  type: string;
  key: string;
  version: number;
  attrs_json: string;
  valid_from_commit: string | null;
  evidence_id: string;
  recorded_at: string;
}

interface EdgeCurrentRow {
  id: string;
  repository_id: string;
  type: string;
  from_id: string;
  to_id: string;
  version: number;
  attrs_json: string;
  confidence: number | null;
  valid_from_commit: string | null;
  evidence_id: string;
  recorded_at: string;
}

function clampLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(value) || value < 1) {
    throw new OrbitError('INVALID_INPUT', 'limit must be a positive integer');
  }
  return Math.min(value, MAX_LIST_LIMIT);
}

function clampOffset(offset: number | undefined): number {
  const value = offset ?? 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new OrbitError('INVALID_INPUT', 'offset must be a non-negative integer');
  }
  return value;
}

function notFound(what: string, id: string, repositoryId: string): OrbitError {
  return new OrbitError('NOT_FOUND', `${what} ${id} does not exist in repository ${repositoryId}`, {
    details: { what, id, repositoryId },
  });
}

function parseAttrs(json: string): Record<string, JsonValue> {
  return JSON.parse(json) as Record<string, JsonValue>;
}

function toRepository(row: RepoRow): RepositoryRecord {
  return { id: row.id, key: row.key, displayName: row.displayName, createdAt: row.createdAt };
}

/** Rebuild the normalised evidence input from a stored row (used for reads and integrity checks). */
function evidenceInputFromRow(row: EvidenceRow): EvidenceInput {
  return {
    repositoryId: row.repositoryId,
    source: row.source,
    sourceType: row.sourceType as EvidenceSourceType,
    ...(row.timestamp !== null && { timestamp: row.timestamp }),
    ...(row.commitSha !== null && { commitSha: row.commitSha }),
    ...(row.locationPath !== null && {
      location: {
        path: row.locationPath,
        ...(row.locationStartLine !== null && { startLine: row.locationStartLine }),
        ...(row.locationEndLine !== null && { endLine: row.locationEndLine }),
      },
    }),
    contentHash: row.contentHash,
    status: row.status as EvidenceStatus,
    limitations: JSON.parse(row.limitationsJson) as string[],
    relatedEntityIds: JSON.parse(row.relatedEntityIdsJson) as string[],
    ...(row.supersedes !== null && { supersedes: row.supersedes }),
  };
}

function toEvidence(row: EvidenceRow): EvidenceRecord {
  return { ...evidenceInputFromRow(row), id: row.id, recordedAt: row.recordedAt };
}

function toLedgerEntry(row: LedgerRow): LedgerEntry {
  return {
    repositoryId: row.repositoryId,
    seq: row.seq,
    ts: row.ts,
    op: row.op as LedgerOp,
    entityKind: row.entityKind as LedgerEntityKind,
    entityId: row.entityId,
    payloadHash: row.payloadHash,
    prevHash: row.prevHash,
    hash: row.hash,
  };
}

export function createGraphStore(
  database: OrbitDatabase,
  options: GraphStoreOptions = {},
): GraphStore {
  const db = database.db;
  const now = options.now ?? (() => new Date().toISOString());

  // ---------------------------------------------------------------------------------------------
  // Internal helpers (all run inside a transaction supplied by the caller)
  // ---------------------------------------------------------------------------------------------

  function requireRepository(tx: Tx, repositoryId: string): void {
    const row = tx
      .select({ id: t.repositories.id })
      .from(t.repositories)
      .where(eq(t.repositories.id, repositoryId))
      .get();
    if (!row)
      throw new OrbitError('NOT_FOUND', `Repository ${repositoryId} is not registered`, {
        details: { repositoryId },
      });
  }

  function requireEvidence(tx: Tx, repositoryId: string, evidenceId: string): void {
    const row = tx
      .select({ id: t.evidence.id })
      .from(t.evidence)
      .where(and(eq(t.evidence.id, evidenceId), eq(t.evidence.repositoryId, repositoryId)))
      .get();
    if (!row) throw notFound('Evidence', evidenceId, repositoryId);
  }

  function appendLedger(
    tx: Tx,
    repositoryId: string,
    op: LedgerOp,
    entityKind: LedgerEntityKind,
    entityId: string,
    payloadHash: string,
  ): void {
    const last = tx
      .select()
      .from(t.ledger)
      .where(eq(t.ledger.repositoryId, repositoryId))
      .orderBy(desc(t.ledger.seq))
      .limit(1)
      .get();
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS_HASH;
    const ts = now();
    const hash = computeLedgerHash({
      repositoryId,
      seq,
      ts,
      op,
      entityKind,
      entityId,
      payloadHash,
      prevHash,
    });
    tx.insert(t.ledger)
      .values({ repositoryId, seq, ts, op, entityKind, entityId, payloadHash, prevHash, hash })
      .run();
  }

  function nodeRecord(
    identity: typeof t.nodes.$inferSelect,
    version: NodeVersionRow,
    next?: NodeVersionRow,
  ): NodeRecord {
    return {
      id: identity.id,
      repositoryId: identity.repositoryId,
      type: identity.type as NodeType,
      key: identity.key,
      version: version.version,
      attrs: parseAttrs(version.attrsJson),
      validFromCommit: version.validFromCommit,
      validToCommit: next?.validFromCommit ?? null,
      sourceEvidenceId: version.evidenceId,
      recordedAt: version.recordedAt,
      deleted: version.deleted === 1,
    };
  }

  function edgeRecord(
    identity: typeof t.edges.$inferSelect,
    version: EdgeVersionRow,
    next?: EdgeVersionRow,
  ): EdgeRecord {
    return {
      id: identity.id,
      repositoryId: identity.repositoryId,
      type: identity.type as EdgeType,
      fromId: identity.fromId,
      toId: identity.toId,
      version: version.version,
      attrs: parseAttrs(version.attrsJson),
      confidence: version.confidence,
      validFromCommit: version.validFromCommit,
      validToCommit: next?.validFromCommit ?? null,
      sourceEvidenceId: version.evidenceId,
      recordedAt: version.recordedAt,
      deleted: version.deleted === 1,
    };
  }

  function nodeFromCurrent(row: NodeCurrentRow): NodeRecord {
    return {
      id: row.id,
      repositoryId: row.repository_id,
      type: row.type as NodeType,
      key: row.key,
      version: row.version,
      attrs: parseAttrs(row.attrs_json),
      validFromCommit: row.valid_from_commit,
      validToCommit: null,
      sourceEvidenceId: row.evidence_id,
      recordedAt: row.recorded_at,
      deleted: false,
    };
  }

  function edgeFromCurrent(row: EdgeCurrentRow): EdgeRecord {
    return {
      id: row.id,
      repositoryId: row.repository_id,
      type: row.type as EdgeType,
      fromId: row.from_id,
      toId: row.to_id,
      version: row.version,
      attrs: parseAttrs(row.attrs_json),
      confidence: row.confidence,
      validFromCommit: row.valid_from_commit,
      validToCommit: null,
      sourceEvidenceId: row.evidence_id,
      recordedAt: row.recorded_at,
      deleted: false,
    };
  }

  function currentNode(
    runner: Pick<Db, 'get'>,
    repositoryId: string,
    nodeId: string,
  ): NodeRecord | undefined {
    const row = runner.get<NodeCurrentRow | undefined>(
      sql`select * from node_current where repository_id = ${repositoryId} and id = ${nodeId}`,
    );
    return row ? nodeFromCurrent(row) : undefined;
  }

  function currentEdge(
    runner: Pick<Db, 'get'>,
    repositoryId: string,
    edgeId: string,
  ): EdgeRecord | undefined {
    const row = runner.get<EdgeCurrentRow | undefined>(
      sql`select * from edge_current where repository_id = ${repositoryId} and id = ${edgeId}`,
    );
    return row ? edgeFromCurrent(row) : undefined;
  }

  function latestNodeVersion(tx: Tx, nodeId: string): NodeVersionRow | undefined {
    return tx
      .select()
      .from(t.nodeVersions)
      .where(eq(t.nodeVersions.nodeId, nodeId))
      .orderBy(desc(t.nodeVersions.version))
      .limit(1)
      .get();
  }

  function latestEdgeVersion(tx: Tx, edgeId: string): EdgeVersionRow | undefined {
    return tx
      .select()
      .from(t.edgeVersions)
      .where(eq(t.edgeVersions.edgeId, edgeId))
      .orderBy(desc(t.edgeVersions.version))
      .limit(1)
      .get();
  }

  function insertNodeVersion(
    tx: Tx,
    node: typeof t.nodes.$inferSelect,
    previous: NodeVersionRow | undefined,
    values: {
      attrsJson: string;
      deleted: boolean;
      validFromCommit: string | null;
      evidenceId: string;
    },
  ): NodeVersionRow {
    const version = (previous?.version ?? 0) + 1;
    const attrsHash = sha256Hex(values.attrsJson);
    const row: NodeVersionRow = {
      nodeId: node.id,
      version,
      attrsJson: values.attrsJson,
      attrsHash,
      deleted: values.deleted ? 1 : 0,
      validFromCommit: values.validFromCommit,
      evidenceId: values.evidenceId,
      recordedAt: now(),
    };
    tx.insert(t.nodeVersions).values(row).run();
    appendLedger(
      tx,
      node.repositoryId,
      'node.version',
      'node_version',
      `${node.id}#${version}`,
      nodeVersionPayloadHash({
        nodeId: node.id,
        version,
        attrsHash,
        deleted: values.deleted,
        validFromCommit: values.validFromCommit,
        evidenceId: values.evidenceId,
      }),
    );
    return row;
  }

  function insertEdgeVersion(
    tx: Tx,
    edge: typeof t.edges.$inferSelect,
    previous: EdgeVersionRow | undefined,
    values: {
      attrsJson: string;
      confidence: number | null;
      deleted: boolean;
      validFromCommit: string | null;
      evidenceId: string;
    },
  ): EdgeVersionRow {
    const version = (previous?.version ?? 0) + 1;
    const attrsHash = sha256Hex(values.attrsJson);
    const row: EdgeVersionRow = {
      edgeId: edge.id,
      version,
      attrsJson: values.attrsJson,
      attrsHash,
      confidence: values.confidence,
      deleted: values.deleted ? 1 : 0,
      validFromCommit: values.validFromCommit,
      evidenceId: values.evidenceId,
      recordedAt: now(),
    };
    tx.insert(t.edgeVersions).values(row).run();
    appendLedger(
      tx,
      edge.repositoryId,
      'edge.version',
      'edge_version',
      `${edge.id}#${version}`,
      edgeVersionPayloadHash({
        nodeId: edge.id,
        version,
        attrsHash,
        deleted: values.deleted,
        validFromCommit: values.validFromCommit,
        evidenceId: values.evidenceId,
        confidence: values.confidence,
      }),
    );
    return row;
  }

  // ---------------------------------------------------------------------------------------------
  // Repositories
  // ---------------------------------------------------------------------------------------------

  const repositories: GraphStore['repositories'] = {
    register(input) {
      const parsed = parseInput(repositoryInputSchema, input, 'repository');
      const id = repositoryIdFor(parsed.key);
      return db.transaction((tx) => {
        const existing = tx.select().from(t.repositories).where(eq(t.repositories.id, id)).get();
        if (existing) return { record: toRepository(existing), changed: false };
        const row: RepoRow = {
          id,
          key: parsed.key,
          displayName: parsed.displayName ?? parsed.key,
          createdAt: now(),
        };
        tx.insert(t.repositories).values(row).run();
        appendLedger(
          tx,
          id,
          'repository.register',
          'repository',
          id,
          repositoryPayloadHash(id, parsed.key),
        );
        return { record: toRepository(row), changed: true };
      });
    },
    get(repositoryId) {
      const row = db.select().from(t.repositories).where(eq(t.repositories.id, repositoryId)).get();
      return row ? toRepository(row) : undefined;
    },
    list() {
      return db
        .select()
        .from(t.repositories)
        .orderBy(asc(t.repositories.key))
        .all()
        .map(toRepository);
    },
  };

  // ---------------------------------------------------------------------------------------------
  // Evidence
  // ---------------------------------------------------------------------------------------------

  const evidence: GraphStore['evidence'] = {
    append(input) {
      const parsed = parseInput(evidenceInputSchema, input, 'evidence');
      const id = evidenceIdFor(parsed);
      return db.transaction((tx) => {
        requireRepository(tx, parsed.repositoryId);
        const existing = tx.select().from(t.evidence).where(eq(t.evidence.id, id)).get();
        if (existing) return { record: toEvidence(existing), changed: false };

        if (parsed.supersedes !== undefined) {
          const target = tx
            .select()
            .from(t.evidence)
            .where(eq(t.evidence.id, parsed.supersedes))
            .get();
          if (!target || target.repositoryId !== parsed.repositoryId) {
            throw new OrbitError(
              'INVALID_INPUT',
              'supersedes must reference existing evidence in the same repository',
            );
          }
          const alreadySuperseded = tx
            .select({ id: t.evidence.id })
            .from(t.evidence)
            .where(eq(t.evidence.supersedes, parsed.supersedes))
            .get();
          if (alreadySuperseded) {
            throw new OrbitError(
              'INVALID_INPUT',
              'That evidence has already been superseded by newer evidence',
            );
          }
        }

        const recordedAt = now();
        const row: EvidenceRow = {
          id,
          repositoryId: parsed.repositoryId,
          source: parsed.source,
          sourceType: parsed.sourceType,
          timestamp: parsed.timestamp ?? null,
          commitSha: parsed.commitSha ?? null,
          locationPath: parsed.location?.path ?? null,
          locationStartLine: parsed.location?.startLine ?? null,
          locationEndLine: parsed.location?.endLine ?? null,
          contentHash: parsed.contentHash,
          status: parsed.status,
          limitationsJson: JSON.stringify(parsed.limitations),
          relatedEntityIdsJson: JSON.stringify(parsed.relatedEntityIds),
          supersedes: parsed.supersedes ?? null,
          recordedAt,
        };
        tx.insert(t.evidence).values(row).run();
        for (const entityId of parsed.relatedEntityIds) {
          tx.insert(t.evidenceRefs)
            .values({ repositoryId: parsed.repositoryId, evidenceId: id, entityId })
            .run();
        }
        appendLedger(tx, parsed.repositoryId, 'evidence.append', 'evidence', id, id);
        return { record: toEvidence(row), changed: true };
      });
    },
    get(repositoryId, evidenceId) {
      const row = db
        .select()
        .from(t.evidence)
        .where(and(eq(t.evidence.id, evidenceId), eq(t.evidence.repositoryId, repositoryId)))
        .get();
      return row ? toEvidence(row) : undefined;
    },
    list(repositoryId, query = {}) {
      const conditions: SQL[] = [eq(t.evidence.repositoryId, repositoryId)];
      if (query.commitSha !== undefined)
        conditions.push(eq(t.evidence.commitSha, query.commitSha.toLowerCase()));
      if (query.sourceType !== undefined)
        conditions.push(eq(t.evidence.sourceType, query.sourceType));
      return db
        .select()
        .from(t.evidence)
        .where(and(...conditions))
        .orderBy(asc(t.evidence.recordedAt), asc(t.evidence.id))
        .limit(clampLimit(query.limit))
        .all()
        .map(toEvidence);
    },
    forEntity(repositoryId, entityId) {
      return db
        .select({ row: t.evidence })
        .from(t.evidenceRefs)
        .innerJoin(t.evidence, eq(t.evidence.id, t.evidenceRefs.evidenceId))
        .where(
          and(eq(t.evidenceRefs.repositoryId, repositoryId), eq(t.evidenceRefs.entityId, entityId)),
        )
        .orderBy(asc(t.evidence.recordedAt), asc(t.evidence.id))
        .all()
        .map(({ row }) => toEvidence(row));
    },
    verifyArtifact(repositoryId, evidenceId, artifact) {
      const record = evidence.get(repositoryId, evidenceId);
      if (!record) throw notFound('Evidence', evidenceId, repositoryId);
      return verifyArtifactHash(record.contentHash, artifact);
    },
  };

  // ---------------------------------------------------------------------------------------------
  // Nodes
  // ---------------------------------------------------------------------------------------------

  const nodes: GraphStore['nodes'] = {
    upsert(input) {
      const parsed = parseInput(nodeInputSchema, input, 'node');
      const id = nodeIdFor(parsed.repositoryId, parsed.type, parsed.key);
      return db.transaction((tx) => {
        requireRepository(tx, parsed.repositoryId);
        requireEvidence(tx, parsed.repositoryId, parsed.sourceEvidenceId);

        let identity = tx.select().from(t.nodes).where(eq(t.nodes.id, id)).get();
        if (!identity) {
          identity = {
            id,
            repositoryId: parsed.repositoryId,
            type: parsed.type,
            key: parsed.key,
            createdAt: now(),
          };
          tx.insert(t.nodes).values(identity).run();
        }

        const attrsJson = canonicalJson(parsed.attrs);
        const latest = latestNodeVersion(tx, id);
        const validFromCommit = parsed.validFromCommit ?? null;
        if (
          latest &&
          latest.deleted === 0 &&
          latest.attrsHash === sha256Hex(attrsJson) &&
          latest.validFromCommit === validFromCommit
        ) {
          return { record: nodeRecord(identity, latest), changed: false };
        }

        const version = insertNodeVersion(tx, identity, latest, {
          attrsJson,
          deleted: false,
          validFromCommit,
          evidenceId: parsed.sourceEvidenceId,
        });
        return { record: nodeRecord(identity, version), changed: true };
      });
    },
    retire(input) {
      const parsed = parseInput(nodeRetireSchema, input, 'node retirement');
      return db.transaction((tx) => {
        requireRepository(tx, parsed.repositoryId);
        requireEvidence(tx, parsed.repositoryId, parsed.sourceEvidenceId);
        const identity = tx
          .select()
          .from(t.nodes)
          .where(and(eq(t.nodes.id, parsed.nodeId), eq(t.nodes.repositoryId, parsed.repositoryId)))
          .get();
        if (!identity) throw notFound('Node', parsed.nodeId, parsed.repositoryId);
        const latest = latestNodeVersion(tx, identity.id);
        if (!latest) throw notFound('Node', parsed.nodeId, parsed.repositoryId);
        if (latest.deleted === 1) return { record: nodeRecord(identity, latest), changed: false };
        const tombstone = insertNodeVersion(tx, identity, latest, {
          attrsJson: latest.attrsJson,
          deleted: true,
          validFromCommit: parsed.atCommit ?? null,
          evidenceId: parsed.sourceEvidenceId,
        });
        return { record: nodeRecord(identity, tombstone), changed: true };
      });
    },
    get(repositoryId, nodeId) {
      return currentNode(db, repositoryId, nodeId);
    },
    find(repositoryId, query = {}) {
      const conditions: SQL[] = [sql`repository_id = ${repositoryId}`];
      if (query.type !== undefined) conditions.push(sql`type = ${query.type}`);
      if (query.keyPrefix !== undefined) {
        conditions.push(sql`substr(key, 1, ${query.keyPrefix.length}) = ${query.keyPrefix}`);
      }
      const rows = db.all<NodeCurrentRow>(
        sql`select * from node_current where ${sql.join(conditions, sql` and `)} order by key asc, id asc limit ${clampLimit(query.limit)} offset ${clampOffset(query.offset)}`,
      );
      return rows.map(nodeFromCurrent);
    },
    history(repositoryId, nodeId) {
      const identity = db
        .select()
        .from(t.nodes)
        .where(and(eq(t.nodes.id, nodeId), eq(t.nodes.repositoryId, repositoryId)))
        .get();
      if (!identity) return [];
      const versions = db
        .select()
        .from(t.nodeVersions)
        .where(eq(t.nodeVersions.nodeId, nodeId))
        .orderBy(asc(t.nodeVersions.version))
        .all();
      return versions.map((version, index) => nodeRecord(identity, version, versions[index + 1]));
    },
  };

  // ---------------------------------------------------------------------------------------------
  // Edges
  // ---------------------------------------------------------------------------------------------

  const edges: GraphStore['edges'] = {
    upsert(input) {
      const parsed = parseInput(edgeInputSchema, input, 'edge');
      return db.transaction((tx) => {
        requireRepository(tx, parsed.repositoryId);
        requireEvidence(tx, parsed.repositoryId, parsed.sourceEvidenceId);
        if (parsed.fromId === parsed.toId) {
          throw new OrbitError('INVALID_INPUT', 'An edge cannot connect a node to itself');
        }
        const from = currentNode(tx, parsed.repositoryId, parsed.fromId);
        if (!from) throw notFound('Node', parsed.fromId, parsed.repositoryId);
        const to = currentNode(tx, parsed.repositoryId, parsed.toId);
        if (!to) throw notFound('Node', parsed.toId, parsed.repositoryId);
        assertEdgeAllowed(parsed.type, from.type, to.type);

        const id = edgeIdFor(parsed.repositoryId, parsed.type, parsed.fromId, parsed.toId);
        let identity = tx.select().from(t.edges).where(eq(t.edges.id, id)).get();
        if (!identity) {
          identity = {
            id,
            repositoryId: parsed.repositoryId,
            type: parsed.type,
            fromId: parsed.fromId,
            toId: parsed.toId,
            createdAt: now(),
          };
          tx.insert(t.edges).values(identity).run();
        }

        const attrsJson = canonicalJson(parsed.attrs);
        const confidence = parsed.confidence ?? null;
        const validFromCommit = parsed.validFromCommit ?? null;
        const latest = latestEdgeVersion(tx, id);
        if (
          latest &&
          latest.deleted === 0 &&
          latest.attrsHash === sha256Hex(attrsJson) &&
          latest.confidence === confidence &&
          latest.validFromCommit === validFromCommit
        ) {
          return { record: edgeRecord(identity, latest), changed: false };
        }

        const version = insertEdgeVersion(tx, identity, latest, {
          attrsJson,
          confidence,
          deleted: false,
          validFromCommit,
          evidenceId: parsed.sourceEvidenceId,
        });
        return { record: edgeRecord(identity, version), changed: true };
      });
    },
    retire(input) {
      const parsed = parseInput(edgeRetireSchema, input, 'edge retirement');
      return db.transaction((tx) => {
        requireRepository(tx, parsed.repositoryId);
        requireEvidence(tx, parsed.repositoryId, parsed.sourceEvidenceId);
        const identity = tx
          .select()
          .from(t.edges)
          .where(and(eq(t.edges.id, parsed.edgeId), eq(t.edges.repositoryId, parsed.repositoryId)))
          .get();
        if (!identity) throw notFound('Edge', parsed.edgeId, parsed.repositoryId);
        const latest = latestEdgeVersion(tx, identity.id);
        if (!latest) throw notFound('Edge', parsed.edgeId, parsed.repositoryId);
        if (latest.deleted === 1) return { record: edgeRecord(identity, latest), changed: false };
        const tombstone = insertEdgeVersion(tx, identity, latest, {
          attrsJson: latest.attrsJson,
          confidence: latest.confidence,
          deleted: true,
          validFromCommit: parsed.atCommit ?? null,
          evidenceId: parsed.sourceEvidenceId,
        });
        return { record: edgeRecord(identity, tombstone), changed: true };
      });
    },
    get(repositoryId, edgeId) {
      return currentEdge(db, repositoryId, edgeId);
    },
    list(repositoryId, query = {}) {
      const conditions: SQL[] = [sql`repository_id = ${repositoryId}`];
      if (query.fromId !== undefined) conditions.push(sql`from_id = ${query.fromId}`);
      if (query.toId !== undefined) conditions.push(sql`to_id = ${query.toId}`);
      if (query.types !== undefined) {
        if (query.types.length === 0) return [];
        conditions.push(
          sql`type in (${sql.join(
            query.types.map((type) => sql`${type}`),
            sql`, `,
          )})`,
        );
      }
      const rows = db.all<EdgeCurrentRow>(
        sql`select * from edge_current where ${sql.join(conditions, sql` and `)} order by type asc, id asc limit ${clampLimit(query.limit)} offset ${clampOffset(query.offset)}`,
      );
      return rows.map(edgeFromCurrent);
    },
    history(repositoryId, edgeId) {
      const identity = db
        .select()
        .from(t.edges)
        .where(and(eq(t.edges.id, edgeId), eq(t.edges.repositoryId, repositoryId)))
        .get();
      if (!identity) return [];
      const versions = db
        .select()
        .from(t.edgeVersions)
        .where(eq(t.edgeVersions.edgeId, edgeId))
        .orderBy(asc(t.edgeVersions.version))
        .all();
      return versions.map((version, index) => edgeRecord(identity, version, versions[index + 1]));
    },
  };

  // ---------------------------------------------------------------------------------------------
  // Ledger and integrity
  // ---------------------------------------------------------------------------------------------

  const ledger: GraphStore['ledger'] = {
    entries(repositoryId, options = {}) {
      return db
        .select()
        .from(t.ledger)
        .where(
          and(
            eq(t.ledger.repositoryId, repositoryId),
            sql`${t.ledger.seq} > ${options.afterSeq ?? 0}`,
          ),
        )
        .orderBy(asc(t.ledger.seq))
        .limit(clampLimit(options.limit))
        .all()
        .map(toLedgerEntry);
    },
    head(repositoryId) {
      const row = db
        .select()
        .from(t.ledger)
        .where(eq(t.ledger.repositoryId, repositoryId))
        .orderBy(desc(t.ledger.seq))
        .limit(1)
        .get();
      return row ? toLedgerEntry(row) : undefined;
    },
  };

  function verifyIntegrity(repositoryId: string): IntegrityReport {
    const problems: IntegrityProblem[] = [];
    const entries = db
      .select()
      .from(t.ledger)
      .where(eq(t.ledger.repositoryId, repositoryId))
      .orderBy(asc(t.ledger.seq))
      .all();

    // 1. The hash chain itself.
    let expectedSeq = 1;
    let expectedPrev = GENESIS_HASH;
    for (const entry of entries) {
      if (entry.seq !== expectedSeq) {
        problems.push({
          code: 'LEDGER_GAP',
          message: `Expected ledger entry ${expectedSeq} but found ${entry.seq}`,
          seq: entry.seq,
        });
      }
      if (entry.prevHash !== expectedPrev) {
        problems.push({
          code: 'LEDGER_PREV_HASH_MISMATCH',
          message: `Entry ${entry.seq} does not link to the previous entry`,
          seq: entry.seq,
        });
      }
      const recomputed = computeLedgerHash({
        repositoryId: entry.repositoryId,
        seq: entry.seq,
        ts: entry.ts,
        op: entry.op as LedgerOp,
        entityKind: entry.entityKind as LedgerEntityKind,
        entityId: entry.entityId,
        payloadHash: entry.payloadHash,
        prevHash: entry.prevHash,
      });
      if (recomputed !== entry.hash) {
        problems.push({
          code: 'LEDGER_HASH_MISMATCH',
          message: `Entry ${entry.seq} hash does not match its contents`,
          seq: entry.seq,
        });
      }
      expectedSeq = entry.seq + 1;
      expectedPrev = entry.hash;
    }

    // 2. Every ledger entry must still describe the stored entity it points at.
    const ledgered = new Set<string>();
    for (const entry of entries) {
      ledgered.add(`${entry.entityKind}:${entry.entityId}`);
      const missing = (): void => {
        problems.push({
          code: 'MISSING_ENTITY',
          message: `Ledger entry ${entry.seq} refers to ${entry.entityKind} ${entry.entityId}, which is missing`,
          seq: entry.seq,
          entityId: entry.entityId,
        });
      };
      const mismatch = (): void => {
        problems.push({
          code: 'PAYLOAD_MISMATCH',
          message: `Stored ${entry.entityKind} ${entry.entityId} no longer matches ledger entry ${entry.seq}`,
          seq: entry.seq,
          entityId: entry.entityId,
        });
      };

      if (entry.entityKind === 'repository') {
        const repo = db
          .select()
          .from(t.repositories)
          .where(eq(t.repositories.id, entry.entityId))
          .get();
        if (!repo) missing();
        else if (repositoryPayloadHash(repo.id, repo.key) !== entry.payloadHash) mismatch();
      } else if (entry.entityKind === 'evidence') {
        const row = db.select().from(t.evidence).where(eq(t.evidence.id, entry.entityId)).get();
        if (!row) missing();
        else {
          if (evidenceIdFor(evidenceInputFromRow(row)) !== row.id) {
            problems.push({
              code: 'EVIDENCE_ID_MISMATCH',
              message: `Evidence ${row.id} was altered after it was recorded`,
              seq: entry.seq,
              entityId: row.id,
            });
          } else if (row.id !== entry.payloadHash) mismatch();
        }
      } else if (entry.entityKind === 'node_version') {
        const [nodeId = '', versionText = ''] = entry.entityId.split('#');
        const row = db
          .select()
          .from(t.nodeVersions)
          .where(
            and(eq(t.nodeVersions.nodeId, nodeId), eq(t.nodeVersions.version, Number(versionText))),
          )
          .get();
        if (!row) missing();
        else {
          if (sha256Hex(row.attrsJson) !== row.attrsHash) {
            problems.push({
              code: 'ATTRS_HASH_MISMATCH',
              message: `Attributes of ${entry.entityId} were altered`,
              seq: entry.seq,
              entityId: entry.entityId,
            });
          }
          const payload = nodeVersionPayloadHash({
            nodeId: row.nodeId,
            version: row.version,
            attrsHash: row.attrsHash,
            deleted: row.deleted === 1,
            validFromCommit: row.validFromCommit,
            evidenceId: row.evidenceId,
          });
          if (payload !== entry.payloadHash) mismatch();
        }
      } else {
        const [edgeId = '', versionText = ''] = entry.entityId.split('#');
        const row = db
          .select()
          .from(t.edgeVersions)
          .where(
            and(eq(t.edgeVersions.edgeId, edgeId), eq(t.edgeVersions.version, Number(versionText))),
          )
          .get();
        if (!row) missing();
        else {
          if (sha256Hex(row.attrsJson) !== row.attrsHash) {
            problems.push({
              code: 'ATTRS_HASH_MISMATCH',
              message: `Attributes of ${entry.entityId} were altered`,
              seq: entry.seq,
              entityId: entry.entityId,
            });
          }
          const payload = edgeVersionPayloadHash({
            nodeId: row.edgeId,
            version: row.version,
            attrsHash: row.attrsHash,
            deleted: row.deleted === 1,
            validFromCommit: row.validFromCommit,
            evidenceId: row.evidenceId,
            confidence: row.confidence,
          });
          if (payload !== entry.payloadHash) mismatch();
        }
      }
    }

    // 3. Every stored record must have a ledger entry (nothing was inserted behind the ledger's back).
    for (const row of db
      .select({ id: t.evidence.id })
      .from(t.evidence)
      .where(eq(t.evidence.repositoryId, repositoryId))
      .all()) {
      if (!ledgered.has(`evidence:${row.id}`)) {
        problems.push({
          code: 'MISSING_LEDGER_ENTRY',
          message: `Evidence ${row.id} has no ledger entry`,
          entityId: row.id,
        });
      }
    }
    const nodeVersionRows = db
      .select({ nodeId: t.nodeVersions.nodeId, version: t.nodeVersions.version })
      .from(t.nodeVersions)
      .innerJoin(t.nodes, eq(t.nodes.id, t.nodeVersions.nodeId))
      .where(eq(t.nodes.repositoryId, repositoryId))
      .all();
    for (const row of nodeVersionRows) {
      const key = `${row.nodeId}#${row.version}`;
      if (!ledgered.has(`node_version:${key}`)) {
        problems.push({
          code: 'MISSING_LEDGER_ENTRY',
          message: `Node version ${key} has no ledger entry`,
          entityId: key,
        });
      }
    }
    const edgeVersionRows = db
      .select({ edgeId: t.edgeVersions.edgeId, version: t.edgeVersions.version })
      .from(t.edgeVersions)
      .innerJoin(t.edges, eq(t.edges.id, t.edgeVersions.edgeId))
      .where(eq(t.edges.repositoryId, repositoryId))
      .all();
    for (const row of edgeVersionRows) {
      const key = `${row.edgeId}#${row.version}`;
      if (!ledgered.has(`edge_version:${key}`)) {
        problems.push({
          code: 'MISSING_LEDGER_ENTRY',
          message: `Edge version ${key} has no ledger entry`,
          entityId: key,
        });
      }
    }

    return {
      repositoryId,
      ok: problems.length === 0,
      ledgerEntriesChecked: entries.length,
      problems,
    };
  }

  function transaction<T>(fn: () => T): T {
    return db.transaction(() => fn());
  }

  return { transaction, repositories, evidence, nodes, edges, ledger, verifyIntegrity };
}
