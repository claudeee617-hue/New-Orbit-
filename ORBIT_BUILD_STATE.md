# ORBIT — Build State

Durable progress log. Update after every implementation phase.
Last updated: 2026-11-10

## Current phase

**Prompts 0–4 and 6 complete. Prompt 5 (ATLAS memory and MCP) was skipped at the user's request** ("nahi bhai prompt 5 nahi", 2026-11-08) and is still open. Next: Prompt 7 (FLARE), or Prompt 5 if the user wants it back.

## Phase checklist

| Prompt | Scope                                          | Status                                         |
| ------ | ---------------------------------------------- | ---------------------------------------------- |
| 0      | Master plan and planning documents             | Done (docs only)                               |
| 1      | Technical design and architecture finalisation | Done (docs, versions verified)                 |
| 2      | Monorepo foundation                            | Done (see results below)                       |
| 3      | ORBIT Core graph                               | Done (see results below; not pushed)           |
| 4      | ATLAS scanning                                 | Done (see results below)                       |
| 5      | ATLAS memory and MCP                           | **Skipped at user's request** (not built)      |
| 6      | WITNESS                                        | Done (see results below)                       |
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

## Prompt 6 summary (WITNESS: evidence-based PR verification)

- `packages/witness`: Git diff (merge base to head, `--unified=0`) to exact changed head lines (added / modified / deletion-only, renames, binary); changed-file classification (ATLAS classifier); changed-symbol mapping from ATLAS extraction of the file *at head*; LCOV and Cobertura XML parsers; JUnit XML parser; changed-line coverage (covered / uncovered / non-executable) that never infers from file coverage; per-symbol coverage; regression comparison (base vs head coverage per file, base vs head test results); test linkage via ATLAS static facts (direct vs indirect); sensitive-file rules; relevant ADRs by textual mention; findings with stable IDs (`WIT-<RULE>-<hash>`), severity, explanation, location, evidence and suggested action; Markdown, JSON and SARIF 2.1.0 renderers; opt-in graph recording (`--record`: evidence per input + `Finding` nodes + `AFFECTS` edges).
- CLI: `orbit verify --base --head [--repo --coverage --base-coverage --test-report --base-test-report --build-result --coverage-commit --min-coverage --format md|json|sarif --out --force --record --key --db --fail-on PARTIAL|INCOMPLETE|FAIL]`. New exit code 6 (`VERIFICATION_FAILED`). `--out` refuses to overwrite without `--force`.
- Status rules and design: ADR-0012. Dashboard now marks WITNESS `CLI ONLY`.
- Deterministic sample PR report (Markdown/JSON/SARIF) in `packages/witness/samples/`, produced by a fixed-date fixture repo; its LCOV/JUnit inputs are **hand-written parser fixtures, not output of a real run** (stated in the samples README).

Test results (`pnpm run check`, Node 22.23.4, Linux): shared 36, core 66, database 43, graph 14, atlas 96, witness 62, api 12, cli 21, web 6 = **356 passing**; format, lint, typecheck and build clean.

Parser tests cover: empty/garbage/binary input, truncated files, malformed records, CRLF, duplicate records, wrong root elements, DOCTYPE and entity handling, runaway nesting, nameless test cases, ambiguous and suffix path matches, hostile refs, missing inputs.

Real-world check run here (not a unit test): after committing, `orbit verify --base HEAD~1 --head HEAD` on this repository with a real LCOV and JUnit report from `vitest --coverage` of the witness package and a real `pnpm run build` result gave overall PARTIAL: 440 of 463 executable changed lines covered (95.0%), tests PASS (62/62), build PASS, and every changed file outside `packages/witness` reported NOT_MEASURED for coverage because no coverage for those packages was supplied. That is the intended behaviour.

Limitations specific to Prompt 6:
- WITNESS reads evidence files; it does not run tests or builds. Coverage staleness cannot be detected from the report itself (it states the assumption; `--coverage-commit` enables a check).
- SARIF output was validated structurally by tests only; the official SARIF JSON schema could not be fetched offline, so schema validation was not run.
- Test linkage is static (imports and naming); dynamic dispatch and reflection are invisible. Link is not coverage.
- Line coverage only: no branch coverage, no per-test coverage contexts.
- Relevant ADRs are matched by textual mention of changed paths (heuristic).
- Symbol ranges depend on ATLAS parsing; files with syntax errors give imprecise ranges (reported as limitations).
- A coverage entry matched only by path suffix is labelled; ambiguous matches become NOT_MEASURED.
- Test linkage needs a clean working tree at head (or an existing ATLAS scan of head in the database); otherwise it is NOT_MEASURED.
- Golden sample SHAs depend on Git producing identical commits across platforms; CI on Windows/macOS had not run these tests when this was written.
- The dashboard does not display verification results yet.

## ATLAS 0.2.0 upgrades and debugging pass (between Prompt 4 and 6)

