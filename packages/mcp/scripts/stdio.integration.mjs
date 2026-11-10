import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { scanRepository } from '@orbit/atlas';
import { createGraphStore, openDatabase } from '@orbit/database';

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('the production orbit mcp start process serves a real SQLite database read-only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-mcp-stdio-'));
  const sourceRoot = join(root, 'fixture');
  const databasePath = join(root, 'orbit.db');
  const repoRoot = resolve(process.cwd(), '../..');
  const cliPath = resolve(repoRoot, 'apps/cli/dist/index.js');

  mkdirSync(join(sourceRoot, 'src'), { recursive: true });
  writeFileSync(
    join(sourceRoot, 'src', 'math.ts'),
    'export function add(a: number, b: number): number { return a + b; }\n',
  );
  writeFileSync(
    join(sourceRoot, 'src', 'app.ts'),
    "import { add } from './math.js'; export const total = add(1, 2);\n",
  );

  let database;
  let client;
  try {
    database = openDatabase({ path: databasePath });
    const store = createGraphStore(database);
    const scanned = await scanRepository({
      rootPath: sourceRoot,
      store,
      repositoryKey: 'stdio-fixture',
      config: { skipGit: true },
    });
    assert.ok(scanned.repositoryId);
    const expectedLedgerHead = store.ledger.head(scanned.repositoryId)?.hash;
    database.close();
    database = undefined;

    const beforeHash = digest(databasePath);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliPath, 'mcp', 'start', '--db', databasePath, '--repo', 'stdio-fixture'],
      cwd: repoRoot,
      env: process.env,
    });
    client = new Client({ name: 'orbit-mcp-stdio-acceptance', version: '1.0.0' });
    await client.connect(transport);

    const listed = await client.listTools();
    assert.equal(listed.tools.length, 12);
    assert.ok(listed.tools.some((tool) => tool.name === 'orbit_repository_map'));

    const response = await client.callTool({
      name: 'orbit_repository_map',
      arguments: { limit: 10 },
    });
    assert.notEqual(response.isError, true);
    const payload = JSON.parse(response.content[0].text);
    assert.equal(payload.repository.key, 'stdio-fixture');
    assert.ok(Array.isArray(payload.modules));

    await client.close();
    client = undefined;

    const readonly = openDatabase({ path: databasePath, migrate: false, readonly: true });
    try {
      const readonlyStore = createGraphStore(readonly);
      const repository = readonlyStore.repositories
        .list()
        .find((item) => item.key === 'stdio-fixture');
      assert.ok(repository);
      assert.equal(readonlyStore.ledger.head(repository.id)?.hash, expectedLedgerHead);
    } finally {
      readonly.close();
    }
    assert.equal(digest(databasePath), beforeHash);
  } finally {
    if (client) await client.close().catch(() => undefined);
    if (database) database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
