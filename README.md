# ORBIT — Engineering Intelligence Platform

> **Understand Everything. Trace Every Change. Prove What Works.**

ORBIT is an open-source, local-first engineering intelligence platform. It connects repository structure, code changes, test and coverage reports, declared environments, recorded device telemetry and evidence into a traceable workflow.

Its central artifact is the **Change Passport**: a content-hashed record of a change, evidence supplied for it, known findings and missing verification. ORBIT does not invent test results, build outcomes, device measurements or correctness guarantees.

## Current status

The public `main` branch contains the monorepo foundation, immutable evidence graph and ATLAS repository scanner. A cross-engine prototype is being developed on `feat/orbit-evidence-engines`. This is an early engineering build, not yet a complete release.

| Capability | Current implementation |
| --- | --- |
| Monorepo, TypeScript, lint, tests and CI foundation | Implemented on `main` |
| ORBIT Core graph, versioned records and hash-chained ledger | Implemented on `main` |
| ATLAS repository scanner and architecture reports | Implemented on `main` |
| WITNESS changed-line coverage (LCOV/Cobertura) | Prototype on feature branch |
| FLARE JUnit parsing and supplied-history statistics | Prototype; no persisted CI history yet |
| CAPSULE declared-environment fingerprint and comparison | Prototype; no build replay yet |
| FLIGHT RECORDER recorded telemetry parser/replay | Prototype; no physical serial connection yet |
| Change Passport assembly | Prototype; no graph correlation or Replay Room UI yet |
| MCP, specialist AI agents, GitHub Action, full dashboard | Not implemented |

See [ORBIT_BUILD_STATE.md](ORBIT_BUILD_STATE.md) for phase-by-phase implementation details and verified test results.

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
node apps/cli/dist/index.js device replay serial.ndjson

# Create a passport from an explicit JSON evidence bundle
node apps/cli/dist/index.js passport create passport-input.json
```

All `--out` paths are created without overwriting an existing file.

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
- A Change Passport is an evidence record, not a security certification or correctness guarantee.
- No telemetry is sent externally by default.

See [the threat model](docs/THREAT_MODEL.md), [technical design](docs/architecture/TECHNICAL_DESIGN.md), [data model](docs/DATA_MODEL.md) and [build state](ORBIT_BUILD_STATE.md).

## Documentation

- [Master plan](ORBIT_MASTER_PLAN.md) and [build state](ORBIT_BUILD_STATE.md)
- [PRD](docs/PRD.md), [architecture](docs/ARCHITECTURE.md), [technical design](docs/architecture/TECHNICAL_DESIGN.md), [data model](docs/DATA_MODEL.md)
- [Technical roadmap](docs/ROADMAP.md), [competitive analysis](docs/COMPETITIVE_ANALYSIS.md), [test strategy](docs/TEST_STRATEGY.md), [UX specification](docs/UX_SPECIFICATION.md)
- [Business model & monetization architecture](docs/BUSINESS_MODEL.md), [commercial product roadmap](docs/COMMERCIAL_ROADMAP.md)
- [Architecture decision records](docs/DECISIONS/)

## Contributing

The architecture and current roadmap are documented in [docs/ROADMAP.md](docs/ROADMAP.md). Contributions should include tests, source evidence for claims, and updated build-state notes. Do not submit real secrets, private repository data or hardware logs containing credentials.

## License

The repository targets Apache-2.0, but the license file has not yet been added. Until that is done, the repository does not grant an open-source license.

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
