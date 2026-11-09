# ORBIT — Engineering Intelligence Platform

> **Understand Everything. Trace Every Change. Prove What Works.**

ORBIT is an open-source, local-first platform that connects a repository's code, history, tests, CI, environments and (for embedded projects) real device telemetry into one evidence graph, and produces a **Change Passport** for important changes. Every claim should point to a real artifact. ORBIT never invents a test result, build, measurement or confidence score.

## Status

| Area | State |
| --- | --- |
| Monorepo, TypeScript, lint, tests, CI (Linux, Windows, macOS) | Working |
| Local API (`GET /health`) and dashboard shell | Working shell, no analysis data yet |
| ORBIT Core evidence graph (append-only, hash-chained ledger) | Working |
| **ATLAS** repository scanning (`orbit scan`, `orbit atlas …`) | Working, CLI only |
| **WITNESS** pull-request verification (`orbit verify`) | Working, CLI only |
| ATLAS memory/MCP (skipped for now), FLARE, CAPSULE, FLIGHT RECORDER, Change Passport, AI | **Not implemented yet** — see the [roadmap](docs/ROADMAP.md) |

The dashboard marks each engine `CLI ONLY` or `NOT IMPLEMENTED` rather than showing placeholder numbers. See [`ORBIT_BUILD_STATE.md`](ORBIT_BUILD_STATE.md) for exact test results and known limitations.

## Requirements

- Node.js 22.12 or newer (22 LTS recommended; see `.nvmrc`)
- pnpm 10 (the exact version is pinned in `package.json`; `corepack enable` will pick it up)

## Quick start

```bash
git clone https://github.com/claudeee617-hue/New-Orbit-.git
cd New-Orbit-
pnpm install
pnpm dev
```

Then open <http://127.0.0.1:5173>. The page shows the live status of the local API (<http://127.0.0.1:4317/health>) and its SQLite database. If the API is not running, the page says so.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install dependencies |
| `pnpm dev` | Build workspace packages, then run the API (port 4317) and dashboard (port 5173) |
| `pnpm build` | Build every package and the web app |
| `pnpm test` | Run all tests (Vitest) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript checks in every package |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm check` | format check, lint, typecheck, tests and build in one go |

### CLI

```bash
pnpm build
node apps/cli/dist/index.js status          # human-readable
node apps/cli/dist/index.js status --json   # machine-readable
node apps/cli/dist/index.js --version
```

```bash
node apps/cli/dist/index.js scan . --db .orbit/orbit.db            # ATLAS: read-only scan
node apps/cli/dist/index.js atlas impact <file> --db .orbit/orbit.db
node apps/cli/dist/index.js verify --base main --head HEAD \
  --coverage lcov.info --test-report junit.xml --build-result build.json \
  --format md --fail-on PARTIAL                                     # WITNESS
```

`orbit verify` never runs your tests: it reads the evidence files you give it. Anything not supplied is reported `NOT_MEASURED`, never passed. See [ADR-0012](docs/DECISIONS/0012-witness-verification-model.md).

`orbit status` is read-only: it never creates or migrates a database. Exit codes: `0` success, `2` usage error, `3` invalid configuration, `4` not found, `5` database error, `6` verification result at or beyond `--fail-on`, `1` internal error.

## Configuration

Environment variables (all optional):

| Variable | Default | Notes |
| --- | --- | --- |
| `ORBIT_HOST` | `127.0.0.1` | Must be loopback unless `ORBIT_ALLOW_NON_LOOPBACK=true` |
| `ORBIT_PORT` | `4317` | |
| `ORBIT_DB_PATH` | `.orbit/orbit.db` | Created on first API start |
| `ORBIT_LOG_LEVEL` | `info` | `fatal` … `trace`, or `silent` |
| `ORBIT_ALLOW_NON_LOOPBACK` | `false` | Explicit opt-in to bind to a non-loopback address |
| `ORBIT_API_URL` | `http://127.0.0.1:4317` | Used by the dev server proxy only |

## Repository layout

```
apps/
  api/        Fastify local API
  cli/        `orbit` command
  web/        React + Vite + Tailwind dashboard
packages/
  shared/     errors, logging, configuration, shared types
  database/   SQLite (better-sqlite3 + Drizzle) and migrations
  core/       graph vocabulary, rules, hashing, schemas
  graph/      read-only graph queries
  atlas/      repository and architecture intelligence
  witness/    evidence-based pull-request verification
docs/         planning and design documents
```

Remaining engine packages (`flare`, `capsule`, `flight-recorder`, …) are created in the phase that implements them, so there are no empty scaffolds.

## Security notes

- The API binds to loopback by default and rejects requests whose `Host` header is not a loopback name (DNS-rebinding defence).
- Logs redact common secret field names.
- No telemetry, and no source code leaves your machine.

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md). ORBIT is not a security certification.

## Documentation

- [Master plan](ORBIT_MASTER_PLAN.md) and [build state](ORBIT_BUILD_STATE.md)
- [PRD](docs/PRD.md), [architecture](docs/ARCHITECTURE.md), [technical design](docs/architecture/TECHNICAL_DESIGN.md), [data model](docs/DATA_MODEL.md)
- [Roadmap](docs/ROADMAP.md), [competitive analysis](docs/COMPETITIVE_ANALYSIS.md), [test strategy](docs/TEST_STRATEGY.md), [UX specification](docs/UX_SPECIFICATION.md)
- [Architecture decision records](docs/DECISIONS/)

## Licence

Target licence: Apache-2.0. The `LICENSE` file has not been added yet (planned for the release-preparation phase), so no licence is granted for now.
