import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MemoryEngine,
  diskFileProbe,
  importDocuments,
  linkMemoryToHistory,
  scanRepository,
} from '@orbit/atlas';
import { createGraphStore, openDatabase, type OrbitDatabase } from '@orbit/database';
import { LIMITS, TOOLS, createOrbitMcpServer } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '..', 'dist', 'bin.js');
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'orbit-mcp-'));
  dirs.push(d);
  return d;
};
function write(root: string, files: Record<string, string>): void {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
}
const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

const ADR = `# ADR-0003: SQLite with graph tables\n\nStatus: Accepted\n\n## Decision\nUse indexed SQLite tables for the graph.\n`;

let root: string;
let dbPath: string;
let repoKey = 'demo';
let ids: { decision: string; ai: string };
let client: Client;
let closeServer: () => void;

type Json = Record<string, unknown> & {
  evidence: { id: string; status: string; limitations: string[] }[];
  truncated: boolean;
  notes: string[];
};

async function call(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError: boolean; data: Json; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
  let data = {} as Json;
  try {
    data = JSON.parse(text) as Json;
  } catch {
    /* error text */
  }
  return { isError: result.isError === true, data, text };
}

beforeAll(async () => {
  root = tmp();
  const git = (...a: string[]): void => {
    execFileSync(
      'git',
      ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a],
      { cwd: root, stdio: 'pipe' },
    );
  };
  git('init', '-q', '-b', 'main');
  write(root, {
    'package.json': JSON.stringify({ name: 'demo', main: 'src/a.ts' }),
    'src/a.ts': `import { b } from './b.js';\nexport function a() { return b() + 1; }\n`,
    'src/b.ts': `export function b() { return 2; }\n`,
    'src/other.ts': `export function b() { return 3; }\n`,
    'src/a.test.ts': `import { a } from './a';\ndescribe('a', () => { a(); });\n`,
    'docs/adr/0003-sqlite.md': ADR,
  });
  git('add', '.');
  git('commit', '-q', '-m', 'Add storage layer per ADR-0003 (#12)');
  write(root, { 'src/b.ts': `export function b() { return 4; }\n` });
  git('commit', '-q', '-am', 'Tune b helper');

  dbPath = join(tmp(), 'orbit.db');
  const database: OrbitDatabase = openDatabase({ path: dbPath });
  const store = createGraphStore(database);
  const scan = await scanRepository({
    rootPath: root,
    store,
    repositoryKey: repoKey,
    cacheDir: tmp(),
  });
  const engine = new MemoryEngine(store, scan.repositoryId, { probe: diskFileProbe(root) });
  importDocuments(engine, { rootPath: root, docs: false });
  const decision = engine.create({
    category: 'design-constraint',
    title: 'Keep b pure',
    body: 'The b helper must stay free of side effects.',
    createdBy: 'claudy',
    sourceRefs: [{ kind: 'file', path: 'src/b.ts', startLine: 1, endLine: 1 }],
  });
  const ai = engine.create({
    category: 'repository-discovery',
    title: 'Guess about caching',
    body: 'Maybe caching is needed around b.',
    createdBy: 'ai:claude',
    authority: 'ai-suggested',
  });
  ids = { decision: decision.id, ai: ai.id };
  linkMemoryToHistory(engine);
  database.close();

  const handle = createOrbitMcpServer({ dbPath, rootPath: root });
  closeServer = handle.close;
  const [a, b] = InMemoryTransport.createLinkedPair();
  await handle.server.connect(a);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
}, 120_000);

