import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  exportAtlas,
  impactMap,
  scanRepository,
  type ImpactMap,
  type ScanResult,
} from '@orbit/atlas';
import {
  createGraphStore,
  openDatabase,
  type GraphStore,
  type OrbitDatabase,
} from '@orbit/database';
import { OrbitError } from '@orbit/shared';

export interface ScanCommandOptions {
  db: string;
  key?: string;
  include?: string[];
  exclude?: string[];
  maxFiles?: number;
  maxCommits?: number;
  git: boolean;
  calls: boolean;
}

/** Scan a repository (read-only) and record the facts in the workspace database. */
export async function runScan(path: string, options: ScanCommandOptions): Promise<ScanResult> {
  const dbPath = resolve(options.db);
  const database = openDatabase({ path: dbPath });
  try {
    const store = createGraphStore(database);
    return await scanRepository({
      rootPath: path,
      store,
      ...(options.key !== undefined && { repositoryKey: options.key }),
      cacheDir: resolve(dirname(dbPath), 'cache'),
      config: {
        ...(options.include && { include: options.include }),
        ...(options.exclude && { exclude: options.exclude }),
        ...(options.maxFiles !== undefined && { maxFiles: options.maxFiles }),
        ...(options.maxCommits !== undefined && { maxCommits: options.maxCommits }),
        skipGit: !options.git,
        skipCalls: !options.calls,
      },
    });
  } finally {
    database.close();
  }
}

export function renderScan(result: ScanResult): string {
  const s = result.stats;
  const languages =
    Object.entries(s.byLanguage)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ') || 'none';
  const lines = [
    `Scanned ${result.repositoryKey}${result.head ? ` @ ${result.head.slice(0, 10)}` : ''}`,
    `Files      ${s.filesParsed} parsed (${s.filesFromCache} from cache), ${s.filesSkipped} skipped, ${s.filesNotParsed} vendor/generated not parsed`,
    `Languages  ${languages}`,
    `Symbols    ${s.symbols}`,
    `Imports    ${s.imports.total} (${s.imports.toFiles} to files, ${s.imports.toModules} to packages, ${s.imports.external} external, ${s.imports.assets} assets, ${s.imports.unresolved} unresolved)`,
    `Calls      ${s.calls.resolved} resolved of ${s.calls.total} (${s.calls.unresolved} unresolved; resolution is partial by design)`,
    `Graph      nodes +${result.changes.nodes.added} ~${result.changes.nodes.updated} -${result.changes.nodes.retired}, edges +${result.changes.edges.added} ~${result.changes.edges.updated} -${result.changes.edges.retired}`,
    `Cycles     ${result.analysis.fileCycles.length} runtime file, ${result.analysis.typeOnlyCycles.length} type-only, ${result.analysis.moduleCycles.length} module`,
    `Entries    ${result.analysis.entryPoints.length}`,
    `Commits    ${s.commitsIndexed}`,
  ];
  if (result.limitations.length > 0) {
    lines.push(
      '',
      'Limitations (evidence is PARTIAL):',
      ...result.limitations.map((l) => `  - ${l}`),
    );
  }
  return `${lines.join('\n')}\n`;
}

function openExisting(dbPath: string): { database: OrbitDatabase; store: GraphStore } {
  const database = openDatabase({ path: resolve(dbPath), migrate: false });
  return { database, store: createGraphStore(database) };
}

function pickRepository(store: GraphStore, key: string | undefined): string {
  const repositories = store.repositories.list();
  if (key !== undefined) {
    const found = repositories.find((r) => r.key === key);
    if (!found)
      throw new OrbitError('NOT_FOUND', `No scanned repository with key "${key}"`, {
        details: { key },
      });
    return found.id;
  }
  if (repositories.length === 1 && repositories[0]) return repositories[0].id;
  if (repositories.length === 0)
    throw new OrbitError(
      'NOT_FOUND',
      'Nothing has been scanned yet. Run `orbit scan <path>` first',
    );
  throw new OrbitError(
    'INVALID_INPUT',
    `Several repositories are scanned (${repositories.map((r) => r.key).join(', ')}); choose one with --repo`,
  );
}

export function runExport(
  dbPath: string,
  repo: string | undefined,
  out: string | undefined,
): string {
  const { database, store } = openExistingOrFail(dbPath);
  try {
    const json = `${JSON.stringify(exportAtlas(store, pickRepository(store, repo)), null, 2)}\n`;
    if (out === undefined) return json;
    const target = resolve(out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, json);
    return `Wrote ${target}\n`;
  } finally {
    database.close();
  }
}

export function runImpact(dbPath: string, repo: string | undefined, file: string): ImpactMap {
  const { database, store } = openExistingOrFail(dbPath);
  try {
    return impactMap(store, pickRepository(store, repo), file);
  } finally {
    database.close();
  }
}

function openExistingOrFail(dbPath: string): { database: OrbitDatabase; store: GraphStore } {
  const path = resolve(dbPath);
  // better-sqlite3 would silently create an empty file; read-only commands must not.
  if (!existsSync(path)) {
    throw new OrbitError(
      'NOT_FOUND',
      `No ORBIT database at ${path}. Run \`orbit scan <path>\` first`,
      { details: { path } },
    );
  }
  try {
    return openExisting(path);
  } catch (error) {
    throw new OrbitError('DATABASE_ERROR', `Could not read the database at ${path}`, {
      cause: error,
      details: { path },
    });
  }
}
