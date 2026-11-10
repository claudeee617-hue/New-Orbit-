# ORBIT — Engineering Intelligence Platform

> **Understand Everything. Trace Every Change. Prove What Works.**

ORBIT is a local-first engineering intelligence platform developed in the open. It connects repository structure, code changes, test and coverage reports, declared environments, recorded device telemetry and evidence into a traceable workflow.

Its central artifact is the **Change Passport**: a content-hashed record of a change, evidence supplied for it, known findings and missing verification. ORBIT does not invent test results, build outcomes, device measurements or correctness guarantees.

## Current status

The public `main` branch contains Engineering Prompts 0–11 and App Business Module Prompts 0–4, merged through PRs #5, #9 and #11. Prompt 12 Command Center is in draft [PR #23](https://github.com/claudeee617-hue/New-Orbit-/pull/23); its current head passed CI #393 and CodeQL #187, but real user-local workspace and manual accessibility gates remain. Prompt 13 WITNESS GitHub Action is in draft [PR #25](https://github.com/claudeee617-hue/New-Orbit-/pull/25); CI #422, CodeQL #215 and Action integration #10 passed, including the static fork-safety regression guard; a genuine external-fork event remains pending. Prompt 14 AI preview/approval is in draft [PR #24](https://github.com/claudeee617-hue/New-Orbit-/pull/24), stacked on #23; its AI backend/UI and approval-flow browser test are implemented, with CI #403, CodeQL #196 and AI approval-flow browser E2E passed. [PR #26](https://github.com/claudeee617-hue/New-Orbit-/pull/26) adds tests for all 12 MCP tools, a Claude Code guide, and a production stdio + disposable SQLite read-only acceptance test; its fresh CI #414 (Ubuntu/macOS/Windows plus process-level MCP test) and Security #207 passed. [PR #27](https://github.com/claudeee617-hue/New-Orbit-/pull/27) adds the gated ACCELQ REST runner, scenario plan and disposable SQLite-backed real-API browser smoke. Its separate remote-browser integration was removed. Earlier CI #395, CodeQL #189 and ACCELQ runner validation #105 passed before cleanup; the cleanup-head ACCELQ runner-validation job passed and fresh full CI/Security checks are being rerun. Live ACCELQ execution remains skipped pending account configuration. Open PRs are not a release: PR #29 proposes persistent per-test FLARE history across CLI invocations (run-ID deduplication, empty-report PARTIAL semantics and bounded historical analysis); its CI and Security validation are still pending. User-local DB validation, manual WCAG/screen-reader audit, provider live smoke, fork-specific Action validation, ACCELQ tenant pilot and independent release review remain outstanding.

