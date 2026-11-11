import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { IN_MEMORY, openDatabase, createGraphStore } from '@orbit/database';
import { afterEach, describe, expect, it } from 'vitest';
import { createOrbitMcpServer } from './server.js';

const databases: ReturnType<typeof openDatabase>[] = [];
const servers: ReturnType<typeof createOrbitMcpServer>[] = [];

function setup() {
  const database = openDatabase({ path: IN_MEMORY });
  databases.push(database);
  const store = createGraphStore(database);
  const repository = store.repositories.register({
    key: 'test/mcp',
    displayName: 'MCP Test',
  }).record;
  return { store, repository };
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const database of databases.splice(0)) database.close();
});

describe('ORBIT read-only MCP surface', () => {
  it('publishes the 12 documented tools through the MCP protocol', async () => {
    const { store, repository } = setup();
    const server = createOrbitMcpServer({ store, repositoryId: repository.id });
    servers.push(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'orbit-test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    const response = await client.listTools();
    expect(response.tools.map((tool) => tool.name).sort()).toEqual(
      [
        'orbit_analyze_impact',
        'orbit_find_related_tests',
        'orbit_get_callers',
        'orbit_get_callees',
        'orbit_get_change_context',
        'orbit_get_evidence',
        'orbit_get_symbol',
        'orbit_get_architecture',
        'orbit_repository_map',
        'orbit_search_history',
        'orbit_search_memory',
        'orbit_search_symbols',
      ].sort(),
    );
    await client.close();
  });

  it('answers a memory query without modifying the graph ledger', async () => {
    const { store, repository } = setup();
    const memoryEvidence = store.evidence.append({
      repositoryId: repository.id,
      source: 'test:architecture',
      sourceType: 'manual',
      contentHash: 'a'.repeat(64),
      status: 'NOT_MEASURED',
      limitations: ['Test fixture memory is not verification evidence.'],
      relatedEntityIds: [],
    });
    const node = store.nodes.upsert({
      repositoryId: repository.id,
      type: 'Documentation',
      key: 'architecture:test',
      attrs: {
        producer: 'atlas-memory',
        memoryKind: 'architecture',
        title: 'Read-only storage',
        summary: 'The MCP database connection is read-only.',
        tags: ['security'],
        sourceRefs: [],
        supersedes: [],
        conflictsWith: [],
      },
      sourceEvidenceId: memoryEvidence.record.id,
    }).record;
    expect(node.type).toBe('Documentation');

    const before = store.ledger.head(repository.id)?.hash;
    const server = createOrbitMcpServer({ store, repositoryId: repository.id });
    servers.push(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'orbit-test-client', version: '1.0.0' });
    await client.connect(clientTransport);
    const response = await client.callTool({
      name: 'orbit_search_memory',
      arguments: { query: 'read-only' },
    });
    expect(JSON.stringify(response.content)).toContain('Read-only storage');
    expect(store.ledger.head(repository.id)?.hash).toBe(before);
    await client.close();
  });
});

async function connect(store: ReturnType<typeof createGraphStore>, repositoryId: string) {
  const server = createOrbitMcpServer({ store, repositoryId });
  servers.push(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'orbit-test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  const first = (response.content as { type: string; text: string }[])[0];
  return { isError: response.isError === true, body: JSON.parse(first?.text ?? 'null') as never };
}

describe('MCP responses stay usable on larger data', () => {
  it('returns newest history first and exposes totals', async () => {
    const { store, repository } = setup();
    for (let i = 0; i < 8; i++)
      store.evidence.append({
        repositoryId: repository.id,
        source: `test:${i}`,
        sourceType: 'manual',
        contentHash: String(i).repeat(64).slice(0, 64),
        status: 'NOT_MEASURED',
        limitations: ['fixture'],
        relatedEntityIds: [],
      });
    const client = await connect(store, repository.id);
    const { body } = await call(client, 'orbit_search_history', { limit: 3 });
    const view = body as {
      evidence: { source: string }[];
      evidenceTotal: number;
      ledger: { seq: number }[];
    };
    expect(view.evidence.map((e) => e.source)).toEqual(['test:7', 'test:6', 'test:5']);
    expect(view.evidenceTotal).toBe(8);
    expect(view.ledger.map((l) => l.seq)).toEqual(
      [...view.ledger.map((l) => l.seq)].sort((a, b) => b - a),
    );
    expect(view.ledger).toHaveLength(3);
  });

  it('resolves abbreviated and upper-case commit SHAs', async () => {
    const { store, repository } = setup();
    const sha = 'abcdef0123456789abcdef0123456789abcdef01';
    store.nodes.upsert({
      repositoryId: repository.id,
      type: 'Commit',
      key: sha,
      attrs: { producer: 'atlas', subject: 'fixture' },
      sourceEvidenceId: store.evidence.append({
        repositoryId: repository.id,
        source: 'test:git',
        commitSha: sha,
        sourceType: 'git',
        contentHash: 'b'.repeat(64),
        status: 'PASS',
        limitations: [],
        relatedEntityIds: [],
      }).record.id,
    });
    const client = await connect(store, repository.id);
    for (const input of [sha, sha.slice(0, 7), sha.toUpperCase(), sha.slice(0, 10).toUpperCase()]) {
      const { body } = await call(client, 'orbit_get_change_context', { commitSha: input });
      const view = body as { commit: { key: string } | null; evidence: unknown[] };
      expect(view.commit?.key, input).toBe(sha);
      expect(view.evidence, input).toHaveLength(1);
    }
  });

  it('truncates long memory content instead of failing with the output limit', async () => {
    const { store, repository } = setup();
    const evidence = store.evidence.append({
      repositoryId: repository.id,
      source: 'test:memory',
      sourceType: 'manual',
      contentHash: 'c'.repeat(64),
      status: 'NOT_MEASURED',
      limitations: ['fixture'],
      relatedEntityIds: [],
    });
    for (let i = 0; i < 4; i++)
      store.nodes.upsert({
        repositoryId: repository.id,
        type: 'Documentation',
        key: `architecture:big-${i}`,
        attrs: {
          producer: 'atlas-memory',
          memoryKind: 'architecture',
          title: `Big ${i}`,
          summary: 'big',
          content: 'x'.repeat(19_000),
          tags: [],
          sourceRefs: [],
          supersedes: [],
          conflictsWith: [],
        },
        sourceEvidenceId: evidence.record.id,
      });
    const client = await connect(store, repository.id);
    const { isError, body } = await call(client, 'orbit_search_memory', {});
    expect(isError).toBe(false);
    const view = body as { memories: { content?: string; contentTruncated?: boolean }[] };
    expect(view.memories.length).toBeGreaterThan(0);
    for (const m of view.memories) if (m.content) expect(m.content.length).toBeLessThanOrEqual(501);
  });
});