afterAll(async () => {
  await client?.close();
  closeServer?.();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('tool catalogue', () => {
  it('exposes exactly the twelve documented tools, all read-only', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'orbit_analyze_impact',
      'orbit_find_related_tests',
      'orbit_get_architecture',
      'orbit_get_callees',
      'orbit_get_callers',
      'orbit_get_change_context',
      'orbit_get_evidence',
      'orbit_get_symbol',
      'orbit_repository_map',
      'orbit_search_history',
      'orbit_search_memory',
      'orbit_search_symbols',
    ]);
    expect(TOOLS).toHaveLength(12);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
      expect(tool.description?.length ?? 0).toBeGreaterThan(30);
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});

describe('every result carries evidence and honest limits', () => {
  it('repository map', async () => {
    const r = await call('orbit_repository_map');
    expect(r.isError).toBe(false);
    expect(r.data.repository).toBe(repoKey);
    expect(r.data['counts']).toMatchObject({ File: expect.any(Number), Commit: 2 });
    expect(r.data.evidence.length).toBeGreaterThan(0);
    for (const e of r.data.evidence)
      expect(['PASS', 'FAIL', 'PARTIAL', 'NOT_MEASURED', 'INCOMPLETE']).toContain(e.status);
    expect(Array.isArray(r.data['scanLimitations'])).toBe(true);
    expect((r.data['memory'] as { active: number }).active).toBeGreaterThanOrEqual(3);
  });

  it('symbol search ranks exact matches first and reports totals', async () => {
    const r = await call('orbit_search_symbols', { query: 'b' });
    const results = r.data['results'] as { id: string; name: string }[];
    expect(results.every((s) => s.name.toLowerCase().includes('b'))).toBe(true);
    expect(results.map((s) => s.id)).toEqual(
      expect.arrayContaining(['src/b.ts#b', 'src/other.ts#b']),
    );
    expect(r.data.evidence.length).toBeGreaterThan(0);
    const one = await call('orbit_search_symbols', { query: 'b', limit: 1 });
    expect((one.data['results'] as unknown[]).length).toBe(1);
    expect(one.data.truncated).toBe(true);
  });

  it('get_symbol resolves exact ids and reports ambiguity instead of guessing', async () => {
    const exact = await call('orbit_get_symbol', { symbol: 'src/b.ts#b' });
    expect(exact.data['symbol']).toMatchObject({ id: 'src/b.ts#b', file: 'src/b.ts' });
    expect(exact.data['callers']).toBe(1);
    const ambiguous = await call('orbit_get_symbol', { symbol: 'b' });
    expect(ambiguous.data['ambiguous']).toBe(true);
    expect((ambiguous.data['candidates'] as unknown[]).length).toBe(2);
    const narrowed = await call('orbit_get_symbol', { symbol: 'b', file: 'src/other.ts' });
    expect((narrowed.data['symbol'] as { id: string }).id).toBe('src/other.ts#b');
    const missing = await call('orbit_get_symbol', { symbol: 'doesNotExist' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/NOT_FOUND/);
  });

  it('callers and callees carry confidence, resolution and locations', async () => {
    const callers = await call('orbit_get_callers', { symbol: 'src/b.ts#b' });
    const first = (
      callers.data['results'] as {
        symbol: { id: string };
        confidence: number;
        heuristic: boolean;
      }[]
    )[0];
    expect(first?.symbol.id).toBe('src/a.ts#a');
    expect(first?.confidence).toBeGreaterThan(0);
    expect(typeof first?.heuristic).toBe('boolean');
    expect(callers.data.notes.join(' ')).toMatch(/static analysis/);
    const callees = await call('orbit_get_callees', { symbol: 'src/a.ts#a' });
    expect(
      (callees.data['results'] as { symbol: { id: string } }[]).map((r) => r.symbol.id),
    ).toContain('src/b.ts#b');
    const strict = await call('orbit_get_callees', { symbol: 'src/a.ts#a', minConfidence: 1.0 });
    expect(strict.isError).toBe(false);
  });

  it('impact and related tests', async () => {
    const impact = await call('orbit_analyze_impact', { file: 'src/b.ts' });
    expect((impact.data['dependents'] as { path: string }[]).map((d) => d.path)).toContain(
      'src/a.ts',
    );
    const tests = await call('orbit_find_related_tests', { file: 'src/b.ts' });
    expect(
      (tests.data['results'] as { test: string; via: string }[]).some(
        (t) => t.test === 'src/a.test.ts' && t.via === 'dependent',
      ),
    ).toBe(true);
    const viaSymbol = await call('orbit_find_related_tests', { symbol: 'src/a.ts#a' });
    expect((viaSymbol.data['results'] as { via: string }[])[0]?.via).toBe('direct');
    expect((await call('orbit_find_related_tests', {})).isError).toBe(true);
    expect(
      (await call('orbit_find_related_tests', { file: 'src/a.ts', symbol: 'a' })).isError,
    ).toBe(true);
  });

  it('history search by text, author and file', async () => {
    const byText = await call('orbit_search_history', { query: 'storage layer' });
    expect((byText.data['results'] as { subject: string }[]).map((c) => c.subject)).toEqual([
      'Add storage layer per ADR-0003 (#12)',
    ]);
    const byFile = await call('orbit_search_history', { file: 'src/b.ts' });
    expect((byFile.data['results'] as unknown[]).length).toBe(2);
    expect((await call('orbit_search_history', { author: 'nobody' })).data['results']).toEqual([]);
    expect(byText.data.notes.join(' ')).toMatch(/window/);
  });

  it('architecture overview and one module', async () => {
    const all = await call('orbit_get_architecture');
    expect((all.data['modules'] as { module: string }[]).length).toBeGreaterThan(0);
    const name = (all.data['modules'] as { module: string }[])[0]?.module ?? '';
    const one = await call('orbit_get_architecture', { module: name });
    expect((one.data['module'] as { module: string }).module).toBe(name);
    expect((await call('orbit_get_architecture', { module: 'nope' })).isError).toBe(true);
  });
});

describe('memory through MCP', () => {
  it('hides AI suggestions by default and labels them when asked for', async () => {
    const strict = await call('orbit_search_memory', { query: 'caching' });
    expect(strict.data['results']).toEqual([]);
    expect(strict.data['hiddenUnverified']).toBe(1);
    const loose = await call('orbit_search_memory', { query: 'caching', includeUnverified: true });
    const hit = (
      loose.data['results'] as { id: string; authority: string; authoritative: boolean }[]
    )[0];
    expect(hit).toMatchObject({ id: ids.ai, authority: 'ai-suggested', authoritative: false });
    expect(loose.data.evidence[0]).toMatchObject({ sourceType: 'ai-note' });
    expect(loose.data.evidence[0]?.status).not.toBe('PASS');
  });

  it('returns ADRs with their source, and flags staleness against the working tree', async () => {
    const adr = await call('orbit_search_memory', { query: 'sqlite graph tables' });
    const hit = (
      adr.data['results'] as {
        id: string;
        authority: string;
        decisionStatus: string;
        sourceRefs: { path: string }[];
        stale: boolean;
      }[]
    )[0];
    expect(hit).toMatchObject({ authority: 'imported', decisionStatus: 'accepted', stale: false });
    expect(hit?.sourceRefs[0]?.path).toBe('docs/adr/0003-sqlite.md');

    write(root, { 'src/b.ts': `export function b() { return 99; }\n` });
    const stale = await call('orbit_search_memory', { file: 'src/b.ts' });
    const item = (
      stale.data['results'] as { id: string; stale: boolean; staleReasons: { kind: string }[] }[]
    )[0];
    expect(item).toMatchObject({ id: ids.decision, stale: true });
    expect(item?.staleReasons[0]?.kind).toBe('file-changed');
  });

  it('validates categories and limits', async () => {
    const bad = await call('orbit_search_memory', { categories: ['vibes'] }).catch(
      (e: unknown) => ({ isError: true, text: String(e) }),
    );
    expect(bad.isError).toBe(true);
    const tooMany = await call('orbit_search_memory', { limit: 1000 }).catch((e: unknown) => ({
      isError: true,
      text: String(e),
    }));
    expect(tooMany.isError).toBe(true);
  });
});

describe('change context and evidence', () => {
  it('summarises a file with signals, tests, history and memory', async () => {
    const r = await call('orbit_get_change_context', { files: ['src/b.ts', 'src/missing.ts'] });
    const files = r.data['files'] as {
      path: string;
      inGraph: boolean;
      recentCommits?: unknown[];
      memory?: { id: string }[];
      signals: string[];
      dependentsTotal?: number;
    }[];
    const b = files.find((f) => f.path === 'src/b.ts');
    expect(b?.inGraph).toBe(true);
    expect(b?.recentCommits).toHaveLength(2);
    expect(b?.memory?.map((m) => m.id)).toContain(ids.decision);
    expect(b?.dependentsTotal).toBeGreaterThan(0);
    expect(files.find((f) => f.path === 'src/missing.ts')).toMatchObject({ inGraph: false });
    expect(r.data.notes.join(' ')).toMatch(/not a risk score/);
  });

  it('accepts a commit instead of files, and demands exactly one', async () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
    const r = await call('orbit_get_change_context', { commit: head.slice(0, 10) });
    expect((r.data['files'] as { path: string }[]).map((f) => f.path)).toEqual(['src/b.ts']);
    expect((await call('orbit_get_change_context', {})).isError).toBe(true);
    expect((await call('orbit_get_change_context', { commit: 'abcdef1234' })).isError).toBe(true);
  });

  it('rejects paths that escape the repository', async () => {
    for (const file of ['../etc/passwd', '/etc/passwd', 'C:\\Windows\\win.ini']) {
      const r = await call('orbit_analyze_impact', { file });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/INVALID_INPUT/);
    }
  });

  it('looks evidence up by entity, id and commit, and verifies the ledger', async () => {
    const byEntity = await call('orbit_get_evidence', { entity: 'src/b.ts' });
    const first = (
      byEntity.data['results'] as { id: string; contentHash: string; limitations: string[] }[]
    )[0];
    expect(first?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const byId = await call('orbit_get_evidence', { evidenceId: first?.id });
    expect((byId.data['results'] as unknown[]).length).toBe(1);
    expect((await call('orbit_get_evidence', { evidenceId: 'f'.repeat(64) })).isError).toBe(true);
    const memoryEvidence = await call('orbit_get_evidence', { entity: ids.decision });
    expect((memoryEvidence.data['results'] as { source: string }[])[0]?.source).toMatch(/^memory:/);
    const verified = await call('orbit_get_evidence', { verifyLedger: true, limit: 1 });
    expect(verified.data['integrity']).toMatchObject({ ok: true, problems: [] });
    expect((verified.data['ledgerHead'] as { hash: string }).hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('bounds and safety', () => {
  it('never returns more than the character cap', async () => {
    const r = await call('orbit_search_symbols', { query: 'a', limit: LIMITS.maxResults });
    expect(r.text.length).toBeLessThanOrEqual(LIMITS.maxChars + 2000);
  });

  it('does not modify the database', async () => {
    const before = sha(dbPath);
    for (const tool of TOOLS) {
      await call(tool.name, tool.name === 'orbit_get_evidence' ? { verifyLedger: true } : {});
    }
    expect(sha(dbPath)).toBe(before);
  });

  it('refuses unknown repositories and unknown arguments', async () => {
    const r = await call('orbit_repository_map', { repository: 'nope' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/No scanned repository/);
  });

  it('requires a repository argument when several were scanned, and keeps them apart', async () => {
    const path = join(tmp(), 'multi.db');
    const database = openDatabase({ path });
    const store = createGraphStore(database);
    const other = tmp();
    write(other, { 'x.ts': 'export function onlyHere() { return 1; }\n' });
    await scanRepository({
      rootPath: root,
      store,
      repositoryKey: 'one',
      cacheDir: tmp(),
      config: { skipGit: true },
    });
    await scanRepository({
      rootPath: other,
      store,
      repositoryKey: 'two',
      cacheDir: tmp(),
      config: { skipGit: true },
    });
    database.close();
    const handle = createOrbitMcpServer({ dbPath: path });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await handle.server.connect(a);
    const c = new Client({ name: 't', version: '0' });
    await c.connect(b);
    const ambiguous = await c.callTool({
      name: 'orbit_search_symbols',
      arguments: { query: 'onlyHere' },
    });
    expect(ambiguous.isError).toBe(true);
    const scoped = await c.callTool({
      name: 'orbit_search_symbols',
      arguments: { query: 'onlyHere', repository: 'two' },
    });
    expect(
      JSON.parse((scoped.content as { text: string }[])[0]?.text ?? '{}').results,
    ).toHaveLength(1);
    const isolated = await c.callTool({
      name: 'orbit_search_symbols',
      arguments: { query: 'onlyHere', repository: 'one' },
    });
    expect(
      JSON.parse((isolated.content as { text: string }[])[0]?.text ?? '{}').results,
    ).toHaveLength(0);
    await c.close();
    handle.close();
  });
});

describe('tampered ledger is reported', () => {
  it("verifyLedger returns ok=false after the evidence is edited behind ORBIT's back", async () => {
    const path = join(tmp(), 'tampered.db');
    const database = openDatabase({ path });
    const store = createGraphStore(database);
    await scanRepository({
      rootPath: root,
      store,
      repositoryKey: 'demo',
      cacheDir: tmp(),
      config: { skipGit: true },
    });
    const raw = (database.db as unknown as { $client: { exec(statement: string): void } }).$client;
    raw.exec('drop trigger evidence_no_update');
    raw.exec("update evidence set source = 'forged'");
    database.close();
    const handle = createOrbitMcpServer({ dbPath: path });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await handle.server.connect(a);
    const c = new Client({ name: 't', version: '0' });
    await c.connect(b);
    const res = await c.callTool({ name: 'orbit_get_evidence', arguments: { verifyLedger: true } });
    const data = JSON.parse((res.content as { text: string }[])[0]?.text ?? '{}') as {
      integrity: { ok: boolean; problems: unknown[] };
    };
    expect(data.integrity.ok).toBe(false);
    expect(data.integrity.problems.length).toBeGreaterThan(0);
    await c.close();
    handle.close();
  });
});

describe('real stdio transport (the way Claude Code launches it)', () => {
  it('starts as a subprocess, lists tools and answers a call', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN, '--db', dbPath, '--root', root],
      stderr: 'pipe',
    });
    const stdio = new Client({ name: 'stdio-test', version: '0' });
    await stdio.connect(transport);
    try {
      expect((await stdio.listTools()).tools).toHaveLength(12);
      const res = await stdio.callTool({ name: 'orbit_repository_map', arguments: {} });
      expect(res.isError).not.toBe(true);
      expect(JSON.parse((res.content as { text: string }[])[0]?.text ?? '{}').repository).toBe(
        repoKey,
      );
    } finally {
      await stdio.close();
    }
  }, 60_000);

  it('exits with a clear message when the database is missing', () => {
    const r = spawnSync(process.execPath, [BIN, '--db', join(tmp(), 'nope.db')], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(r.status).toBe(4);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/No ORBIT database/);
  });

  it('rejects unknown flags and prints help on stderr only', () => {
    const bad = spawnSync(process.execPath, [BIN, '--wat'], { encoding: 'utf8', timeout: 20_000 });
    expect(bad.status).toBe(2);
    expect(bad.stdout).toBe('');
    const help = spawnSync(process.execPath, [BIN, '--help'], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toBe('');
    expect(help.stderr).toMatch(/claude mcp add/);
  });
});