| Capability | Current implementation |
| --- | --- |
| Monorepo, TypeScript, lint, tests and CI foundation | Implemented on `main` |
| ORBIT Core graph, versioned records and hash-chained ledger | Implemented on `main` |
| ATLAS repository scanner and architecture reports | Implemented on `main` |
| ATLAS persistent decision memory and read-only stdio MCP | Implemented on `main` (PR #5 merged); expanded all-12-tool integration coverage and Claude Code guide proposed in PR #26 |
| WITNESS changed-line coverage, baseline comparison, filename findings, Markdown/SARIF | Extended prototype on `main` (PR #5 merged; full cross-platform CI passed) |
| FLARE JUnit, pytest, Jest and Go JSON reports; failure clusters and duration summaries | Base prototype on `main`; durable per-test history is proposed in open draft PR #29 and is not yet shipped |
| CAPSULE polyglot toolchain, dependency, container and workspace manifest inspection | Extended prototype on `main`; build replay is not implemented |
| FLIGHT RECORDER recorded telemetry parser, caller-defined analysis and hash-verified graph persistence | Implemented on `main` as recorded-file prototype; physical serial/USB capture unavailable |
| Change Passport graph correlation, versioned history, comparisons and non-executing reproduction plan | Implemented on `main` as backend/CLI prototype; visual Replay Room UI not implemented |
| App Business Module | Implemented on `main` via PR #9: strategy, market references, local actual-vs-forecast calculator and pricing simulator; no live accounting/CRM/billing data |
| Specialist AI agents, GitHub Action and full dashboard | Not implemented (MCP stdio server is now on `main`) |

See [ORBIT_BUILD_STATE.md](ORBIT_BUILD_STATE.md) for phase-by-phase implementation details, branch status, known limitations and verified test results.

## Requirements

- Node.js 22.12 or newer (Node 22 LTS recommended; see `.nvmrc`)
- pnpm 10 (Corepack can use the version pinned in `package.json`)

## Quick start

```bash
git clone https://github.com/claudeee617-hue/New-Orbit-.git
cd New-Orbit-
pnpm install
pnpm dev
```

Open http://127.0.0.1:5173. The dashboard checks the local API at http://127.0.0.1:4317/health.

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm check
```

### Workspace, API and diagnostics (Prompt 11)

```bash
node apps/cli/dist/index.js init --repo local/my-project --name "My Project"
node apps/cli/dist/index.js doctor --json
node apps/cli/dist/index.js graph summary --json
node apps/cli/dist/index.js graph nodes --repo local/my-project --type Function
node apps/cli/dist/index.js ci ingest ci-result.json --repo local/my-project
node apps/cli/dist/index.js tests ingest junit.xml --repo local/my-project --format junit
node apps/cli/dist/index.js tests history --repo local/my-project --json
```

The local API exposes authenticated `/api/v1` repository, graph, evidence, report, Passport and ingestion routes. On first API start it creates a private `api.token` next to the configured workspace database; send it as a Bearer token. See [Prompt 11 API and CLI guide](docs/PROMPT_11_API_CLI.md) for endpoints and security boundaries.

Build the CLI before running it:

```bash
pnpm build
node apps/cli/dist/index.js status --json
node apps/cli/dist/index.js scan . --db .orbit/orbit.db
node apps/cli/dist/index.js atlas export --db .orbit/orbit.db --out atlas.json
node apps/cli/dist/index.js atlas impact packages/core/src/index.ts --db .orbit/orbit.db
```

### Evidence-engine prototype commands

These commands are available after the feature branch is checked out and built:

```bash
# Compare changed lines with LCOV or Cobertura evidence
node apps/cli/dist/index.js verify change.diff --lcov coverage.info
node apps/cli/dist/index.js verify change.diff --cobertura cobertura.xml --format markdown

# Parse a JUnit report (one report alone is not historical flaky-test evidence)
node apps/cli/dist/index.js flare summarize junit.xml

# Inspect declared environment files and compare snapshots
node apps/cli/dist/index.js capsule inspect . --out capsule.json
node apps/cli/dist/index.js capsule compare before.json after.json

# Parse/replay a recorded telemetry file; no device is connected
node apps/cli/dist/index.js device replay serial.ndjson --units '{"voltage":"V"}' --demo
node apps/cli/dist/index.js device serial-status

# Store a verified repo-local recording in an indexed workspace
node apps/cli/dist/index.js device replay fixtures/hardware-telemetry/esp32-demo.ndjson --db .orbit/orbit.db --repo local/my-repository --repo-root . --artifact-path fixtures/hardware-telemetry/esp32-demo.ndjson --demo

# Create a graph-backed Passport; inspect history, compare and generate a non-executing plan
node apps/cli/dist/index.js passport create passport-input.json --db .orbit/orbit.db --repo local/my-repository
node apps/cli/dist/index.js passport history <passport-node-id> --db .orbit/orbit.db --repo local/my-repository
node apps/cli/dist/index.js passport compare <before-node-id> <after-node-id> --db .orbit/orbit.db --repo local/my-repository
node apps/cli/dist/index.js passport plan <passport-node-id> --db .orbit/orbit.db --repo local/my-repository

# Create a standalone passport from an explicit JSON evidence bundle
node apps/cli/dist/index.js passport create passport-input.json
```

All `--out` paths are created without overwriting an existing file.

Extended commands on `main`:

```bash
node apps/cli/dist/index.js witness coverage-compare before.info after.info --format lcov
node apps/cli/dist/index.js witness sensitive-paths change.diff
node apps/cli/dist/index.js flare analyse run-1.xml run-2.xml --format junit
node apps/cli/dist/index.js flare analyse pytest-1.json pytest-2.json --format pytest-json
node apps/cli/dist/index.js capsule inspect-extended .
```

## Product architecture

- **ATLAS** maps source structure, symbols, imports, calls, repository history and impact.
- **WITNESS** compares changed lines with actual coverage records.
- **FLARE** analyses test reports and, when historical runs are supplied, estimates unreliable test behaviour.
- **CAPSULE** fingerprints declared development requirements without reading secret values.
- **FLIGHT RECORDER** parses recorded embedded-device logs and telemetry.
- **Change Passport** records supplied evidence and explicitly lists what is missing.
- **ORBIT Core** stores versioned graph facts and a tamper-evident hash-chained event ledger.

## Safety and evidence boundaries

- Local API binds to loopback by default and validates Host headers.
- Repository scanning skips symbolic links and uses bounded file/size limits.
- XML DTD/entity declarations are rejected by the prototype parsers.
- Environment secret values are not collected; only variable names from example files are inspected.
- Telemetry replay parses recorded files and does not connect to hardware or send device commands.
- A measured coverage hit does not prove correctness.
- A flaky-test estimate is not reliable without sufficient repeated observations.
- A Change Passport uses evidence scoped to the exact commit and reports missing/partial dimensions; it is not a security certification or correctness guarantee.
- Synthetic ESP32/STM32 logs are labelled DEMO; physical USB/serial capture is unavailable.
- No telemetry is sent externally by default.

See [the threat model](docs/THREAT_MODEL.md), [technical design](docs/architecture/TECHNICAL_DESIGN.md), [data model](docs/DATA_MODEL.md) and [build state](ORBIT_BUILD_STATE.md).

## Documentation

- [Master plan](ORBIT_MASTER_PLAN.md) and [build state](ORBIT_BUILD_STATE.md)
- [PRD](docs/PRD.md), [architecture](docs/ARCHITECTURE.md), [technical design](docs/architecture/TECHNICAL_DESIGN.md), [data model](docs/DATA_MODEL.md)
- [Technical roadmap](docs/ROADMAP.md), [competitive analysis](docs/COMPETITIVE_ANALYSIS.md), [test strategy](docs/TEST_STRATEGY.md), [UX specification](docs/UX_SPECIFICATION.md)
- [Business model & monetization architecture](docs/BUSINESS_MODEL.md), [commercial product roadmap](docs/COMMERCIAL_ROADMAP.md), [App Business Module](docs/APP_BUSINESS_MODULE.md), [Prompt 11 API and CLI guide](docs/PROMPT_11_API_CLI.md)
- [Architecture decision records](docs/DECISIONS/)

## Contributing

The architecture and current roadmap are documented in [docs/ROADMAP.md](docs/ROADMAP.md). Contributions should include tests, source evidence for claims, and updated build-state notes. Do not submit real secrets, private repository data or hardware logs containing credentials.

## License

The repository includes an Apache License 2.0 `LICENSE` file, merged through PR #15. Before release, review third-party notices, dependency-license compatibility, attribution and ORBIT name/trademark availability; see [the release checklist](docs/RELEASE_CHECKLIST.md).

### ATLAS memory and MCP (Prompt 5)

ATLAS can store versioned architectural notes and import ADR/Markdown documents into the same append-only graph as code facts:

```ts
import { importMarkdownMemory, searchMemories } from '@orbit/atlas';

const memory = importMarkdownMemory(store, {
  repositoryId,
  path: 'docs/DECISIONS/0012-atlas-persistent-memory-and-read-only-mcp.md',
  content: markdownText,
});
const matches = searchMemories(store, repositoryId, { query: 'read-only MCP' });
```

Each memory version carries a SHA-256-backed evidence record. Updating a key appends a version; invalidation appends a tombstone. ADR metadata can declare `Supersedes` and `Conflicts with` references. Source freshness is compared only against explicitly supplied current hashes; absent hashes are reported as unknown. This is bounded lexical retrieval, not an embedding or AI inference system.

Start the read-only MCP server after scanning a repository:

```bash
pnpm build
node apps/cli/dist/index.js mcp start --db .orbit/orbit.db --repo local/my-repository
```

`mcp start` uses stdio transport and opens an existing SQLite database in read-only mode. It does not create or migrate databases. The 12 tools are `orbit_repository_map`, `orbit_search_symbols`, `orbit_get_symbol`, `orbit_get_callers`, `orbit_get_callees`, `orbit_analyze_impact`, `orbit_find_related_tests`, `orbit_search_history`, `orbit_search_memory`, `orbit_get_architecture`, `orbit_get_change_context` and `orbit_get_evidence`. No tool can mutate the graph, run commands, write files or control hardware. MCP responses are capped at 48 KiB.


## Security and contribution

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability, [docs/PRIVACY.md](docs/PRIVACY.md) for data handling, and [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. The release checklist is in [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).
