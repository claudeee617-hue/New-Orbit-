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

export interface OpenDatabaseOptions {
  path: string;
  /** Apply pending migrations after opening. Defaults to true. Ignored when `readOnly` is set. */
  migrate?: boolean;
  /**
   * Open an existing database read-only. SQLite itself refuses every write, so read-only
   * consumers (such as the MCP server) cannot change the workspace even by mistake. Never creates
   * the file or its directories and never migrates.
   */
  readOnly?: boolean;
}

/** Open (and by default migrate) a workspace database. Parent directories are created. */
export function openDatabase(options: OpenDatabaseOptions): OrbitDatabase {
  const isMemory = options.path === IN_MEMORY;
  const path = isMemory ? IN_MEMORY : resolve(options.path);

  let sqlite: Database.Database;
  try {
    if (options.readOnly) {
      if (isMemory) throw new Error('An in-memory database cannot be opened read-only');
      sqlite = new Database(path, { readonly: true, fileMustExist: true });
      sqlite.pragma('busy_timeout = 5000');
    } else {
      if (!isMemory) mkdirSync(dirname(path), { recursive: true });
      sqlite = new Database(path);
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('foreign_keys = ON');
      sqlite.pragma('busy_timeout = 5000');
    }
  } catch (error) {
    throw new OrbitError('DATABASE_ERROR', `Could not open the ORBIT database at ${path}`, {
      cause: error,
      details: { path },
    });
  }

  const db = drizzle(sqlite, { schema });

  if ((options.migrate ?? true) && !options.readOnly) {
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
