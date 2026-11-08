# Using ORBIT from Claude Code (MCP)

ORBIT exposes what ATLAS learned about a repository, plus project memory, to Claude Code and any other MCP client. The server is **read-only**: it opens the database with SQLite's read-only flag, so even a bug could not change your workspace.

## 1. Build and scan

```bash
pnpm install && pnpm build
node apps/cli/dist/index.js scan /path/to/your/repo --db .orbit/orbit.db --key myrepo
# optional: bring decisions in
node apps/cli/dist/index.js memory import /path/to/your/repo --db .orbit/orbit.db
node apps/cli/dist/index.js memory link --db .orbit/orbit.db
```

## 2. Add the server to Claude Code

```bash
claude mcp add orbit -- node /abs/path/to/new-orbit-/packages/mcp/dist/bin.js \
  --db /abs/path/to/.orbit/orbit.db --root /abs/path/to/your/repo
claude mcp list          # should show:  orbit: ... - Connected
```

`--root` makes memory staleness use the files on disk (always current). Without it, ORBIT compares against the hashes from the last scan. `--repo <key>` picks a repository when several were scanned. `node apps/cli/dist/index.js mcp --db ...` starts the same server.

Nothing is written to stdout except MCP messages; diagnostics go to stderr.

## 3. The twelve tools

| Tool                       | Answers                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `orbit_repository_map`     | Start here: languages, modules, entry points, cycles, hotspots, memory counts, scan limits |
| `orbit_search_symbols`     | Find functions/classes by name (exact, prefix, substring)                                |
| `orbit_get_symbol`         | One symbol: location, complexity, caller/callee counts (ambiguity is reported)           |
| `orbit_get_callers`        | Who calls it, with confidence, heuristic flag and locations                              |
| `orbit_get_callees`        | What it calls, same detail                                                               |
| `orbit_analyze_impact`     | Files that import a file (direct and transitive), affected modules, linked tests          |
| `orbit_find_related_tests` | Tests linked to a file or symbol, with reason and confidence                              |
| `orbit_search_history`     | Commits by subject, author or file (scanned window only)                                  |
| `orbit_search_memory`      | Decisions, constraints, conventions, bugs, fixes; authority, staleness, conflicts         |
| `orbit_get_architecture`   | Module graph, public surface, owners, cycles; one module in detail                        |
| `orbit_get_change_context` | Before editing: owners, churn, hotspot, recent commits, dependents, tests, memory, warnings |
| `orbit_get_evidence`       | Evidence by id, entity or commit; optional ledger integrity check                         |

Every result has `evidence` (id, status, limitations, content hash), `truncated` and `notes`. Lists default to 20 items, at most 100, and the whole result is capped at about 60,000 characters.

## 4. How to read results honestly

- Evidence status is `PASS`, `FAIL`, `PARTIAL`, `NOT_MEASURED` or `INCOMPLETE`. Read `limitations`.
- Call links and test links are inferred. `heuristic: true` or a low confidence means weak.
- A memory with `authoritative: false` is not a decision: it may be an AI suggestion, a proposed or superseded ADR, or invalidated. AI suggestions are hidden unless `includeUnverified` is set.
- `stale: true` means a cited file changed or disappeared since the memory was written. It does not say the memory is wrong.
- "No tests found" means no inferred link, not that the file is untested.

## 5. Managing memory (CLI)

```bash
orbit memory add --category architecture-decision --title "Use SQLite" --body "..." \
  --topic database --choice sqlite --file docs/adr/0003-sqlite.md --by claudy
orbit memory search sqlite             # AI suggestions are shown but labelled
orbit memory update <id> --body "..." --reason "why"      # new version; old text kept
orbit memory invalidate <id> --reason "..." [--superseded-by <id>]
orbit memory confirm <id> --by claudy  # a person vouches for an AI suggestion
orbit memory check --root .            # stale memory + conflicting decisions (exit 1 if any)
orbit memory history <id>
```

Categories: `architecture-decision`, `design-constraint`, `api-contract`, `team-convention`, `build-requirement`, `known-bug`, `historical-fix`, `repository-discovery`.

## 6. What was tested

- 23 integration tests drive the server through the official MCP client (in-memory and a real stdio subprocess): the tool catalogue, every tool, bounds, path-traversal rejection, repository isolation, tamper detection and a byte-for-byte unchanged database.
- Verified here with the real Claude Code 2.1.319: `claude mcp add` then `claude mcp list` reported `Connected`, and a headless `claude -p` call to `orbit_repository_map` returned the repository key and file count with the evidence caveat.
- Not tested: other MCP clients (Cursor, Claude Desktop), HTTP transports (stdio only), Windows and macOS.
