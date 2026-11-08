import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IN_MEMORY,
  createGraphStore,
  openDatabase,
  type GraphStore,
  type OrbitDatabase,
} from '@orbit/database';
import {
  MemoryEngine,
  checkStaleness,
  combineProbes,
  diskFileProbe,
  findConflicts,
  graphFileProbe,
  importDocuments,
  isAdrPath,
  linkMemoryToHistory,
  parseAdr,
  scanRepository,
  searchMemory,
} from '../index.js';

let db: OrbitDatabase;
let store: GraphStore;
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-mem-'));
  dirs.push(dir);
  return dir;
}
function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}
function engineFor(key = 'demo', root?: string): MemoryEngine {
  const repo = store.repositories.register({ key, displayName: key }).record;
  return new MemoryEngine(store, repo.id, root ? { probe: diskFileProbe(root) } : {});
}

beforeEach(() => {
  db = openDatabase({ path: IN_MEMORY });
  store = createGraphStore(db, { now: () => '2026-11-08T00:00:00.000Z' });
});
afterEach(() => {
  db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const base = {
  category: 'architecture-decision' as const,
  title: 'Use SQLite for local storage',
  body: 'ORBIT stores everything in a single SQLite file. We never require a network database.',
  createdBy: 'claudy',
};

describe('creating memory', () => {
  it('stores an item as a graph node with evidence and a stable id', () => {
    const engine = engineFor();
    const item = engine.create({ ...base, tags: ['Storage'], topic: 'database', choice: 'sqlite' });
    expect(item.id).toBe('memory/architecture-decision/use-sqlite-for-local-storage');
    expect(item.version).toBe(1);
    expect(item.authority).toBe('human');
    expect(item.authoritative).toBe(true);
    expect(item.tags).toEqual(['storage']);
    const evidence = store.evidence.get(engine.repositoryId, item.evidenceId);
    expect(evidence?.sourceType).toBe('manual');
    expect(evidence?.status).toBe('PARTIAL');
    expect(evidence?.limitations.join(' ')).toMatch(/not verify/i);
    expect(store.verifyIntegrity(engine.repositoryId).ok).toBe(true);
  });

  it('uses Decision nodes for normative categories and Documentation for descriptive ones', () => {
    const engine = engineFor();
    engine.create(base);
    engine.create({ ...base, category: 'known-bug', title: 'Race in cache writer' });
    expect(
      store.nodes.find(engine.repositoryId, { type: 'Decision', keyPrefix: 'memory/' }),
    ).toHaveLength(1);
    expect(
      store.nodes.find(engine.repositoryId, { type: 'Documentation', keyPrefix: 'memory/' }),
    ).toHaveLength(1);
  });

  it('rejects a duplicate instead of silently replacing it', () => {
    const engine = engineFor();
    engine.create(base);
    expect(() => engine.create(base)).toThrowError(/already exists/);
    expect(engine.all()).toHaveLength(1);
  });

  it.each([
    ['empty body', { ...base, body: '   ' }],
    ['unknown category', { ...base, category: 'vibes' }],
    ['email as author', { ...base, createdBy: 'me@example.com' }],
    ['absolute source path', { ...base, sourceRefs: [{ kind: 'file', path: '/etc/passwd' }] }],
    ['path traversal', { ...base, sourceRefs: [{ kind: 'file', path: '../secret.txt' }] }],
    ['unknown field', { ...base, imported: true }],
    ['imported authority', { ...base, authority: 'imported' }],
  ])('rejects invalid input: %s', (_name, input) => {
    expect(() => engineFor().create(input as never)).toThrowError(/Invalid memory/);
  });

  it('keeps memory of different repositories apart', () => {
    const a = engineFor('repo-a');
    const b = engineFor('repo-b');
    a.create(base);
    expect(b.all()).toHaveLength(0);
    expect(b.get('memory/architecture-decision/use-sqlite-for-local-storage')).toBeUndefined();
    b.create(base);
    expect(a.all()).toHaveLength(1);
    expect(b.all()).toHaveLength(1);
  });
});

describe('AI-generated memory is never silently authoritative', () => {
  it('labels it, records ai-note evidence that cannot be PASS, and excludes it from authoritative search', () => {
    const engine = engineFor();
    const ai = engine.create({ ...base, authority: 'ai-suggested', createdBy: 'ai:claude' });
    expect(ai.authoritative).toBe(false);
    const evidence = store.evidence.get(engine.repositoryId, ai.evidenceId);
    expect(evidence?.sourceType).toBe('ai-note');
    expect(evidence?.status).not.toBe('PASS');
    const all = searchMemory(engine.all(), { text: 'sqlite' });
    expect(all.hits).toHaveLength(1);
    const strict = searchMemory(engine.all(), { text: 'sqlite', authoritativeOnly: true });
    expect(strict.hits).toHaveLength(0);
    expect(strict.hiddenUnverified).toBe(1);
  });

  it('becomes authoritative only after a person confirms it, and keeps both versions', () => {
    const engine = engineFor();
    const ai = engine.create({ ...base, authority: 'ai-suggested', createdBy: 'ai:claude' });
    expect(() => engine.confirm(ai.id, { confirmedBy: 'ai:claude' })).toThrowError(/only a person/);
    const confirmed = engine.confirm(ai.id, {
      confirmedBy: 'claudy',
      note: 'checked with the team',
    });
    expect(confirmed.authority).toBe('human');
    expect(confirmed.authoritative).toBe(true);
    expect(confirmed.confirmation?.by).toBe('claudy');
    const history = engine.history(ai.id);
    expect(history.map((h) => h.item.authority)).toEqual(['ai-suggested', 'human']);
    expect(() => engine.confirm(ai.id, { confirmedBy: 'claudy' })).toThrowError(
      /not an AI suggestion/,
    );
  });

  it('cannot take part in conflicts while unconfirmed', () => {
    const engine = engineFor();
    engine.create({ ...base, topic: 'database', choice: 'sqlite' });
    engine.create({
      ...base,
      title: 'Use Postgres',
      slug: 'use-postgres',
      topic: 'database',
      choice: 'postgres',
      authority: 'ai-suggested',
      createdBy: 'ai:claude',
    });
    expect(findConflicts(engine.all())).toEqual([]);
  });
});

describe('updating, invalidating and history', () => {
  it('appends versions with reasons and never loses the old text', () => {
    const engine = engineFor();
    const first = engine.create(base);
    const second = engine.update(first.id, {
      body: 'Use SQLite via better-sqlite3.',
      reason: 'name the driver',
      updatedBy: 'claudy',
    });
    expect(second.version).toBe(2);
    expect(second.changeReason).toBe('name the driver');
    const history = engine.history(first.id);
    expect(history).toHaveLength(2);
    expect(history[0]?.item.body).toBe(base.body);
    expect(history[1]?.item.body).toBe('Use SQLite via better-sqlite3.');
    expect(history[0]?.evidenceId).not.toBe(history[1]?.evidenceId);
  });

  it('requires a reason and at least one change', () => {
    const engine = engineFor();
    const item = engine.create(base);
    expect(() => engine.update(item.id, { body: 'x', updatedBy: 'a' } as never)).toThrowError(
      /Invalid memory update/,
    );
    expect(() => engine.update(item.id, { reason: 'why', updatedBy: 'a' })).toThrowError(
      /nothing to update/,
    );
  });

  it('invalidates with a reason: hidden from default search, still in history, cannot be edited', () => {
    const engine = engineFor();
    const item = engine.create(base);
    const invalid = engine.invalidate(item.id, {
      reason: 'moved to Postgres',
      invalidatedBy: 'claudy',
    });
    expect(invalid.status).toBe('invalidated');
    expect(invalid.authoritative).toBe(false);
    expect(invalid.invalidation).toEqual({ reason: 'moved to Postgres', by: 'claudy' });
    expect(searchMemory(engine.all(), { text: 'sqlite' }).hits).toHaveLength(0);
    expect(
      searchMemory(engine.all(), { text: 'sqlite', includeInvalidated: true }).hits,
    ).toHaveLength(1);
    expect(engine.history(item.id)).toHaveLength(2);
    expect(() => engine.update(item.id, { body: 'x', reason: 'r', updatedBy: 'a' })).toThrowError(
      /invalidated/,
    );
    expect(() => engine.invalidate(item.id, { reason: 'again', invalidatedBy: 'a' })).toThrowError(
      /already invalidated/,
    );
    const back = engine.reinstate(item.id, { reason: 'mistake', by: 'claudy' });
    expect(back.status).toBe('active');
    expect(back.invalidation).toBeUndefined();
    expect(engine.history(item.id)).toHaveLength(3);
  });

  it('links a replacement with SUPERSEDES and stops treating the old item as authoritative', () => {
    const engine = engineFor();
    const old = engine.create(base);
    const next = engine.create({
      ...base,
      title: 'Use Postgres',
      slug: 'use-postgres',
      body: 'Use Postgres from now on.',
    });
    const done = engine.invalidate(old.id, {
      reason: 'replaced',
      invalidatedBy: 'claudy',
      supersededBy: next.id,
    });
    expect(done.supersededBy).toEqual([next.id]);
    expect(engine.get(next.id)?.supersedes).toEqual([old.id]);
    expect(() =>
      engine.invalidate(next.id, { reason: 'x', invalidatedBy: 'a', supersededBy: next.id }),
    ).toThrowError(/different, active/);
  });

  it('refuses to be superseded by the other kind of memory', () => {
    const engine = engineFor();
    const decision = engine.create(base);
    const bug = engine.create({ ...base, category: 'known-bug', title: 'Cache race' });
    expect(() =>
      engine.invalidate(decision.id, { reason: 'x', invalidatedBy: 'a', supersededBy: bug.id }),
    ).toThrowError(/same kind/);
  });

  it('reports unknown ids and malformed ids clearly', () => {
    const engine = engineFor();
    expect(() => engine.history('memory/known-bug/nope')).toThrowError(/No memory/);
    expect(() => engine.history('adr-3')).toThrowError(/not a memory id/);
    expect(engine.get('memory/known-bug/nope')).toBeUndefined();
  });

  it('keeps the ledger intact through all of it', () => {
    const engine = engineFor();
    const item = engine.create(base);
    engine.update(item.id, { body: 'changed', reason: 'r', updatedBy: 'a' });
    engine.invalidate(item.id, { reason: 'r', invalidatedBy: 'a' });
    const report = store.verifyIntegrity(engine.repositoryId);
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
  });
});

describe('search', () => {
  function seeded(): MemoryEngine {
    const engine = engineFor();
    engine.create(base);
    engine.create({
      category: 'known-bug',
      title: 'Cache writer race',
      body: 'Two writers can corrupt the cache file on Windows.',
      createdBy: 'c',
      tags: ['cache'],
    });
    engine.create({
      category: 'team-convention',
      title: 'Commit style',
      body: 'Use conventional commits. Every commit needs a test.',
      createdBy: 'c',
    });
    return engine;
  }

  it('ranks by relevance and is deterministic', () => {
    const engine = seeded();
    const one = searchMemory(engine.all(), { text: 'cache writer corrupt' });
    const two = searchMemory(engine.all(), { text: 'cache writer corrupt' });
    expect(one).toEqual(two);
    expect(one.hits[0]?.item.id).toBe('memory/known-bug/cache-writer-race');
    expect(one.hits[0]?.matched).toContain('title');
    expect(one.hits[0]?.snippet.length).toBeLessThanOrEqual(260);
  });

  it('filters by category, tag and cited path and bounds the result', () => {
    const engine = seeded();
    expect(searchMemory(engine.all(), { categories: ['team-convention'] }).hits).toHaveLength(1);
    expect(searchMemory(engine.all(), { tag: 'cache' }).hits).toHaveLength(1);
    const limited = searchMemory(engine.all(), { limit: 2 });
    expect(limited.hits).toHaveLength(2);
    expect(limited.total).toBe(3);
    expect(limited.truncated).toBe(true);
    expect(() => searchMemory(engine.all(), { limit: 1000 })).toThrowError(/limit/);
    expect(searchMemory(engine.all(), { text: 'zebra giraffe' }).hits).toEqual([]);
  });
});

describe('staleness detection', () => {
  it('flags memory whose cited file changed or disappeared, and only that', () => {
    const root = tempDir();
    write(root, {
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 1;\n',
      'src/c.ts': 'export const c = 1;\n',
    });
    const engine = engineFor('demo', root);
    const refs = (p: string) => [{ kind: 'file' as const, path: p, startLine: 1, endLine: 1 }];
    const a = engine.create({ ...base, slug: 'a', title: 'About a', sourceRefs: refs('src/a.ts') });
    const b = engine.create({ ...base, slug: 'b', title: 'About b', sourceRefs: refs('src/b.ts') });
    const c = engine.create({ ...base, slug: 'c', title: 'About c', sourceRefs: refs('src/c.ts') });
    const none = engine.create({ ...base, slug: 'n', title: 'No sources' });
    expect(a.sourceRefs[0]).toMatchObject({ contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) });

    write(root, { 'src/a.ts': 'export const a = 2;\n' });
    unlinkSync(join(root, 'src/b.ts'));
    const findings = checkStaleness(engine.all(), engine.probe);
    const byId = new Map(findings.map((f) => [f.id, f]));
    expect(byId.get(a.id)?.stale).toBe(true);
    expect(byId.get(a.id)?.reasons[0]).toMatchObject({ kind: 'file-changed', path: 'src/a.ts' });
    expect(byId.get(b.id)?.reasons[0]?.kind).toBe('file-removed');
    expect(byId.get(c.id)?.stale).toBe(false);
    expect(byId.get(none.id)).toMatchObject({ stale: false, noFileSources: true });
  });

  it('updating re-baselines the hashes, which clears the stale flag', () => {
    const root = tempDir();
    write(root, { 'src/a.ts': 'one\n' });
    const engine = engineFor('demo', root);
    const item = engine.create({ ...base, sourceRefs: [{ kind: 'file', path: 'src/a.ts' }] });
    write(root, { 'src/a.ts': 'two\n' });
    expect(checkStaleness(engine.all(), engine.probe)[0]?.stale).toBe(true);
    engine.update(item.id, {
      tags: ['checked'],
      reason: 're-verified against current file',
      updatedBy: 'claudy',
    });
    expect(checkStaleness(engine.all(), engine.probe)[0]?.stale).toBe(false);
  });

  it('never calls unknown files stale', () => {
    const engine = engineFor();
    engine.create({ ...base, sourceRefs: [{ kind: 'file', path: 'src/never-scanned.ts' }] });
    const finding = checkStaleness(engine.all(), engine.probe)[0];
    expect(finding?.stale).toBe(false);
    expect(finding?.unverifiable).toEqual(['src/never-scanned.ts']);
  });

  it('can use hashes ATLAS stored in the graph, and prefers the disk when both are available', async () => {
    const root = tempDir();
    write(root, { 'src/a.ts': 'export function a() { return 1; }\n' });
    const result = await scanRepository({
      rootPath: root,
      store,
      repositoryKey: 'scanned',
      cacheDir: tempDir(),
      config: { skipGit: true },
    });
    const fromGraph = graphFileProbe(store, result.repositoryId)('src/a.ts');
    expect(fromGraph?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(diskFileProbe(root)('src/a.ts')?.hash).toBe(fromGraph?.hash);
    expect(
      combineProbes(diskFileProbe(root), graphFileProbe(store, result.repositoryId))('src/a.ts')
        ?.exists,
    ).toBe(true);
    expect(diskFileProbe(root)('../outside.txt')).toBeUndefined();
  });
});

describe('conflicting decisions', () => {
  it('reports the same topic with different choices (exact)', () => {
    const engine = engineFor();
    engine.create({ ...base, topic: 'database', choice: 'SQLite' });
    engine.create({
      ...base,
      slug: 'pg',
      title: 'Use Postgres',
      topic: 'database',
      choice: 'Postgres',
    });
    const conflicts = findConflicts(engine.all());
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'same-topic-different-choice', heuristic: false });
    expect(conflicts[0]?.explanation).toMatch(/"Postgres" vs "SQLite"/);
  });

  it('does not flag the same choice, or different topics', () => {
    const engine = engineFor();
    engine.create({ ...base, topic: 'database', choice: 'SQLite' });
    engine.create({
      ...base,
      slug: 'two',
      title: 'Also SQLite',
      topic: 'database',
      choice: 'sqlite',
    });
    engine.create({
      ...base,
      slug: 'three',
      title: 'Pick a linter',
      topic: 'lint',
      choice: 'eslint',
    });
    expect(findConflicts(engine.all())).toEqual([]);
  });

  it('flags opposing statements about the same thing as heuristic, and clearing one clears it', () => {
    const engine = engineFor();
    const never = engine.create({
      category: 'design-constraint',
      title: 'No network database',
      body: 'Never use a network database server for the workspace storage layer.',
      tags: ['storage'],
      createdBy: 'a',
    });
    engine.create({
      category: 'design-constraint',
      title: 'Storage layer',
      body: 'Always use a network database server for the workspace storage layer.',
      tags: ['storage'],
      createdBy: 'a',
    });
    const conflicts = findConflicts(engine.all());
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'opposing-statements', heuristic: true });
    expect(conflicts[0]?.sharedTerms.length).toBeGreaterThanOrEqual(3);
    engine.invalidate(never.id, { reason: 'resolved', invalidatedBy: 'a' });
    expect(findConflicts(engine.all())).toEqual([]);
  });

  it('ignores unrelated items that merely share wording but no scope', () => {
    const engine = engineFor();
    engine.create({
      category: 'design-constraint',
      title: 'A',
      body: 'Never use a network database server for storage layer.',
      createdBy: 'a',
    });
    engine.create({
      category: 'design-constraint',
      title: 'B',
      slug: 'b',
      body: 'Always use a network database server for storage layer.',
      createdBy: 'a',
    });
    expect(findConflicts(engine.all())).toEqual([]);
  });
});

