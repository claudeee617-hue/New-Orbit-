# ORBIT Prompt 11 — Local API and CLI

**Status:** Implemented on `feat/prompt-11-api-cli`; awaiting full cross-platform CI and review. Not merged.

Prompt 11 connects the existing ORBIT graph and evidence engines to a safe local HTTP API and practical workspace CLI commands. The API remains local-first, loopback-bound by default and bearer-token authenticated outside the public health endpoint.

## Local API security

- `GET /health` is public and reports only service/database health.
- Authenticated routes live under `/api/v1/*` and require `Authorization: Bearer <token>`.
- On first API startup, ORBIT creates a random 256-bit URL-safe token beside the configured database as `api.token`.
- On Unix, the token file is created with mode `0600`; its parent directory is created with mode `0700`. Existing symlink/non-regular token paths and malformed tokens are rejected.
- An explicit `ORBIT_API_TOKEN` environment variable can supply a token instead; it must be 40–128 URL-safe characters.
- Tokens are never returned by API responses or printed in logs. The authenticated session endpoint reports only the source and token-file path.
- The API checks the HTTP Host header against the configured loopback allowlist to mitigate DNS rebinding.
- The default request body limit is approximately 2 MiB. Graph and evidence queries have bounded limits and pagination.
- The API has no CORS wildcard, hosted sync, telemetry export, shell execution or device-control endpoint.

Keep `api.token` private. Do not commit it, paste it into issues, or expose it to browser extensions. A client should read it from the local file and send it only to the loopback API.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Public service/database health |
| GET | `/api/v1/session` | Authenticated token-source diagnostics (never returns token) |
| GET | `/api/v1/repositories` | List registered repositories |
| POST | `/api/v1/repositories/scan` | Scan a local directory with bounded ATLAS limits |
| GET | `/api/v1/repositories/:key` | Repository metadata |
| GET | `/api/v1/repositories/:key/graph` | Bounded, paginated nodes and edges |
| GET | `/api/v1/repositories/:key/evidence` | Evidence list with optional commit/source filters |
| GET | `/api/v1/repositories/:key/evidence/:id` | One evidence record |
| GET | `/api/v1/repositories/:key/nodes/:id` | One graph node and its related evidence |
| GET | `/api/v1/repositories/:key/passports` | Change Passport nodes |
| GET | `/api/v1/repositories/:key/passports/:id/history` | Passport versions |
| GET | `/api/v1/repositories/:key/passports/:before/compare/:after` | Compare two passports |
| POST | `/api/v1/repositories/:key/passports` | Record a graph-backed passport from stored, commit-scoped evidence |
| GET | `/api/v1/repositories/:key/reports/impact?file=...` | ATLAS impact report |
| GET | `/api/v1/repositories/:key/reports/atlas` | Deterministic ATLAS export |
| POST | `/api/v1/repositories/:key/ingest/ci` | Append a CI result and summary evidence |
| POST | `/api/v1/repositories/:key/ingest/test-report` | Parse JUnit / pytest / Jest / Go report and append summary evidence |
| POST | `/api/v1/repositories/:key/ingest/environment` | Append explicitly whitelisted manifest metadata as PARTIAL evidence |
| POST | `/api/v1/repositories/:key/ingest/telemetry` | Parse recorded telemetry and append observational evidence |

CI summary and environment snapshot schemas accept only allowlisted metadata fields. Unknown fields—including arbitrary credential-like fields—are rejected rather than persisted. Environment evidence is marked PARTIAL because a supplied manifest snapshot is not proof of the actual installed runner image. Test and telemetry ingestion store hashes and bounded summaries, not raw reports/logs as graph attributes. Telemetry ingestion parses recorded data only and does not connect to hardware.

## CLI additions

The existing `orbit status`, `orbit scan`, `orbit atlas`, verification, engine, Passport and MCP commands remain available.

### Initialise a workspace

```bash
node apps/cli/dist/index.js init
node apps/cli/dist/index.js init --repo local/my-project --name "My Project"
```

### Run diagnostics and inspect the graph

```bash
node apps/cli/dist/index.js doctor --json
node apps/cli/dist/index.js graph summary --json
node apps/cli/dist/index.js graph nodes --repo local/my-project --type Function --limit 100
```

`doctor` checks whether the workspace exists, lists repositories, verifies each repository's evidence ledger, and checks API token configuration/file permissions. It does not make a network request or claim that the API process is running.

### Ingest CI and test reports

```bash
node apps/cli/dist/index.js ci ingest ci-result.json --repo local/my-project
node apps/cli/dist/index.js tests ingest junit.xml --repo local/my-project --format junit
node apps/cli/dist/index.js tests history --repo local/my-project --json
```

Supported test report formats: `junit`, `pytest-json`, `jest-json`, and `go-json`. Report inputs are capped at 2 MiB. Historical flaky-test classification still needs repeated executions; one ingested run is not enough.

## Validation scope and limitations

- API integration tests exercise Host protection, authentication, repository reads, CI/test/environment/telemetry ingestion, token redaction and invalid input handling.
- CLI tests exercise workspace initialization, doctor checks, graph summaries, CI ingestion and test history.
- The API scan endpoint scans a local directory selected by the authenticated local user; it does not accept remote URLs.
- Environment snapshots accept whitelisted summary metadata only. They do not include arbitrary environment variables or secret values.
- The token-file path is local filesystem state. Back it up only with the local ORBIT database under the same access controls.
- This is a local development API, not a multi-user server. Do not enable non-loopback binding on an untrusted network.
