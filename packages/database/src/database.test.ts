import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { IN_MEMORY, openDatabase, schema, type OrbitDatabase } from './index.js';

const opened: OrbitDatabase[] = [];
const tempDirs: string[] = [];

function track(database: OrbitDatabase): OrbitDatabase {
  opened.push(database);
  return database;
}

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('openDatabase', () => {
  it('opens an in-memory database, migrates it and reports health', () => {
    const database = track(openDatabase({ path: IN_MEMORY }));
    expect(database.isHealthy()).toBe(true);
    expect(database.schemaVersion()).toBeGreaterThanOrEqual(1);
  });

  it('reads and writes through drizzle', () => {
    const { db } = track(openDatabase({ path: IN_MEMORY }));
    db.insert(schema.meta).values({ key: 'workspace', value: 'demo' }).run();
    const row = db.select().from(schema.meta).where(eq(schema.meta.key, 'workspace')).get();
    expect(row?.value).toBe('demo');
    expect(row?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('creates missing parent directories for a file database and persists data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-db-'));
    tempDirs.push(dir);
    const path = join(dir, 'nested', 'orbit.db');

    const first = openDatabase({ path });
    first.db.insert(schema.meta).values({ key: 'k', value: 'v' }).run();
    first.close();
    expect(existsSync(path)).toBe(true);

    const second = track(openDatabase({ path }));
    const row = second.db.select().from(schema.meta).where(eq(schema.meta.key, 'k')).get();
    expect(row?.value).toBe('v');
  });

  it('applies migrations idempotently', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-db-'));
    tempDirs.push(dir);
    const path = join(dir, 'orbit.db');
    const first = openDatabase({ path });
    const version = first.schemaVersion();
    first.close();
    const second = track(openDatabase({ path }));
    expect(second.schemaVersion()).toBe(version);
  });

  it('reports schema version 0 and a healthy connection when migrations are skipped', () => {
    const database = track(openDatabase({ path: IN_MEMORY, migrate: false }));
    expect(database.schemaVersion()).toBe(0);
    expect(database.isHealthy()).toBe(true);
  });

  it('opens an existing file in read-only mode and rejects writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-db-ro-'));
    tempDirs.push(dir);
    const path = join(dir, 'orbit.db');
    const writable = openDatabase({ path });
    writable.db.insert(schema.meta).values({ key: 'locked', value: 'original' }).run();
    writable.close();

    const readonly = track(openDatabase({ path, migrate: false, readonly: true }));
    expect(readonly.isHealthy()).toBe(true);
    expect(() =>
      readonly.db.insert(schema.meta).values({ key: 'blocked', value: 'nope' }).run(),
    ).toThrow();
    expect(
      readonly.db.select().from(schema.meta).where(eq(schema.meta.key, 'locked')).get()?.value,
    ).toBe('original');
  });

  it('does not create a missing database when opening read-only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-db-ro-missing-'));
    tempDirs.push(dir);
    const path = join(dir, 'missing', 'orbit.db');
    expect(() => openDatabase({ path, migrate: false, readonly: true })).toThrowError(
      /Could not open/,
    );
    expect(existsSync(path)).toBe(false);
  });

  it('reports unhealthy after close', () => {
    const database = openDatabase({ path: IN_MEMORY });
    database.close();
    expect(database.isHealthy()).toBe(false);
  });

  it('throws a DATABASE_ERROR when the path cannot be opened', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-db-'));
    tempDirs.push(dir);
    // A directory cannot be opened as a database file.
    expect(() => openDatabase({ path: dir })).toThrowError(/Could not open/);
  });
});