const ADR_3 = `# ADR-0003: SQLite with graph tables

Status: Accepted · Date: 2026-11-07

## Context
We need local-first storage with relationships and history.

## Decision
Use indexed SQLite tables. Never introduce a graph database without measured need.

## Consequences
Deep traversals may need recursive queries.
`;
const ADR_7 = `# 7. Use PostgreSQL

## Status
Accepted. Supersedes ADR-0003.

## Decision
Use PostgreSQL for the workspace.
`;
const ADR_PROPOSED = `# ADR-0009: Maybe use Redis

Status: Proposed

## Decision
Use Redis as a cache.
`;

describe('importing ADRs and documents', () => {
  it('recognises ADR paths', () => {
    expect(isAdrPath('docs/adr/0001-record.md')).toBe(true);
    expect(isAdrPath('docs/DECISIONS/0003-sqlite.md')).toBe(true);
    expect(isAdrPath('docs/adr/README.md')).toBe(false);
    expect(isAdrPath('docs/guide.md')).toBe(false);
    expect(isAdrPath('src/0003-notes.ts')).toBe(false);
  });

  it('parses both common ADR layouts', () => {
    const a = parseAdr(ADR_3, 'docs/adr/0003-sqlite.md');
    expect(a).toMatchObject({ number: 3, title: 'SQLite with graph tables', status: 'accepted' });
    expect(a.body).toContain('Decision: Use indexed SQLite');
    expect(a.body).toContain('Context: We need local-first');
    const b = parseAdr(ADR_7, 'docs/adr/0007-postgres.md');
    expect(b).toMatchObject({
      number: 7,
      title: 'Use PostgreSQL',
      status: 'accepted',
      supersedesAdr: [3],
    });
    expect(
      parseAdr('# ADR-0004: Old\n\nStatus: Superseded by ADR-0007\n', 'a/0004-old.md')
        .supersededByAdr,
    ).toEqual([7]);
  });

  it('imports ADRs as imported-authority memory with file source, hash and line range', () => {
    const root = tempDir();
    write(root, { 'docs/adr/0003-sqlite.md': ADR_3, 'docs/adr/0009-redis.md': ADR_PROPOSED });
    const engine = engineFor('demo', root);
    const result = importDocuments(engine, { rootPath: root, docs: false });
    expect(result.created).toBe(2);
    const sqlite = engine.get('memory/architecture-decision/adr-0003-sqlite');
    expect(sqlite).toMatchObject({
      authority: 'imported',
      authoritative: true,
      adrNumber: 3,
      decisionStatus: 'accepted',
    });
    expect(sqlite?.sourceRefs[0]).toMatchObject({
      kind: 'file',
      path: 'docs/adr/0003-sqlite.md',
      contentHash: expect.any(String),
    });
    expect(store.evidence.get(engine.repositoryId, sqlite?.evidenceId ?? '')).toMatchObject({
      sourceType: 'parser',
      status: 'PASS',
    });
    const proposed = engine.get('memory/architecture-decision/adr-0009-redis');
    expect(proposed?.authoritative).toBe(false);
    expect(proposed?.decisionStatus).toBe('proposed');
  });

  it('is idempotent, versions a changed document, and detects it as stale-then-fresh', () => {
    const root = tempDir();
    write(root, { 'docs/adr/0003-sqlite.md': ADR_3 });
    const engine = engineFor('demo', root);
    importDocuments(engine, { rootPath: root, docs: false });
    const again = importDocuments(engine, { rootPath: root, docs: false });
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    write(root, {
      'docs/adr/0003-sqlite.md': ADR_3.replace(
        'Use indexed SQLite tables.',
        'Use indexed SQLite tables and WAL.',
      ),
    });
    expect(checkStaleness(engine.all(), engine.probe)[0]?.stale).toBe(true);
    const changed = importDocuments(engine, { rootPath: root, docs: false });
    expect(changed.updated).toBe(1);
    const item = engine.get('memory/architecture-decision/adr-0003-sqlite');
    expect(item?.version).toBe(2);
    expect(item?.body).toContain('WAL');
    expect(checkStaleness(engine.all(), engine.probe)[0]?.stale).toBe(false);
  });

  it('turns "Supersedes ADR-n" into a SUPERSEDES link and demotes the older ADR', () => {
    const root = tempDir();
    write(root, { 'docs/adr/0003-sqlite.md': ADR_3, 'docs/adr/0007-postgres.md': ADR_7 });
    const engine = engineFor('demo', root);
    const result = importDocuments(engine, { rootPath: root, docs: false });
    expect(result.supersessionLinks).toBe(1);
    const old = engine.get('memory/architecture-decision/adr-0003-sqlite');
    const next = engine.get('memory/architecture-decision/adr-0007-postgres');
    expect(old?.supersededBy).toEqual([next?.id]);
    expect(old?.authoritative).toBe(false);
    expect(next?.authoritative).toBe(true);
    expect(importDocuments(engine, { rootPath: root, docs: false }).supersessionLinks).toBe(0);
  });

  it('does not overwrite memory a person took over', () => {
    const root = tempDir();
    write(root, { 'docs/adr/0003-sqlite.md': ADR_3 });
    const engine = engineFor('demo', root);
    engine.create({
      category: 'architecture-decision',
      slug: 'adr-0003-sqlite',
      title: 'Mine',
      body: 'Hand written.',
      createdBy: 'claudy',
    });
    const result = importDocuments(engine, { rootPath: root, docs: false });
    expect(result.skipped).toBe(1);
    expect(engine.get('memory/architecture-decision/adr-0003-sqlite')?.title).toBe('Mine');
  });

  it('imports other documents as bounded excerpts and respects the cap', () => {
    const root = tempDir();
    write(root, {
      'README.md': `# Demo\n\n[![ci](x)](y)\n\n${'Real text. '.repeat(400)}\n`,
      'CONTRIBUTING.md': '# Contributing\n\nRun the tests before every commit.\n',
      'docs/setup.md': '# Setup\n\nInstall Node 22.\n',
      'docs/api/overview.md': '# API\n\nREST over HTTP.\n',
      'node_modules/pkg/README.md': '# ignored\n\nno\n',
    });
    const engine = engineFor('demo', root);
    const result = importDocuments(engine, { rootPath: root, maxDocs: 3 });
    expect(result.entries.filter((e) => e.kind === 'doc')).toHaveLength(3);
    expect(result.limitations.join(' ')).toMatch(/1 further document/);
    const readme = engine.get('memory/repository-discovery/doc-readme');
    expect(readme?.excerpt).toBe(true);
    expect(readme?.body.length).toBeLessThanOrEqual(1501);
    expect(readme?.body).not.toContain('[![ci]');
    expect(engine.get('memory/team-convention/doc-contributing')?.authority).toBe('imported');
    expect(engine.all().some((i) => i.id.includes('node_modules'))).toBe(false);
  });

  it('does not follow symlinks out of the repository', () => {
    const root = tempDir();
    const outside = tempDir();
    write(outside, { 'secret.md': '# Secret\n\nDo not import.\n' });
    write(root, { 'docs/ok.md': '# Ok\n\nFine.\n' });
    try {
      execFileSync('ln', ['-s', join(outside, 'secret.md'), join(root, 'docs/link.md')]);
    } catch {
      return; // cannot create symlinks here
    }
    const engine = engineFor('demo', root);
    importDocuments(engine, { rootPath: root });
    expect(engine.all().map((i) => i.title)).toEqual(['Ok']);
  });
});

