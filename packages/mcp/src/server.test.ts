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
