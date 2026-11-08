import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MEMORY_CATEGORIES,
  MemoryEngine,
  checkStaleness,
  combineProbes,
  diskFileProbe,
  findConflicts,
  graphFileProbe,
  importDocuments,
  linkMemoryToHistory,
  searchMemory,
  type MemoryItem,
  type SourceRef,
} from '@orbit/atlas';
import { createGraphStore, openDatabase, type OrbitDatabase } from '@orbit/database';
import { OrbitError } from '@orbit/shared';
import { pickRepository } from './atlas.js';

export interface MemoryCommandContext {
  db: string;
  repo?: string | undefined;
  /** Working tree of the scanned repository: staleness is then checked against files on disk. */
  root?: string | undefined;
  by: string;
}

export function withEngine<T>(ctx: MemoryCommandContext, fn: (engine: MemoryEngine) => T): T {
  const path = resolve(ctx.db);
  if (!existsSync(path)) {
    throw new OrbitError(
      'NOT_FOUND',
      `No ORBIT database at ${path}. Run \`orbit scan <path>\` first`,
      {
        details: { path },
      },
    );
  }
  const database: OrbitDatabase = openDatabase({ path });
  try {
    const store = createGraphStore(database);
    const repositoryId = pickRepository(store, ctx.repo);
    const graph = graphFileProbe(store, repositoryId);
    const probe = ctx.root ? combineProbes(diskFileProbe(ctx.root), graph) : graph;
    return fn(new MemoryEngine(store, repositoryId, { probe }));
  } finally {
    database.close();
  }
}

/** `src/a.ts`, `src/a.ts:10`, `src/a.ts:10-20`. */
export function parseFileRef(text: string): SourceRef {
  const match = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/.exec(text);
  if (!match?.[1])
    throw new OrbitError(
      'INVALID_INPUT',
      `Bad --file value "${text}" (use path or path:start-end)`,
    );
  const startLine = match[2] ? Number(match[2]) : undefined;
  const endLine = match[3] ? Number(match[3]) : startLine;
  return {
    kind: 'file',
    path: match[1],
    ...(startLine !== undefined && { startLine }),
    ...(endLine !== undefined && { endLine }),
  };
}

export function buildRefs(options: {
  file?: string[];
  commit?: string[];
  pr?: string[];
  issue?: string[];
  url?: string[];
}): SourceRef[] {
  const number = (v: string, what: string): number => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1)
      throw new OrbitError('INVALID_INPUT', `${what} must be a positive integer`);
    return n;
  };
  return [
    ...(options.file ?? []).map(parseFileRef),
    ...(options.commit ?? []).map((sha) => ({ kind: 'commit' as const, sha })),
    ...(options.pr ?? []).map((n) => ({
      kind: 'pull-request' as const,
      number: number(n, '--pr'),
    })),
    ...(options.issue ?? []).map((n) => ({ kind: 'issue' as const, number: number(n, '--issue') })),
    ...(options.url ?? []).map((url) => ({ kind: 'url' as const, url })),
  ];
}

export function renderItem(item: MemoryItem, verbose = false): string {
  const flags = [
    item.authoritative
      ? 'authoritative'
      : item.status === 'invalidated'
        ? 'INVALIDATED'
        : `not authoritative (${item.authority}${item.decisionStatus ? `, ${item.decisionStatus}` : ''})`,
    `v${item.version}`,
  ];
  const lines = [`${item.id}  [${flags.join(', ')}]`, `  ${item.title}`];
  if (verbose) {
    lines.push('', ...item.body.split('\n').map((l) => `  ${l}`), '');
    if (item.sourceRefs.length)
      lines.push(`  sources: ${item.sourceRefs.map(describeRef).join(', ')}`);
    if (item.tags.length) lines.push(`  tags: ${item.tags.join(', ')}`);
    if (item.supersededBy.length) lines.push(`  superseded by: ${item.supersededBy.join(', ')}`);
    if (item.supersedes.length) lines.push(`  supersedes: ${item.supersedes.join(', ')}`);
    if (item.invalidation)
      lines.push(`  invalidated by ${item.invalidation.by}: ${item.invalidation.reason}`);
    if (item.confirmation) lines.push(`  confirmed by ${item.confirmation.by}`);
    lines.push(`  evidence: ${item.evidenceId}`);
  }
  return lines.join('\n');
}

function describeRef(ref: SourceRef): string {
  switch (ref.kind) {
    case 'file':
      return `${ref.path}${ref.startLine ? `:${ref.startLine}${ref.endLine && ref.endLine !== ref.startLine ? `-${ref.endLine}` : ''}` : ''}`;
    case 'commit':
      return `commit ${ref.sha.slice(0, 10)}`;
    case 'pull-request':
      return `PR #${ref.number}`;
    case 'issue':
      return `issue #${ref.number}`;
    case 'url':
      return ref.url;
  }
}

export function runCheck(engine: MemoryEngine): {
  stale: ReturnType<typeof checkStaleness>;
  conflicts: ReturnType<typeof findConflicts>;
} {
  const items = engine.all();
  return {
    stale: checkStaleness(items, engine.probe).filter((f) => f.stale),
    conflicts: findConflicts(items),
  };
}

export { MEMORY_CATEGORIES, importDocuments, linkMemoryToHistory, searchMemory };
