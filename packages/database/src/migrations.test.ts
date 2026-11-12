import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashArtifact } from '@orbit/core';
import { createGraphStore, openDatabase } from './index.js';

/**
 * Migration tests across every supported schema version. Each older schema is built by
 * applying only the first N shipped migrations (a truncated copy of the real drizzle folder),
 * real graph data is written with the real store, and the database is then opened with the
 * current code. Data, the hash-chained ledger and append-only guarantees must survive.
 */
const REAL_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));
const journal = JSON.parse(readFileSync(join(REAL_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { tag: string }[];
};
const LATEST = journal.entries.length;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orbit-migrate-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** Create a database file at schema version `applied` using the real migrations up to that point. */
function createAt(applied: number): string {
  const folder = join(dir, `folder-${String(applied)}`);
  cpSync(REAL_FOLDER, folder, { recursive: true });
  const partial = { ...JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) } as {
    entries: unknown[];
  };
  partial.entries = partial.entries.slice(0, applied);
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(partial));
  const path = join(dir, `v${String(applied)}.db`);
  const sqlite = new Database(path);
  migrate(drizzle(sqlite), { migrationsFolder: folder });
  sqlite.close();
  return path;
}

function seed(path: string): { repo: string; a: string; b: string; edge: string } {
  const database = openDatabase({ path, migrate: false });
  const store = createGraphStore(database);
  const repo = store.repositories.register({ key: 'github.com/acme/legacy' }).record.id;
  const ev = store.evidence.append({
    repositoryId: repo,
    source: 'git:parser',
    sourceType: 'parser',
    contentHash: hashArtifact('legacy-scan'),
    status: 'PASS',
    limitations: [],
    relatedEntityIds: [],
  }).record.id;
  const a = store.nodes.upsert({
    repositoryId: repo,
    type: 'File',
    key: 'src/a.ts',
    sourceEvidenceId: ev,
  }).record.id;
  const b = store.nodes.upsert({
    repositoryId: repo,
    type: 'File',
    key: 'src/b.ts',
    sourceEvidenceId: ev,
  }).record.id;
  const edge = store.edges.upsert({
    repositoryId: repo,
    type: 'IMPORTS',
    fromId: a,
    toId: b,
    sourceEvidenceId: ev,
  }).record.id;
  expect(store.verifyIntegrity(repo).ok).toBe(true);
  database.close();
  return { repo, a, b, edge };
}

describe('schema migrations', () => {
  it('ships a contiguous, non-empty journal', () => {
    expect(LATEST).toBeGreaterThanOrEqual(4);
  });

  for (const applied of [0, 1, 2]) {
    it(`upgrades an empty schema at version ${String(applied)} to the latest`, () => {
      const path = createAt(applied);
      const database = openDatabase({ path });
      expect(database.schemaVersion()).toBe(LATEST);
      expect(database.isHealthy()).toBe(true);
      database.close();
    });
  }

  for (let applied = 3; applied < LATEST; applied++) {
    it(`upgrades a populated schema at version ${String(applied)}, keeping data and ledger integrity`, () => {
      const path = createAt(applied);
      const { repo, a, b, edge } = seed(path);

      const database = openDatabase({ path });
      expect(database.schemaVersion()).toBe(LATEST);
      const store = createGraphStore(database);
      expect(store.repositories.list().map((r) => r.key)).toEqual(['github.com/acme/legacy']);
      expect(store.nodes.get(repo, a)?.key).toBe('src/a.ts');
      expect(store.nodes.get(repo, b)?.key).toBe('src/b.ts');
      expect(store.edges.get(repo, edge)?.type).toBe('IMPORTS');
      expect(store.verifyIntegrity(repo).ok).toBe(true);
      expect(store.ledger.head(repo)).toBeDefined();
      database.close();
    });
  }

  it('is idempotent: reopening a fully migrated database changes nothing', () => {
    const path = createAt(3);
    const { repo } = seed(path);
    const first = openDatabase({ path });
    const head = createGraphStore(first).ledger.head(repo);
    first.close();
    const second = openDatabase({ path });
    expect(second.schemaVersion()).toBe(LATEST);
    expect(createGraphStore(second).ledger.head(repo)).toEqual(head);
    second.close();
  });

  it('stays append-only after upgrading (history cannot be rewritten)', () => {
    const path = createAt(3);
    const { repo } = seed(path);
    const database = openDatabase({ path });
    const sqlite = new Database(path);
    expect(() => sqlite.prepare('delete from evidence').run()).toThrow(/ORBIT_IMMUTABLE/);
    sqlite.close();
    expect(createGraphStore(database).verifyIntegrity(repo).ok).toBe(true);
    database.close();
  });

  it('refuses to migrate in read-only mode and leaves an old schema untouched', () => {
    const path = createAt(3);
    seed(path);
    const readonly = openDatabase({ path, readonly: true });
    expect(readonly.schemaVersion()).toBe(3);
    readonly.close();
    expect(() => openDatabase({ path, readonly: true, migrate: true })).toThrow(/Read-only/);
  });
});
