import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OrbitError } from '@orbit/shared';
import { OrbitContext, type OrbitMcpOptions } from './context.js';
import { LIMITS, TOOLS, type ToolResult } from './tools.js';

export const SERVER_NAME = 'orbit';
export const SERVER_VERSION = '0.0.1';

const INSTRUCTIONS = [
  'ORBIT exposes a verified, versioned graph of one or more scanned repositories. All tools are read-only.',
  'Start with orbit_repository_map. Every result carries an "evidence" list: each entry has a status (PASS, FAIL, PARTIAL, NOT_MEASURED, INCOMPLETE) and "limitations" describing what was NOT measured. Report those limitations; never present PARTIAL or NOT_MEASURED evidence as certain.',
  'Call links and test links are inferred by static analysis and carry a confidence; "heuristic" means weaker. Memory items marked authoritative=false (AI suggestions, proposed or superseded decisions) are not decisions.',
  `Results are bounded (default ${LIMITS.defaultResults}, max ${LIMITS.maxResults} items); "truncated": true means there is more.`,
].join(' ');

/** Shrink an oversized result by halving its largest payload arrays, and say so. */
function bound(flat: Record<string, unknown>): Record<string, unknown> {
  const protectedKeys = new Set(['evidence', 'notes']);
  let json = JSON.stringify(flat);
  for (let i = 0; i < 30 && json.length > LIMITS.maxChars; i += 1) {
    const biggest = Object.entries(flat)
      .filter(([k, v]) => !protectedKeys.has(k) && Array.isArray(v) && v.length > 1)
      .sort(([, x], [, y]) => JSON.stringify(y).length - JSON.stringify(x).length)[0];
    if (!biggest) break;
    flat[biggest[0]] = (biggest[1] as unknown[]).slice(
      0,
      Math.ceil((biggest[1] as unknown[]).length / 2),
    );
    flat['truncated'] = true;
    json = JSON.stringify(flat);
  }
  if (json.length > LIMITS.maxChars) {
    return { error: 'Result too large even after trimming. Narrow the query.', truncated: true };
  }
  return flat;
}

function failure(error: unknown): CallToolResult {
  if (error instanceof OrbitError && error.code !== 'DATABASE_ERROR') {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error (${error.code}): ${error.message}` }],
    };
  }
  // Do not leak paths or internals for unexpected failures.
  return {
    isError: true,
    content: [
      { type: 'text', text: 'Error (INTERNAL): the ORBIT database could not answer this request.' },
    ],
  };
}

export interface OrbitMcpServer {
  server: McpServer;
  context: OrbitContext;
  close(): void;
}

export function createOrbitMcpServer(options: OrbitMcpOptions): OrbitMcpServer {
  const context = new OrbitContext(options);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (args: Record<string, unknown>): CallToolResult => {
        try {
          const result: ToolResult = tool.run(context, args);
          const repo = context.repository(
            typeof args['repository'] === 'string' ? args['repository'] : undefined,
          );
          const { evidence, evidenceOmitted } = context.evidence(repo.id, result.evidenceIds ?? []);
          const structured = bound({
            ...result.data,
            repository: repo.key,
            evidence,
            ...(evidenceOmitted > 0 && { evidenceOmitted }),
            truncated: result.truncated ?? false,
            notes: result.notes ?? [],
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
            structuredContent: structured,
          };
        } catch (error) {
          return failure(error);
        }
      },
    );
  }
  return { server, context, close: () => context.close() };
}

/**
 * Serve over stdio until the client disconnects. stdout carries MCP protocol messages only;
 * anything for a human goes to stderr.
 */
export async function startStdioServer(options: OrbitMcpOptions): Promise<OrbitMcpServer> {
  const handle = createOrbitMcpServer(options);
  await handle.server.connect(new StdioServerTransport());
  return handle;
}
