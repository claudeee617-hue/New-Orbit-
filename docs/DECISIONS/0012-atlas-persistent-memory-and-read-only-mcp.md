# ADR-0012: ATLAS persistent memory and read-only MCP boundary

- Status: Accepted
- Date: 2026-11-08

## Context

ATLAS needs durable architectural facts, decision records and document context that survive process restarts. Claude Code and other MCP clients need a stable way to ask repository questions without being granted write or execution access to a developer's workspace.

## Decision

- Store memory in the existing ORBIT append-only graph using `Decision` and `Documentation` nodes. Store the source hash, source path, tags, title, summary and bounded Markdown content as versioned attributes.
- Attach SHA-256-backed evidence to each memory version. Updates append versions; invalidation appends a tombstone. The old versions and evidence remain auditable.
- Import ADR/Markdown metadata deterministically. Only source-authored `Supersedes` and `Conflicts with` declarations create relationships or conflict notices; the first release does not pretend to infer semantic contradictions.
- Assess source freshness only against current hashes explicitly provided by the caller. Missing current hashes mean `unknown`, not `stale`.
- Serve exactly the documented read-only MCP tools over stdio. Open an existing SQLite database using the driver's `readonly` mode, require a registered repository, do not run migrations and do not create a database.
- Bound all MCP inputs and outputs. MCP exposes no mutation, filesystem-write, shell, device-control or network-fetch tools.

## Consequences

- Memory retrieval is deterministic lexical search, not vector or semantic search.
- MCP clients can read only facts already indexed locally; indexing and memory updates remain local CLI/library operations.
- Staleness is only as current as the source hash manifest supplied by the client.
- The read-only database connection is a second boundary in addition to the absence of mutating MCP tools.
