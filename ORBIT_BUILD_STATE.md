# ORBIT — Build State

Durable progress log. Update after every implementation phase.
Last updated: 2026-11-08

## Current phase

**Prompts 0–3 complete** (Prompt 3 committed locally, not pushed). Next: Prompt 4 (ATLAS scanning).

## Phase checklist

| Prompt | Scope                                          | Status                                         |
| ------ | ---------------------------------------------- | ---------------------------------------------- |
| 0      | Master plan and planning documents             | Done (docs only)                               |
| 1      | Technical design and architecture finalisation | Done (docs, versions verified)                 |
| 2      | Monorepo foundation                            | Done (see results below)                       |
| 3      | ORBIT Core graph                               | Done (see results below; not pushed)           |
| 4      | ATLAS scanning                                 | Not started                                    |
| 5      | ATLAS memory and MCP                           | Not started                                    |
| 6      | WITNESS                                        | Not started                                    |
| 7      | FLARE                                          | Not started                                    |
| 8      | CAPSULE                                        | Not started                                    |
| 9      | FLIGHT RECORDER                                | Not started                                    |
| 10     | Change Passport and Replay Room                | Not started                                    |
| 11     | API and CLI (full)                             | Not started (shell exists: `/health`, `status`) |
| 12     | Command Center (full)                          | Not started (shell exists)                     |
| 13     | GitHub Action                                  | Not started                                    |
| 14     | ORBIT AI                                       | Not started                                    |
| 15     | Security review                                | Not started                                    |
| 16     | Testing and validation                         | Not started                                    |
| 17     | Release polish                                 | Not started                                    |

## Prompt 3 summary (ORBIT Core: Living Engineering Graph)

- `packages/core`: canonical JSON + SHA-256 hashing, node/edge/evidence vocabulary, edge rule table, content-derived IDs, ledger hash rules, zod input schemas that never echo submitted values.
- `packages/shared`: safe repo-relative path normalisation (`paths.ts`).
- `packages/database`: graph tables, migration `0001` (generated) and `0002` (hand-written triggers + views), `createGraphStore` (repositories, evidence, nodes, edges, ledger, `verifyIntegrity`).
- `packages/graph`: `findNodes`, `neighbors`, bounded deterministic BFS `traverse`, `shortestPath`.
- ADR-0010 and `docs/DATA_MODEL.md` §11 describe the model.
- No AI, network or API key is involved anywhere in the core.

Test results (run here, `pnpm run test --force`): shared 36, core 66, database 35, graph 14, api 12, cli 8, web 6 = **177 passing**. `pnpm run check` (format, lint, typecheck, test, build) passes.

Tests cover: duplicates (idempotent writes), invalid relationships, missing evidence/repository/endpoints, versioning and tombstones, history ranges, repository isolation, literal key-prefix search, ledger chaining and determinism with a fixed clock, trigger-enforced immutability, tamper detection (altered attributes, rewritten ledger entry, deleted ledger entry, altered evidence, rows inserted behind the ledger), traversal cycles/depth/node budget/direction/determinism, shortest path.

Limitations specific to Prompt 3:
- The ledger is tamper-*evident*, not tamper-*proof*: an attacker with file access can drop triggers and rewrite all rows and hashes consistently (ADR-0010).
- Tamper tests drop triggers via SQL to simulate this; no external anchoring of the ledger head exists yet.
- Neighbour order is deterministic (edge type, then node ID) but not alphabetical by key.
- Traversal reads edges per node through the store; no benchmark on large graphs has been run.
- Nothing populates the graph yet; ATLAS (Prompt 4) is the first writer. The CLI/API do not expose the graph yet.

## Prompt 1 summary

- `docs/architecture/TECHNICAL_DESIGN.md`: verified toolchain, package boundaries and dependency rules, resolved design questions, draft contracts, Mermaid diagrams.
- ADRs 0007–0009 added. `docs/ARCHITECTURE.md` now points to the technical design.
- Versions were checked against the npm registry on 2026-11-07. Key finding: TypeScript `latest` is 7.0.2 but `typescript-eslint` 8.72.1 supports `<6.1.0`, so TypeScript is pinned to **6.0.3** (ADR-0007).

