# ORBIT Privacy and Data Handling

**Status:** Project privacy design and implementation notes; not legal advice or a substitute for a jurisdiction-specific privacy review.

## Default behavior

ORBIT is designed to run locally. The Core graph, SQLite evidence store, scanner, CLI, local API and read-only MCP server do not require an ORBIT account or hosted service. No source upload or telemetry collection by ORBIT is intended by default.

The local workspace database may contain repository paths, symbol names, dependency relationships, commit identifiers, test summaries, CI metadata, environment declarations, evidence hashes and recorded telemetry summaries. Treat the workspace directory as sensitive.

## Credentials

- The local API session token is stored in a private `api.token` file next to the configured database, or supplied through `ORBIT_API_TOKEN`.
- Do not commit the token or paste it into support tickets, screenshots or AI chats.
- Provider credentials must be supplied through an explicit local configuration mechanism or environment variable. They must never be written to evidence records, graph attributes, generated reports or logs.
- Environment inspection should collect names and declared metadata only; it must not read secret values from `.env` files.

## Optional external integrations

GitHub Actions, GitHub API access, MCP clients and optional AI providers may create network traffic when configured. Each integration must state what data leaves the machine, why it is sent, and which credentials are used.

For optional AI analysis:
1. AI is off by default.
2. The user chooses the provider and model.
3. The UI shows the exact context bundle before sending.
4. Secret redaction and context-size limits run before transmission.
5. Only the explicitly selected evidence and source excerpts are sent.
6. The user can cancel before sending.
7. Provider responses are advisory and must cite ORBIT evidence IDs; they do not change the graph or apply patches automatically.

## Retention and deletion

ORBIT's local database and exported artifacts remain under the user's control. Removing a repository from the UI must not be represented as secure deletion unless the underlying database rows and external backups are actually removed. Evidence is append-only by design; correction records preserve history.

Users can close the application and remove their local workspace using normal operating-system file tools. Backups, copied reports, CI artifacts and provider-side retention are separate and must be managed at those destinations.

## Data ORBIT must not collect by default

- Raw environment variable values or secret files.
- API tokens, passwords, private keys or cookies.
- Unselected source files or full repository archives for hosted processing.
- Device commands or hardware-control permissions.
- Background analytics or usage telemetry.

## Limitations

This document describes intended behavior and known design boundaries. It does not claim that every implementation path has been independently audited. See [SECURITY.md](../SECURITY.md) and the threat model for current security review status.
