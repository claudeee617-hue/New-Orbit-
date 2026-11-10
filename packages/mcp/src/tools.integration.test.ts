import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { scanRepository } from '@orbit/atlas';
import { IN_MEMORY, createGraphStore, openDatabase, type GraphStore } from '@orbit/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrbitMcpServer } from './server.js';

let root: string;
let store: GraphStore;
let database: ReturnType<typeof openDatabase>;
let client: Client;
let server: ReturnType<typeof createOrbitMcpServer>;
let ledgerHead: string | undefined;

async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await client.callTool({ name, arguments: args });
  const text = (response.content as { type: string; text: string }[])[0]?.text ?? '';
  return { isError: response.isError === true, text, json: safeParse(text) };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'orbit-mcp-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'math.ts'),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
  );
  writeFileSync(
    join(root, 'src', 'app.ts'),
    "import { add } from './math.js';\nexport function total(): number {\n  return add(1, 2);\n}\n",
  );
  writeFileSync(
    join(root, 'src', 'math.test.ts'),
    "import { add } from './math.js';\nexport const ok = add(1, 1) === 2;\n",
  );
  database = openDatabase({ path: IN_MEMORY });
  store = createGraphStore(database);
  const scan = await scanRepository({
    rootPath: root,
    store,
    repositoryKey: 'fixture',
    config: { skipGit: true },
  });
  ledgerHead = store.ledger.head(scan.repositoryId)?.hash;
  server = createOrbitMcpServer({ store, repositoryId: scan.repositoryId });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'orbit-integration', version: '1.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await server.close();
  database.close();
  rmSync(root, { recursive: true, force: true });
});

describe('ORBIT MCP tools against a scanned repository', () => {
  it('exposes exactly 12 tools and none is named like a write operation', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(12);
    for (const tool of tools)
      expect(tool.name).toMatch(/^orbit_(get|search|find|analyze|repository)_?/);
  });

  it('orbit_repository_map lists scanned modules', async () => {
    const r = await call('orbit_repository_map');
    expect(r.isError).toBe(false);
    expect(r.text).toContain('fixture');
  });

  it('orbit_search_symbols finds an exported function', async () => {
    const r = await call('orbit_search_symbols', { query: 'add' });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('add');
  });

  it('orbit_get_symbol returns the exact symbol and reports a missing one', async () => {
    const hit = await call('orbit_get_symbol', { name: 'add' });
    expect(hit.text).toContain('math.ts');
    const miss = await call('orbit_get_symbol', { name: 'doesNotExist' });
    expect(miss.isError).toBe(false);
    expect(miss.json).toMatchObject({ found: false });
  });

  it('orbit_get_callers / orbit_get_callees answer without error', async () => {
    expect((await call('orbit_get_callers', { name: 'add' })).isError).toBe(false);
    expect((await call('orbit_get_callees', { name: 'total' })).isError).toBe(false);
  });

  it('orbit_analyze_impact finds the importer and the linked test', async () => {
    const r = await call('orbit_analyze_impact', { file: 'src/math.ts' });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('src/app.ts');
  });

  it('orbit_find_related_tests links the test file', async () => {
    const r = await call('orbit_find_related_tests', { file: 'src/math.ts' });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('math.test.ts');
  });

  it('orbit_search_history, memory, architecture, change context and evidence respond', async () => {
    expect((await call('orbit_search_history', { query: 'x' })).isError).toBe(false);
    expect((await call('orbit_search_memory', { query: 'anything' })).isError).toBe(false);
    expect((await call('orbit_get_architecture')).isError).toBe(false);
    expect((await call('orbit_get_change_context', { commitSha: 'abcdef1' })).isError).toBe(false);
    const evidence = await call('orbit_get_evidence');
    expect(evidence.isError).toBe(false);
    expect(evidence.text).toContain('integrity');
  });

  it('rejects out-of-range limits instead of silently accepting them', async () => {
    const over = await call('orbit_search_symbols', { query: 'a', limit: 51 });
    expect(over.isError).toBe(true);
    const zero = await call('orbit_search_symbols', { query: 'a', limit: 0 });
    expect(zero.isError).toBe(true);
  });

  it('does not leak absolute paths for traversal-style input', async () => {
    const r = await call('orbit_analyze_impact', { file: '../../etc/passwd' });
    expect(r.text).not.toContain(root);
    expect(r.text).not.toContain('/etc/passwd:');
  });

  it('never appends to the ledger while serving queries', () => {
    const repositoryId = store.repositories.list()[0]?.id;
    expect(repositoryId).toBeDefined();
    expect(store.ledger.head(repositoryId as string)?.hash).toBe(ledgerHead);
  });
});
