# ORBIT — Engineering Intelligence Platform

[![CI](https://github.com/claudeee617-hue/New-Orbit-/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/claudeee617-hue/New-Orbit-/actions/workflows/ci.yml)
[![CodeQL](https://github.com/claudeee617-hue/New-Orbit-/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/claudeee617-hue/New-Orbit-/actions/workflows/security.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Status: pre-release](https://img.shields.io/badge/status-pre--release-orange.svg)

> **Understand Everything. Trace Every Change. Prove What Works.**

ORBIT is a local-first engineering intelligence platform developed in the open. It connects repository structure, code changes, test and coverage reports, declared environments, recorded device telemetry and evidence into a traceable workflow.

Its central artifact is the **Change Passport**: a content-hashed record of a change, evidence supplied for it, known findings and missing verification. ORBIT does not invent test results, build outcomes, device measurements or correctness guarantees.

## Current status

ORBIT is pre-release (no package or Marketplace release has been published). The public `main` branch contains engineering roadmap Prompts 0–11 and the App Business Module sub-prompts 0–4, including the local API and CLI (PR #11), the git-based WITNESS package (PR #32), ATLAS 0.2.0, the read-only MCP server with production acceptance tests (PR #26), parser regression tests (PR #31) and a prototype GitHub Action (PR #25). CI runs the full format, lint, typecheck, test and build matrix on Ubuntu, macOS and Windows, plus CodeQL and a dependency audit. The Command Center (real API data, Chromium E2E in CI), durable FLARE history, an opt-in ORBIT AI preview (core works without a key) and an opt-in ACCELQ regression workflow are also on `main`. A local `pnpm run check` runs 573 tests across eleven workspace suites.

| Capability | Current implementation |
| --- | --- |
| Monorepo, TypeScript, lint, tests and CI foundation | Implemented on `main` |
| ORBIT Core graph, versioned records and hash-chained ledger | Implemented on `main` |
| ATLAS repository scanner and architecture reports | Implemented on `main` |
| ATLAS persistent decision memory and read-only stdio MCP | Implemented on `main` (PR #5 merged; full Ubuntu/macOS/Windows CI passed) |
| WITNESS: git-based PR verification (`orbit verify --base --head`: exact changed lines, symbols, LCOV/Cobertura, JUnit, build result, regressions, findings, Markdown/JSON/SARIF) plus the diff-file coverage prototype | Implemented in `packages/witness`; CLI only |
| FLARE JUnit, pytest, Jest and Go JSON reports; failure clusters and duration summaries | Extended prototype on `main`; durable history across independent invocations remains outstanding |
| CAPSULE polyglot toolchain, dependency, container and workspace manifest inspection | Extended prototype on `main`; build replay is not implemented |
| FLIGHT RECORDER recorded telemetry parser, caller-defined analysis and hash-verified graph persistence | Implemented on `main` as recorded-file prototype; physical serial/USB capture unavailable |
| Change Passport graph correlation, versioned history, comparisons and non-executing reproduction plan | Implemented on `main` as backend/CLI prototype; visual Replay Room UI not implemented |
| App Business Module | Strategy and local actual-vs-forecast / pricing simulator on `main`; local opportunity pipeline and JSON backup/restore proposed on PR #52; no live accounting/CRM/billing data |
| GitHub Action for PR verification | Prototype on `main` (PR #25); see [docs/GITHUB_ACTION.md](docs/GITHUB_ACTION.md). Not published to the Marketplace |
| Full Command Center, durable FLARE history | On `main` (PRs #23, #29, #38) |
| ORBIT AI | Opt-in preview on `main` (PR #39); no live-provider results are claimed |

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
```bash
# WITNESS, git mode: reads evidence files you supply; never runs your tests or build
node apps/cli/dist/index.js verify --base main --head HEAD \
  --coverage lcov.info --test-report junit.xml --build-result build.json \
  --format md --fail-on PARTIAL
```

Anything not supplied is reported `NOT_MEASURED`, never passed. `--fail-on` exits with code `6` when the overall status is at least that bad. See [ADR-0016](docs/DECISIONS/0016-witness-git-verification-model.md).


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

All `--out` paths are created without overwriting an existing file (git-mode `orbit verify` accepts `--force`).

Extended commands on `main`:

```bash
node apps/cli/dist/index.js witness coverage-compare before.info after.info --format lcov
node apps/cli/dist/index.js witness sensitive-paths change.diff
node apps/cli/dist/index.js flare analyse run-1.xml run-2.xml --format junit
node apps/cli/dist/index.js flare analyse pytest-1.json pytest-2.json --format pytest-json
node apps/cli/dist/index.js capsule inspect-extended .
```

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

## Security and contribution

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability, [docs/PRIVACY.md](docs/PRIVACY.md) for data handling, and [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. The release checklist is in [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

## License

ORBIT is released under the [Apache License 2.0](LICENSE).
