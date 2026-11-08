import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  buildArchitectureMap,
  detectMemoryConflicts,
  impactMap,
  searchMemories,
  symbolIndex,
  type SymbolEntry,
} from '@orbit/atlas';
import { nodeIdFor, type NodeRecord } from '@orbit/core';
import { openDatabase, createGraphStore, type GraphStore } from '@orbit/database';
import { neighbors } from '@orbit/graph';
import { z } from 'zod';

const MAX_TOOL_LIMIT = 50;
const MAX_OUTPUT_BYTES = 48 * 1024;

export interface OrbitMcpOptions {
  repositoryId: string;
  store: GraphStore;
}

function boundedLimit(value: number | undefined): number {
  const limit = value ?? 20;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
  return Math.min(limit, MAX_TOOL_LIMIT);
}

function result(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: 'ORBIT_TOOL_OUTPUT_LIMIT',
            message:
              'The result exceeded the 48 KiB response limit. Narrow the query or reduce its limit.',
          }),
        },
      ],
      isError: true,
    };
  }
  return { content: [{ type: 'text' as const, text }] };
}

function allSymbolNodes(store: GraphStore, repositoryId: string): NodeRecord[] {
  const items: NodeRecord[] = [];
  for (const type of ['Function', 'Class', 'Symbol'] as const) {
    for (let offset = 0; ; offset += 1000) {
      const page = store.nodes.find(repositoryId, { type, limit: 1000, offset });
      items.push(...page.filter((node) => node.attrs['producer'] === 'atlas'));
      if (page.length < 1000) break;
    }
  }
  return items;
}

function findSymbolNode(
  store: GraphStore,
  repositoryId: string,
  name: string,
  file?: string,
): NodeRecord | undefined {
  return allSymbolNodes(store, repositoryId)
    .filter((node) => {
      const attrs = node.attrs;
      const qualified = typeof attrs['qualifiedName'] === 'string' ? attrs['qualifiedName'] : '';
      const symbolName = typeof attrs['name'] === 'string' ? attrs['name'] : '';
      const path = typeof attrs['file'] === 'string' ? attrs['file'] : '';
      return (qualified === name || symbolName === name) && (file === undefined || path === file);
    })
    .sort((a, b) => a.key.localeCompare(b.key))[0];
}

function symbolView(node: NodeRecord): Record<string, unknown> {
  return {
    id: node.id,
    key: node.key,
    type: node.type,
    name: node.attrs['name'],
    qualifiedName: node.attrs['qualifiedName'],
    kind: node.attrs['kind'],
    file: node.attrs['file'],
    location: node.attrs['location'],
    exported: node.attrs['exported'],
    complexity: node.attrs['complexity'],
    sourceEvidenceId: node.sourceEvidenceId,
  };
}