describe('linking git history', () => {
  function gitRepo(): string {
    const root = tempDir();
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=t@example.com',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd: root, stdio: 'pipe' },
      );
    git('init', '-q', '-b', 'main');
    write(root, {
      'docs/adr/0003-sqlite.md': ADR_3,
      'src/a.ts': 'export function a() { return 1; }\n',
    });
    git('add', '.');
    git('commit', '-q', '-m', 'Add storage layer per ADR-0003 (#12)');
    write(root, { 'src/a.ts': 'export function a() { return 2; }\n' });
    git('commit', '-q', '-am', 'Fix cache race, fixes #34');
    write(root, { 'src/b.ts': 'export const b = 1;\n' });
    git('add', '.');
    git('commit', '-q', '-m', 'Unrelated change');
    return root;
  }

  it('links commits, PRs and issues to decisions only where the text supports it', async () => {
    const root = gitRepo();
    const scan = await scanRepository({
      rootPath: root,
      store,
      repositoryKey: 'git-demo',
      cacheDir: tempDir(),
    });
    const engine = new MemoryEngine(store, scan.repositoryId, { probe: diskFileProbe(root) });
    importDocuments(engine, { rootPath: root, docs: false });
    const result = linkMemoryToHistory(engine);

    const adrLinks = result.links.filter((l) => l.memoryId.endsWith('adr-0003-sqlite'));
    expect(adrLinks.map((l) => l.targetType).sort()).toEqual(['Commit', 'PullRequest']);
    const commitLink = adrLinks.find((l) => l.targetType === 'Commit');
    expect(commitLink).toMatchObject({ confidence: 0.95, basis: 'subject cites ADR-3' });
    expect(adrLinks.find((l) => l.targetType === 'PullRequest')).toMatchObject({ target: 'pr/12' });
    expect(result.links.some((l) => l.targetType === 'Issue')).toBe(false);
    expect(result.fixes).toBe(1);
    expect(result.limitations.join(' ')).toMatch(/subjects/);

    const adrNode = store.nodes.find(scan.repositoryId, {
      type: 'Decision',
      keyPrefix: 'memory/',
    })[0];
    const edges = store.edges.list(scan.repositoryId, {
      fromId: adrNode?.id ?? '',
      types: ['DOCUMENTS'],
    });
    expect(edges.filter((e) => e.attrs['producer'] === 'memory-link')).toHaveLength(2);
    expect(store.nodes.find(scan.repositoryId, { type: 'PullRequest' })).toHaveLength(1);
    expect(store.nodes.find(scan.repositoryId, { type: 'Issue' })).toHaveLength(1);
    expect(store.edges.list(scan.repositoryId, { types: ['FIXES'] })).toHaveLength(1);
    expect(store.verifyIntegrity(scan.repositoryId).ok).toBe(true);
  });

  it('is idempotent and retires links that are no longer supported', async () => {
    const root = gitRepo();
    const scan = await scanRepository({
      rootPath: root,
      store,
      repositoryKey: 'git-demo',
      cacheDir: tempDir(),
    });
    const engine = new MemoryEngine(store, scan.repositoryId, { probe: diskFileProbe(root) });
    importDocuments(engine, { rootPath: root, docs: false });
    linkMemoryToHistory(engine);
    const before = store.ledger.head(scan.repositoryId)?.seq;
    const second = linkMemoryToHistory(engine);
    expect(second.retired).toBe(0);
    expect(store.ledger.head(scan.repositoryId)?.seq).toBe(before);

    engine.invalidate('memory/architecture-decision/adr-0003-sqlite', {
      reason: 'obsolete',
      invalidatedBy: 'claudy',
    });
    const third = linkMemoryToHistory(engine);
    expect(third.links.filter((l) => l.memoryId.endsWith('adr-0003-sqlite'))).toEqual([]);
    expect(third.retired).toBeGreaterThanOrEqual(2);
  });

  it('links explicit commit references with full confidence and reports unknown ones', async () => {
    const root = gitRepo();
    const scan = await scanRepository({
      rootPath: root,
      store,
      repositoryKey: 'git-demo',
      cacheDir: tempDir(),
    });
    const engine = new MemoryEngine(store, scan.repositoryId);
    const sha = execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: root }).toString().trim();
    engine.create({
      category: 'historical-fix',
      title: 'Cache race fix',
      body: 'Serialised the cache writer.',
      createdBy: 'claudy',
      sourceRefs: [
        { kind: 'commit', sha: sha.slice(0, 10) },
        { kind: 'commit', sha: 'deadbeefcafe' },
        { kind: 'issue', number: 34 },
      ],
    });
    const result = linkMemoryToHistory(engine);
    const links = result.links.filter((l) => l.memoryId.includes('cache-race-fix'));
    expect(links.find((l) => l.targetType === 'Commit')).toMatchObject({
      target: sha,
      confidence: 1,
      basis: 'explicit source reference',
    });
    expect(links.find((l) => l.targetType === 'Issue')).toMatchObject({
      target: 'issue/34',
      confidence: 1,
    });
    expect(result.limitations.join(' ')).toMatch(/deadbeefca.*not in the indexed history/);
  });
});