## Prompt 2 summary

Created: root config (pnpm workspace, Turborepo, strict tsconfig, ESLint 10 flat config, Prettier, editorconfig, CI workflow), `README.md`, and these packages:

- `packages/shared`: `OrbitError` and exit codes, zod-validated `loadConfig` (loopback-only by default), pino logger with secret redaction, `HealthResponse` type (also exported at `@orbit/shared/health` so the browser bundle does not pull in Node-only code).
- `packages/database`: better-sqlite3 + Drizzle, `openDatabase`, migration runner, `meta` table, initial migration `0000_flashy_beast.sql`.
- `apps/api`: Fastify, `GET /health`, JSON 404, Host-header allowlist (DNS-rebinding defence), graceful shutdown.
- `apps/cli`: `orbit --version`, `orbit status [--json] [--db]` (read-only, never creates a database), stable exit codes.
- `apps/web`: React 19 + Vite 8 + Tailwind 4 dashboard shell showing live API status and honest `NOT IMPLEMENTED` engine list.

## Test and check results (run in this environment, Node 22.23.4, Linux)

| Check                | Result                                   |
| -------------------- | ---------------------------------------- |
| `pnpm run build`     | 5/5 tasks pass                           |
| `pnpm run typecheck` | 7/7 tasks pass                           |
| `pnpm run test`      | 177 tests pass (shared 36, core 66, database 35, graph 14, api 12, cli 8, web 6) |
| `pnpm run lint`      | clean                                    |
| `pnpm run format:check` | clean (Markdown excluded)             |

Manual end-to-end checks that passed: API `/health` returned `ok` with schema version 1; a request with a foreign Host header got 403; `orbit status` before and after the database existed; `orbit bogus` exited 2; invalid config exited 3; `ORBIT_HOST=0.0.0.0` was refused; `pnpm dev` served the dashboard and the `/api/health` proxy reached the API.

## Issues found and fixed during Prompt 2

- zod and tsx versions were initially written swapped; corrected after re-checking the registry.
- pnpm 10 attempted a `node-gyp rebuild` for better-sqlite3 and failed (Node headers download blocked). better-sqlite3 13 ships prebuilt binaries, so its build script is ignored (ADR-0008).
- Fastify typing with a pino logger required an inferred return type for `buildServer`; a redundant `disableRequestLogging` option produced a deprecation warning and was removed.
- An "empty Host header" test passed wrongly-shaped input because `server.inject` substitutes a default Host; replaced by a real-socket HTTP/1.0 test with no Host header.

## Not verified / known limitations

1. **The React UI has not been viewed in a real browser.** Verified: it type-checks, builds, the served HTML and the API proxy work, and the health-state logic is unit-tested. Component rendering itself has no automated test yet (Playwright planned in Prompt 16).
2. **GitHub Actions CI has not run yet.** The workflow uses `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4`; newer majors may exist and could not be checked from this environment. Windows and macOS behaviour (including better-sqlite3 prebuilds and the directory-as-database test) is unconfirmed until CI runs.
3. A fresh-clone install was tested locally only (see below).
4. Competitor claims for CodeGraph, CodeCortex, Chisel and PatchProof remain unverified (`docs/COMPETITIVE_ANALYSIS.md`).
5. Project name availability (GitHub, npm, domains, trademarks) not checked.
6. No `LICENSE` file yet (Apache-2.0 targeted).
7. Repository moved/renamed: GitHub reports the canonical URL as `claudeee617-hue/New-Orbit-`; the session's remote uses the lowercase form, which redirects.
8. MCP SDK not installed yet; registry latest at check time was 1.32.2.

## Commands

```bash
pnpm install
pnpm dev          # API :4317 and dashboard :5173
pnpm check        # format:check, lint, typecheck, test, build
node apps/cli/dist/index.js status --json
```

## Next step

Prompt 4: ATLAS scanning (read-only repository scan into the graph via tree-sitter, never executing repository code).
