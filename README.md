# ORBIT — Engineering Intelligence Platform

> **Understand Everything. Trace Every Change. Prove What Works.**

ORBIT is an open-source, local-first platform that connects a repository's code, history, tests, CI, environments and (for embedded projects) real device telemetry into one evidence graph, and produces a **Change Passport** for important changes. Every claim should point to a real artifact. ORBIT never invents a test result, build, measurement or confidence score.

## Status: foundation build

This repository currently contains the **monorepo foundation only**. Nothing that analyses code exists yet.

| Area | State |
| --- | --- |
| Monorepo, TypeScript, lint, tests, CI | Working |
| Local API (`GET /health`) | Working |
| CLI (`orbit status`) | Working |
| Command Center | Overview with API health plus a read-only Business strategy and market research view |
| SQLite storage and migrations | Working (one `meta` table) |
| ORBIT Core graph, ATLAS, WITNESS, FLARE, CAPSULE, FLIGHT RECORDER, Change Passport, MCP, AI | **Not implemented yet** — see the [roadmap](docs/ROADMAP.md) |

The dashboard labels every engine as `NOT IMPLEMENTED` rather than showing placeholder numbers.

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

`orbit status` is read-only: it never creates or migrates a database. Exit codes: `0` success, `2` usage error, `3` invalid configuration, `4` not found, `5` database error, `1` internal error.

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
docs/         planning and design documents
```

Engine packages (`atlas`, `witness`, `flare`, `capsule`, `flight-recorder`, …) are created in the phase that implements them, so there are no empty scaffolds.

## Security notes

- The API binds to loopback by default and rejects requests whose `Host` header is not a loopback name (DNS-rebinding defence).
- Logs redact common secret field names.
- No telemetry, and no source code leaves your machine.

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md). ORBIT is not a security certification.

## Documentation

- [Master plan](ORBIT_MASTER_PLAN.md) and [build state](ORBIT_BUILD_STATE.md)
- [PRD](docs/PRD.md), [architecture](docs/ARCHITECTURE.md), [technical design](docs/architecture/TECHNICAL_DESIGN.md), [data model](docs/DATA_MODEL.md)
- [Roadmap](docs/ROADMAP.md), [competitive analysis](docs/COMPETITIVE_ANALYSIS.md), [test strategy](docs/TEST_STRATEGY.md), [UX specification](docs/UX_SPECIFICATION.md)
- [Business model](docs/BUSINESS_MODEL.md), [commercial roadmap](docs/COMMERCIAL_ROADMAP.md), [app Business module](docs/APP_BUSINESS_MODULE.md)
- [Architecture decision records](docs/DECISIONS/)

## Licence

Target licence: Apache-2.0. The `LICENSE` file has not been added yet (planned for the release-preparation phase), so no licence is granted for now.