Prompts 0–4 were re-audited (links, dependency audit, fresh-clone install and check, real-browser look at the dashboard, CI on three operating systems, a store fuzz test).

Fixed or added: import bindings (aliases, namespace/default imports, destructured `require`, Python `as`, Java class imports) so more calls resolve; Python standard-library recognition (list generated from Python 3.13); `core.quotepath=false` so non-ASCII paths survive git; a fuzz test for extractors; a seeded fuzz test comparing the graph store against an in-memory model; dashboard status made truthful; README rewritten to match reality; ADR-0011 updated.

Still open from Prompt 4 (not tackled): tsconfig `paths` aliases, C/C++ include paths from build systems, git rename following and surviving-line ownership, scan-time optimisation above 3000 files, `CALLS` edges from module-level code (needs a core rule change), LICENSE file.

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

## Prompt 4 summary (ATLAS: repository and architecture intelligence)

- `packages/atlas`: repository discovery (excludes, include globs, size/file limits, symlinks never followed), directory/file classification, language detection, tree-sitter extraction for TypeScript, JavaScript, Python, Java, C and C++ (symbols, imports, calls, cyclomatic complexity, entry points, unsupported-construct reporting), import resolution, manifest and framework detection, test-file mapping, circular-dependency detection (runtime vs type-only), hotspots, git history/churn/ownership, incremental scanning with a content-hash cache, atomic idempotent graph writes with retirement of vanished facts, architecture map, module summaries, symbol index, impact map and deterministic JSON export.
- CLI: `orbit scan <path>`, `orbit atlas export`, `orbit atlas impact <file>`.
- `packages/database`: `transaction()`, `offset` paging; migration 0003 (edges hide when an endpoint is retired).
- ADR-0004 accepted (WASM tree-sitter), ADR-0011 added.

Test results (`pnpm run check`, Node 22.23.4, Linux): shared 36, core 66, database 39, graph 14, atlas 89, api 12, cli 14, web 6 = **276 passing**; format, lint, typecheck and build clean.

Real-world checks run here (not unit tests):
- Scanning this repository (59 files): 370 symbols, 85 file imports, 38 package imports, 82 external imports, 675 resolved calls of 4683 call sites, 9 entry points. It reported one import cycle (database index and store) which is `import type` only; after a fix it is classified as type-only rather than runtime. A second scan reused all 59 cached files and wrote nothing.
- Synthetic repository, 3000 TypeScript files: first scan about 16 s, unchanged re-scan about 8 s (profiling found and fixed a 12 s view query in migration 0003).

Bugs found by tests/real scans and fixed in Prompt 4: `requirements.txt` was classified as docs; `export * from` lost its `*`; Java `default:` was counted as a decision; deprecated `setTimeoutMicros` threw; read-only `atlas` commands created an empty database when the path was missing; a slow `edge_current` view; imports of non-code files (CSS/JSON) were counted as unresolved.

Limitations specific to Prompt 4:
- **Call graph is partial and heuristic.** 4008 of 4683 call sites in this repository did not become edges (unresolved, external, or top-level calls, which the rule table cannot represent). Name-only matches carry confidence 0.3-0.4 and `heuristic: true`.
- Not resolved: tsconfig `paths` aliases, build-system include paths for C/C++, Python stdlib vs third-party (reported as external at 0.6), Java classpaths, dynamic imports with non-literal arguments, macros.
- `.h` files are C unless a C parse fails and a C++ parse is cleaner.
- Manifests other than `package.json` are read with text patterns.
- Hotspots and ownership use only the last 500 non-merge commits by default, do not follow renames, and ownership is commit share, not surviving lines. Author names are stored; emails are not.
- Graph writes dominate scan time (seconds at 3000 files); not tested above 3000 files here.
- Windows and macOS were not tested (paths are normalised to POSIX; git and symlink behaviour unconfirmed until CI runs).
- Vendor and generated files are classified but not parsed.
- Impact analysis follows file-level imports; imports of a whole workspace package are reported separately as coarser package-level importers.

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
| `pnpm run build`     | 8/8 tasks pass                           |
| `pnpm run typecheck` | 13/13 tasks pass                         |
| `pnpm run test`      | 356 tests pass (shared 36, core 66, database 43, graph 14, atlas 96, witness 62, api 12, cli 21, web 6) |
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
node apps/cli/dist/index.js scan . --db .orbit/orbit.db   # ATLAS scan of this repo
node apps/cli/dist/index.js atlas export --db .orbit/orbit.db --out atlas.json
node apps/cli/dist/index.js atlas impact packages/core/src/index.ts --db .orbit/orbit.db
node apps/cli/dist/index.js verify --base main --head HEAD --coverage lcov.info --test-report junit.xml --format md
```

## Next step

Prompt 7 (FLARE: CI intelligence and flaky-test detection), unless the user asks to build Prompt 5 (ATLAS memory and MCP) first. Remaining ATLAS limitations are listed above.
