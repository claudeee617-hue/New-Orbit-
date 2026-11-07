import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from '@orbit/database';
import { ORBIT_VERSION, OrbitError } from '@orbit/shared';

export interface StatusReport {
  orbit: { version: string };
  node: { version: string };
  database: {
    path: string;
    /** False when no workspace database has been created yet. `status` never creates one. */
    exists: boolean;
    schemaVersion: number | null;
  };
}

/** Inspect the workspace without modifying it: no database is created and nothing is migrated. */
export function collectStatus(dbPath: string, nodeVersion: string = process.version): StatusReport {
  const path = resolve(dbPath);
  const base = { orbit: { version: ORBIT_VERSION }, node: { version: nodeVersion } };

  if (!existsSync(path)) {
    return { ...base, database: { path, exists: false, schemaVersion: null } };
  }

  let database;
  try {
    database = openDatabase({ path, migrate: false });
  } catch (error) {
    throw new OrbitError('DATABASE_ERROR', `Could not read the database at ${path}`, {
      cause: error,
      details: { path },
    });
  }
  try {
    return { ...base, database: { path, exists: true, schemaVersion: database.schemaVersion() } };
  } finally {
    database.close();
  }
}

export function renderStatus(report: StatusReport): string {
  const lines = [
    `ORBIT ${report.orbit.version}`,
    `Node  ${report.node.version}`,
    report.database.exists
      ? `Database  ${report.database.path} (schema version ${report.database.schemaVersion ?? 'unknown'})`
      : `Database  not initialised (${report.database.path} does not exist yet)`,
  ];
  return `${lines.join('\n')}\n`;
}
