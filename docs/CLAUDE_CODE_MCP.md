# Using ORBIT from Claude Code (MCP)

ORBIT serves what ATLAS indexed (symbols, imports, impact, tests, history, memory, evidence) over MCP on stdio. The server opens the SQLite database in strict read-only mode (`fileMustExist`, no migration, no WAL pragma), so it cannot change your workspace.

## 1. Build and scan

```bash
pnpm install --frozen-lockfile && pnpm run build
node apps/cli/dist/index.js scan /path/to/repo --db /abs/path/orbit.db --key myrepo
```

The database must already exist: the MCP server refuses to create one.

## 2. Register the server

```bash
claude mcp add orbit -- node /abs/path/to/apps/cli/dist/index.js mcp start --db /abs/path/orbit.db
claude mcp list        # orbit: ... - Connected
```

Add `--repo <key>` when the database holds more than one repository; without it the server refuses to start.

## 3. Tools (12)

`orbit_repository_map`, `orbit_search_symbols`, `orbit_get_symbol`, `orbit_get_callers`, `orbit_get_callees`, `orbit_analyze_impact`, `orbit_find_related_tests`, `orbit_search_history`, `orbit_search_memory`, `orbit_get_architecture`, `orbit_get_change_context` (takes a commit SHA), `orbit_get_evidence`.

Limits: `limit` is 1–50 (out-of-range values are rejected, not clamped), and any response over 48 KiB is replaced by an `ORBIT_TOOL_OUTPUT_LIMIT` error.

## 4. Reading results honestly

- Evidence has a status (`PASS`, `FAIL`, `PARTIAL`, `NOT_MEASURED`, `INCOMPLETE`) and limitations; read them.
- Call and test links are inferred. "No tests found" means no inferred link, not an untested file.
- Memory with a non-authoritative status is not a decision.

## 5. What was actually tested

- `packages/mcp/src/tools.integration.test.ts`: scans a real temporary repository, then calls all 12 tools through the official MCP client, checks limit rejection, a traversal-style path, and that the ledger head is unchanged after queries.
- Manual, Claude Code 2.1.319, Linux: `claude mcp add` → `claude mcp list` reported `Connected`, and `claude -p` called `orbit_analyze_impact` on a scanned two-file repo and correctly named the importing file.

Not tested: other MCP clients (Cursor, Claude Desktop), HTTP transport (stdio only), Windows and macOS for the manual Claude Code run.
