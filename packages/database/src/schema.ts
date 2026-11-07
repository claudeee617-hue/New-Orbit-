import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Workspace metadata (key/value). Mutable, unlike every graph table below.
 */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

export type MetaRow = typeof meta.$inferSelect;

// ---------------------------------------------------------------------------------------------
// ORBIT Core graph.
//
// Every table below is append-only: database triggers (see the immutability migration) abort any
// UPDATE or DELETE. History is kept by adding new versions, never by editing rows.
// ---------------------------------------------------------------------------------------------

export const repositories = sqliteTable('repositories', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const evidence = sqliteTable(
  'evidence',
  {
    /** Content-derived ID (see `evidenceIdFor`). */
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    source: text('source').notNull(),
    sourceType: text('source_type').notNull(),
    timestamp: text('timestamp'),
    commitSha: text('commit_sha'),
    locationPath: text('location_path'),
    locationStartLine: integer('location_start_line'),
    locationEndLine: integer('location_end_line'),
    contentHash: text('content_hash').notNull(),
    status: text('status').notNull(),
    limitationsJson: text('limitations_json').notNull(),
    relatedEntityIdsJson: text('related_entity_ids_json').notNull(),
    supersedes: text('supersedes'),
    recordedAt: text('recorded_at').notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.supersedes], foreignColumns: [table.id] }),
    index('evidence_repo_commit_idx').on(table.repositoryId, table.commitSha),
    index('evidence_repo_source_type_idx').on(table.repositoryId, table.sourceType),
    // A piece of evidence can be superseded at most once, keeping correction chains linear.
    uniqueIndex('evidence_supersedes_unique').on(table.supersedes),
  ],
);

/** Which entities (nodes, edges, …) a piece of evidence relates to. Enables "evidence for X". */
export const evidenceRefs = sqliteTable(
  'evidence_refs',
  {
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    evidenceId: text('evidence_id')
      .notNull()
      .references(() => evidence.id),
    entityId: text('entity_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.evidenceId, table.entityId] }),
    index('evidence_refs_entity_idx').on(table.repositoryId, table.entityId),
  ],
);

export const nodes = sqliteTable(
  'nodes',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    type: text('type').notNull(),
    key: text('key').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('nodes_identity_unique').on(table.repositoryId, table.type, table.key)],
);

export const nodeVersions = sqliteTable(
  'node_versions',
  {
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id),
    version: integer('version').notNull(),
    attrsJson: text('attrs_json').notNull(),
    attrsHash: text('attrs_hash').notNull(),
    /** 1 for a tombstone version that retires the node. */
    deleted: integer('deleted').notNull(),
    validFromCommit: text('valid_from_commit'),
    evidenceId: text('evidence_id')
      .notNull()
      .references(() => evidence.id),
    recordedAt: text('recorded_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.nodeId, table.version] })],
);

export const edges = sqliteTable(
  'edges',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    type: text('type').notNull(),
    fromId: text('from_id')
      .notNull()
      .references(() => nodes.id),
    toId: text('to_id')
      .notNull()
      .references(() => nodes.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('edges_identity_unique').on(
      table.repositoryId,
      table.type,
      table.fromId,
      table.toId,
    ),
    index('edges_from_idx').on(table.repositoryId, table.fromId, table.type),
    index('edges_to_idx').on(table.repositoryId, table.toId, table.type),
  ],
);

export const edgeVersions = sqliteTable(
  'edge_versions',
  {
    edgeId: text('edge_id')
      .notNull()
      .references(() => edges.id),
    version: integer('version').notNull(),
    attrsJson: text('attrs_json').notNull(),
    attrsHash: text('attrs_hash').notNull(),
    confidence: real('confidence'),
    deleted: integer('deleted').notNull(),
    validFromCommit: text('valid_from_commit'),
    evidenceId: text('evidence_id')
      .notNull()
      .references(() => evidence.id),
    recordedAt: text('recorded_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.edgeId, table.version] })],
);

/** Hash-chained, append-only event log. One independent chain per repository. */
export const ledger = sqliteTable(
  'ledger',
  {
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    seq: integer('seq').notNull(),
    ts: text('ts').notNull(),
    op: text('op').notNull(),
    entityKind: text('entity_kind').notNull(),
    entityId: text('entity_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (table) => [primaryKey({ columns: [table.repositoryId, table.seq] })],
);