/** Create an MCP server whose registered tools are all read-only. */
export function createOrbitMcpServer(options: OrbitMcpOptions): McpServer {
  const { store, repositoryId } = options;
  const repository = store.repositories.get(repositoryId);
  if (!repository)
    throw new Error(`Repository ${repositoryId} is not registered in this ORBIT database`);

  const server = new McpServer(
    { name: 'orbit-engineering-intelligence', version: '0.0.1' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'orbit_repository_map',
    {
      description:
        'Return a bounded repository overview, module inventory and import-cycle findings from the ATLAS graph.',
      inputSchema: { limit: z.number().int().min(1).max(MAX_TOOL_LIMIT).optional() },
    },
    async ({ limit }) => {
      const map = buildArchitectureMap(store, repositoryId);
      return result({
        repository,
        modules: map.modules.slice(0, boundedLimit(limit)),
        cycles: map.cycles,
        totalModules: map.modules.length,
      });
    },
  );

  server.registerTool(
    'orbit_search_symbols',
    {
      description: 'Search ATLAS symbols by a case-insensitive name fragment, kind or file path.',
      inputSchema: {
        query: z.string().max(256).optional(),
        kind: z.string().max(64).optional(),
        file: z.string().max(1024).optional(),
        exportedOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(MAX_TOOL_LIMIT).optional(),
      },
    },
    async ({ query, kind, file, exportedOnly, limit }) => {
      const needle = query?.toLowerCase();
      const entries = symbolIndex(store, repositoryId).filter(
        (entry) =>
          (!needle ||
            entry.name.toLowerCase().includes(needle) ||
            entry.qualifiedName.toLowerCase().includes(needle)) &&
          (!kind || entry.kind === kind) &&
          (!file || entry.file === file) &&
          (exportedOnly !== true || entry.exported),
      );
      return result({ total: entries.length, symbols: entries.slice(0, boundedLimit(limit)) });
    },
  );

  server.registerTool(
    'orbit_get_symbol',
    {
      description:
        'Get an exact ATLAS symbol by name or qualified name, optionally disambiguated by file.',
      inputSchema: { name: z.string().min(1).max(512), file: z.string().max(1024).optional() },
    },
    async ({ name, file }) => {
      const node = findSymbolNode(store, repositoryId, name, file);
      return result(node ? symbolView(node) : { found: false, name, file: file ?? null });
    },
  );

  server.registerTool(
    'orbit_get_callers',
    {
      description:
        'List known callers of an ATLAS function/class symbol. Call edges may be heuristic or incomplete.',
      inputSchema: {
        name: z.string().min(1).max(512),
        file: z.string().max(1024).optional(),
        limit: z.number().int().min(1).max(MAX_TOOL_LIMIT).optional(),
      },
    },
    async ({ name, file, limit }) => {
      const node = findSymbolNode(store, repositoryId, name, file);
      if (!node) return result({ found: false, name, file: file ?? null });
      const callers = neighbors(store, repositoryId, node.id, {
        direction: 'in',
        types: ['CALLS'],
      });
      return result({
        symbol: symbolView(node),
        callers: callers.slice(0, boundedLimit(limit)).map((item) => ({
          ...symbolView(item.node),
          confidence: item.edge.confidence,
          evidenceId: item.edge.sourceEvidenceId,
        })),
        total: callers.length,
        limitation:
          'ATLAS call resolution is partial; unresolved and top-level calls are not returned.',
      });
    },
  );

  server.registerTool(
    'orbit_get_callees',
    {
      description:
        'List known callees of an ATLAS function/class symbol. Call edges may be heuristic or incomplete.',
      inputSchema: {
        name: z.string().min(1).max(512),
        file: z.string().max(1024).optional(),
        limit: z.number().int().min(1).max(MAX_TOOL_LIMIT).optional(),
      },
    },
    async ({ name, file, limit }) => {
      const node = findSymbolNode(store, repositoryId, name, file);
      if (!node) return result({ found: false, name, file: file ?? null });
      const callees = neighbors(store, repositoryId, node.id, {
        direction: 'out',
        types: ['CALLS'],
      });
      return result({
        symbol: symbolView(node),
        callees: callees.slice(0, boundedLimit(limit)).map((item) => ({
          ...symbolView(item.node),
          confidence: item.edge.confidence,
          evidenceId: item.edge.sourceEvidenceId,
        })),
        total: callees.length,
        limitation:
          'ATLAS call resolution is partial; unresolved and top-level calls are not returned.',
      });
    },
  );

  server.registerTool(
    'orbit_analyze_impact',
    {
      description:
        'Analyse reverse import impact for a repository-relative file, including dependents, affected modules and related tests.',
      inputSchema: {
        file: z.string().min(1).max(1024),
        maxDepth: z.number().int().min(0).max(25).optional(),
        maxNodes: z.number().int().min(1).max(1000).optional(),
      },
    },
    async ({ file, maxDepth, maxNodes }) =>
      result(
        impactMap(store, repositoryId, file, {
          ...(maxDepth === undefined ? {} : { maxDepth }),
          ...(maxNodes === undefined ? {} : { maxNodes }),
        }),
      ),
  );

  server.registerTool(
    'orbit_find_related_tests',
    {
      description: 'Find tests linked by ATLAS TESTS edges to a repository-relative source file.',
      inputSchema: {
        file: z.string().min(1).max(1024),
        limit: z.number().int().min(1).max(MAX_TOOL_LIMIT).optional(),
      },
    },
    async ({ file, limit }) => {
      const targetId = nodeIdFor(repositoryId, 'File', file);
      const target = store.nodes.get(repositoryId, targetId);
      if (!target) return result({ found: false, file, tests: [] });
      const tests = neighbors(store, repositoryId, targetId, { direction: 'in', types: ['TESTS'] });
      return result({
        file,
        tests: tests.slice(0, boundedLimit(limit)).map(({ node, edge }) => ({
          id: node.id,
          path: node.key,
          attrs: node.attrs,
          confidence: edge.confidence,
          evidenceId: edge.sourceEvidenceId,
        })),
        total: tests.length,
        limitation: 'Test-to-code links are heuristic mappings from the current ATLAS scan.',
      });
    },
  );

  server.registerTool(
    'orbit_search_history',
    {
      description:
        'Search indexed repository evidence and the append-only activity ledger, optionally scoped to a commit.',
      inputSchema: {
        commitSha: z
          .string()
          .regex(/^[0-9a-f]{7,64}$/i)
          .optional(),
        limit: z.number().int().min(1).max(MAX_TOOL_LIMIT).optional(),
      },
    },
    async ({ commitSha, limit }) => {
      const count = boundedLimit(limit);
      const evidence = store.evidence.list(repositoryId, {
        ...(commitSha ? { commitSha } : {}),
        limit: count,
      });
      const ledger = store.ledger.entries(repositoryId, { limit: count });
      return result({
        evidence,
        ledger,
        integrity: store.verifyIntegrity(repositoryId),
        limitation: 'History contains only facts ingested into this local ORBIT database.',
      });
    },
  );

  server.registerTool(
    'orbit_search_memory',
    {
      description:
        'Lexically search versioned ATLAS decisions and architectural memory. Optionally supply current document hashes to assess staleness; explicit source conflicts are surfaced.',
      inputSchema: {
        query: z.string().max(500).optional(),
        kind: z
          .enum(['architecture', 'decision', 'convention', 'workflow', 'risk', 'fact', 'document'])
          .optional(),
        tags: z.array(z.string().max(64)).max(20).optional(),
        currentSources: z
          .array(
            z.object({ path: z.string().max(1024), sha256: z.string().regex(/^[0-9a-f]{64}$/i) }),
          )
          .max(200)
          .optional(),
        limit: z.number().int().min(1).max(MAX_TOOL_LIMIT).optional(),
      },
    },
    async ({ query, kind, tags, currentSources, limit }) =>
      result({
        memories: searchMemories(store, repositoryId, {
          ...(query ? { query } : {}),
          ...(kind ? { kind } : {}),
          ...(tags ? { tags } : {}),
          ...(currentSources ? { currentSources } : {}),
          limit: boundedLimit(limit),
        }),
        conflicts: detectMemoryConflicts(store, repositoryId),
        retrieval:
          'Deterministic lexical search; no embedding model or semantic inference is used.',
      }),
  );

  server.registerTool(
    'orbit_get_architecture',
    {
      description:
        'Return the module dependency map and cycle findings for the indexed repository.',
      inputSchema: {
        module: z.string().max(1024).optional(),
        limit: z.number().int().min(1).max(MAX_TOOL_LIMIT).optional(),
      },
    },
    async ({ module, limit }) => {
      const map = buildArchitectureMap(store, repositoryId);
      const modules = map.modules.filter((item) => !module || item.module === module);
      return result({
        modules: modules.slice(0, boundedLimit(limit)),
        total: modules.length,
        cycles: map.cycles,
      });
    },
  );

  server.registerTool(
    'orbit_get_change_context',
    {
      description:
        'Gather indexed commit, evidence and impacted-file context for a Git commit SHA.',
      inputSchema: {
        commitSha: z.string().regex(/^[0-9a-f]{7,64}$/i),
        limit: z.number().int().min(1).max(MAX_TOOL_LIMIT).optional(),
      },
    },
    async ({ commitSha, limit }) => {
      const count = boundedLimit(limit);
      const commit = store.nodes
        .find(repositoryId, { type: 'Commit', keyPrefix: commitSha, limit: 10 })
        .find((node) => node.key === commitSha);
      const evidence = store.evidence.list(repositoryId, { commitSha, limit: count });
      return result({
        commit: commit ?? null,
        evidence,
        repository,
        integrity: store.verifyIntegrity(repositoryId),
        note: 'Only commit metadata and evidence already indexed in ORBIT are returned.',
      });
    },
  );

  server.registerTool(
    'orbit_get_evidence',
    {
      description:
        'Retrieve one immutable evidence record by ID, or a bounded list of evidence records when no ID is supplied.',
      inputSchema: {
        evidenceId: z.string().min(1).max(256).optional(),
        limit: z.number().int().min(1).max(MAX_TOOL_LIMIT).optional(),
      },
    },
    async ({ evidenceId, limit }) => {
      const record = evidenceId ? store.evidence.get(repositoryId, evidenceId) : undefined;
      const items = evidenceId
        ? record
          ? [record]
          : []
        : store.evidence.list(repositoryId, { limit: boundedLimit(limit) });
      return result({
        found: evidenceId ? Boolean(record) : undefined,
        evidence: items,
        integrity: store.verifyIntegrity(repositoryId),
      });
    },
  );

  return server;
}

/** Start the stdio MCP server with an existing SQLite DB opened in strict read-only mode. */
export async function startOrbitMcpServer(options: {
  dbPath: string;
  repositoryKey?: string;
}): Promise<void> {
  const database = openDatabase({ path: options.dbPath, migrate: false, readonly: true });
  try {
    const store = createGraphStore(database);
    const repositories = store.repositories.list();
    const repository = options.repositoryKey
      ? repositories.find((item) => item.key === options.repositoryKey)
      : repositories.length === 1
        ? repositories[0]
        : undefined;
    if (!repository) {
      const reason = options.repositoryKey
        ? `Repository key ${options.repositoryKey} is not registered`
        : `Specify --repo because this database contains ${repositories.length} repositories`;
      throw new Error(reason);
    }
    const server = createOrbitMcpServer({ store, repositoryId: repository.id });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    const close = () => {
      void server.close().finally(() => database.close());
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  } catch (error) {
    database.close();
    throw error;
  }
}

export type { SymbolEntry };
