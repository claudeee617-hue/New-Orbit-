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

For optional AI analysis in the experimental Prompt 14 branch:
1. AI is disabled unless the local API process has `ORBIT_AI_ENABLED=true`.
2. The user chooses the provider, model and question in the Command Center.
3. The local API preview endpoint returns the exact context, destination, evidence IDs, redaction count, size and SHA-256 without contacting the provider.
4. The current UI selects evidence metadata only; it does not read source files. The API supports explicit excerpts, but the UI does not expose excerpt entry yet.
5. Best-effort secret redaction and context/response limits run before transmission.
6. The user must inspect the preview and check an explicit approval box. The analysis endpoint rebuilds the context and checks the preview hash before sending.
7. Provider keys are read from the local API process environment and are never returned to the browser.
8. Provider responses are advisory and citation status is checked against selected evidence IDs; they do not change the graph or apply patches automatically.
9. The current integration does not persist AI results as evidence or provide a saved-note/history feature.

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
