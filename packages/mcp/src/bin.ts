#!/usr/bin/env node
import { OrbitError } from '@orbit/shared';
import { createOrbitMcpServer, SERVER_VERSION } from './server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const HELP = `orbit-mcp ${SERVER_VERSION}: read-only MCP server for the ORBIT graph (stdio)

Usage: orbit-mcp [--db <path>] [--repo <key>] [--root <path>]

  --db <path>    ORBIT workspace database (default: $ORBIT_DB_PATH or .orbit/orbit.db)
  --repo <key>   repository key to answer about when several were scanned
  --root <path>  working tree of the scanned repository; memory staleness is then checked against the files on disk

Add to Claude Code:  claude mcp add orbit -- orbit-mcp --db /path/to/.orbit/orbit.db
Nothing is written to stdout except MCP protocol messages; diagnostics go to stderr.
`;

function parse(argv: string[]): { db: string; repo?: string; root?: string } | undefined {
  const out: { db: string; repo?: string; root?: string } = {
    db: process.env['ORBIT_DB_PATH'] ?? '.orbit/orbit.db',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--help' || arg === '-h') return undefined;
    if (
      (arg === '--db' || arg === '--repo' || arg === '--root') &&
      value !== undefined &&
      !value.startsWith('--')
    ) {
      if (arg === '--db') out.db = value;
      else if (arg === '--repo') out.repo = value;
      else out.root = value;
      i += 1;
      continue;
    }
    throw new OrbitError('INVALID_INPUT', `Unknown or incomplete argument: ${arg ?? ''}`);
  }
  return out;
}

async function main(): Promise<void> {
  let args;
  try {
    args = parse(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${HELP}`);
    process.exit(2);
  }
  if (!args) {
    process.stderr.write(HELP);
    process.exit(0);
  }
  let handle;
  try {
    handle = createOrbitMcpServer({
      dbPath: args.db,
      ...(args.repo !== undefined && { repository: args.repo }),
      ...(args.root !== undefined && { rootPath: args.root }),
    });
  } catch (error) {
    process.stderr.write(`orbit-mcp: ${(error as Error).message}\n`);
    process.exit(4);
  }
  const shutdown = (): void => {
    handle.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('end', shutdown);
  await handle.server.connect(new StdioServerTransport());
  process.stderr.write(`orbit-mcp ${SERVER_VERSION} ready (read-only, db: ${args.db})\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`orbit-mcp: fatal: ${(error as Error).message}\n`);
  process.exit(1);
});
