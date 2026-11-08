import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { OrbitError } from '@orbit/shared';
import * as schema from './schema.js';

export * as schema from './schema.js';

/** Special SQLite path for an in-memory database (used by tests). */
export const IN_MEMORY = ':memory:';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

export interface OrbitDatabase {
  readonly path: string;
  readonly db: BetterSQLite3Database<typeof schema>;
  /** Number of migrations applied to this database. */
  schemaVersion(): number;
  /** True while the connection can answer a trivial query. */
  isHealthy(): boolean;
  close(): void;
}

/** Open an existing database with optional migration and read-only modes. */
export interface OpenDatabaseOptions {
  path: string;
  /** Apply pending migrations after opening. Defaults to true. */
  migrate?: boolean;
  /** Open an existing database without write access. Migrations are never run in read-only mode. */
  readonly?: boolean;
}

/** Open (and by default migrate) a workspace database. Read-only mode requires an existing file. */
export function openDatabase(options: OpenDatabaseOptions): OrbitDatabase {
  const isMemory = options.path === IN_MEMORY;
  const path = isMemory ? IN_MEMORY : resolve(options.path);

  let sqlite: Database.Database;
  try {
    if (!isMemory && !options.readonly) mkdirSync(dirname(path), { recursive: true });
    if (options.readonly && isMemory) {
      throw new Error('A read-only in-memory database is not supported');
    }
    sqlite = new Database(
      path,
      options.readonly ? { readonly: true, fileMustExist: true } : undefined,
    );
    if (!options.readonly) sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
  } catch (error) {
    throw new OrbitError('DATABASE_ERROR', `Could not open the ORBIT database at ${path}`, {
      cause: error,
      details: { path },
    });
  }

  const db = drizzle(sqlite, { schema });

  if (options.readonly && (options.migrate ?? false)) {
    sqlite.close();
    throw new OrbitError('INVALID_INPUT', 'Read-only databases cannot run migrations');
  }

  if (!options.readonly && (options.migrate ?? true)) {
    try {
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    } catch (error) {
      sqlite.close();
      throw new OrbitError('DATABASE_ERROR', 'Database migration failed', {
        cause: error,
        details: { path },
      });
    }
  }

  return {
    path,
    db,
    schemaVersion() {
      const hasTable = sqlite
        .prepare(
          "select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
        )
        .get();
      if (!hasTable) return 0;
      const row = sqlite.prepare('select count(*) as applied from __drizzle_migrations').get() as {
        applied: number;
      };
      return row.applied;
    },
    isHealthy() {
      try {
        sqlite.prepare('select 1').get();
        return sqlite.open;
      } catch {
        return false;
      }
    },
    close() {
      if (sqlite.open) sqlite.close();
    },
  };
}

export { createGraphStore } from './store.js';
export type {
  EdgeQuery,
  EvidenceQuery,
  GraphStore,
  GraphStoreOptions,
  NodeQuery,
} from './store.js';
