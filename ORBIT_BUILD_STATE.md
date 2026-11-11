# ORBIT — Build State

Durable progress log. Update after every implementation phase.
Last updated: 2026-11-10

## Current phase

**Engineering roadmap Prompts 0–10 and App Business Module sub-prompts 0–4 are on `main` (PRs #5 and #9). Branch `integration/witness-and-atlas-0.2` adds the git-based WITNESS package (`packages/witness`) and ATLAS 0.2.0 improvements on top of that `main`; it is verified locally and awaiting review and CI. Prompt 11 API/CLI is in `feat/prompt-11-api-cli` (PR #11, not merged).**

## Phase checklist

| Prompt | Scope                                          | Status                                         |
| ------ | ---------------------------------------------- | ---------------------------------------------- |
| 0      | Master plan and planning documents             | Done (docs only)                               |
| 1      | Technical design and architecture finalisation | Done (docs, versions verified)                 |
| 2      | Monorepo foundation                            | Done (see results below)                       |
| 3      | ORBIT Core graph                               | Done on `main` (see results below)           |
| 4      | ATLAS scanning                                 | Done (see results below)                       |
| 5      | ATLAS memory and MCP                           | Implemented on `main` via PR #5; CI run #109 passed on Ubuntu, macOS and Windows |
| 6      | WITNESS                                        | Prototype on `main` via PR #5; **full git-based verifier in `packages/witness` on the integration branch** (see Prompt 6 section) |
| 7      | FLARE                                          | Merged to `main` via PR #5: pytest/Jest/Go adapters and reliability analytics/CLI; durable history remains outstanding |
| 8      | CAPSULE                                        | Merged to `main` via PR #5: polyglot manifest inspection and CLI; build replay remains out of scope |
| 9      | FLIGHT RECORDER                                | Merged to `main` via PR #5: recorded-log analysis + hash-verified graph persistence; no physical serial connection |
| 10     | Change Passport and Replay Room                | Merged to `main` via PR #5: commit-scoped evidence correlation, immutable history, comparison and non-executing reproduction plan; no visual Replay Room UI |
| 11     | API and CLI (full)                             | Partial: local engine CLI commands on feature branch |
| 12     | Command Center (full)                          | Not started (shell exists)                     |
| 13     | GitHub Action                                  | Not started                                    |
| 14     | ORBIT AI                                       | Not implemented; provider/privacy design in `docs/AI_PROVIDER_POLICY.md` |
| 15     | Security review                                | Partial: SECURITY.md, privacy policy, CodeQL workflow and Dependabot config added; independent review and security tests pending |
| 16     | Testing and validation                         | Partial: existing unit/API/CLI tests plus validation-gap checklist; browser E2E, fuzz, migration and action tests pending |
| 17     | Release polish                                 | Partial: contributor docs, Apache-2.0 license, citation metadata, issue templates and release checklist added; clean-machine validation and release approval pending |


## Cross-engine implementation merged via PR #5

Engineering Prompts 5–10 were consolidated and merged into main through PR #5 on 2026-11-08. The sections below describe that merged implementation and preserve its remaining limitations.

- WITNESS: unified-diff added-line parsing, LCOV and Cobertura line-coverage adapters, changed-line coverage summaries, deterministic finding IDs and explicit status semantics.
- FLARE: bounded JUnit XML parser and supplied-history test summaries using outcome flips and Wilson 95% intervals. Jest/pytest/Go adapters were added in the Prompt 7 extension below; a durable history store across separate invocations remains outstanding.
- CAPSULE: inspect supplied manifest files for declared runtimes, package managers, scripts, dependencies, environment variable names, container manifests and lockfile hashes. No build replay.
- FLIGHT RECORDER: parse recorded JSON, NDJSON, CSV and key-value telemetry files; hash raw input and identify keyword-based watchdog/reset events. No serial-port connection or device commands.
- Change Passport: deterministic, content-hashed assembly from explicitly supplied evidence, with missing evidence listed. No graph persistence or Replay Room.
- CLI: orbit verify, orbit flare summarize, orbit capsule inspect/compare, orbit device replay and orbit passport create.
- CLI and engine tests have been added. Consolidated PR #5 passed `pnpm run check` on Ubuntu, macOS and Windows (run `42477639701`, 2026-11-08): 316 tests passed, with formatting, lint, typecheck and builds successful.

Known prototype limitations:

- Engine modules are temporarily colocated in @orbit/atlas rather than split into independent packages.
- Verification currently analyses added lines in unified-diff hunks and supports LCOV/Cobertura only.
- Test reliability requires multiple historical CI runs; a single JUnit report cannot establish flaky behaviour.
- Environment snapshots describe supplied manifests, not the actual OS image or installed dependency tree.
- Telemetry analysis works on recorded files only; physical ESP32/STM32 serial capture is unimplemented.
- Change Passport requires a user-supplied evidence JSON bundle; graph correlation and replay UI remain future work.

## Audit and fixes of `main` (2026-11-11, branch `integration/witness-and-atlas-0.2`)

`main` (373 tests) was reviewed after other sessions added Prompts 5–10 and the API. Defects found by running adversarial inputs, then fixed with regression tests:

| Area | Defect | Fix |
| --- | --- | --- |
| API auth | **Authentication bypass**: the check was `url.startsWith('/api/v1/')`, but the router decodes `%`-escapes, so `GET /%61pi/v1/repositories` returned data with no token | Auth now keys on the route the router matched; only `/health` and unmatched (404) requests skip it |
| API errors | Bad JSON, bad test report, bad telemetry, bad passport body returned 500 or `INTERNAL`; empty JUnit report was stored as **PASS** | Parse failures are 400 `INVALID_INPUT`; a report with zero test cases is rejected; `units` validated; engine validation errors are `OrbitError('INVALID_INPUT')` |
| Diff parser | Added line `+++x` was dropped and shifted every later line number; removed lines starting `--` looked like headers | Hunk bodies are consumed using the `@@` line counts |
| Cobertura / JUnit parsers | Regex parsing: self-closing `<class/>` swallowed the next class; `>` in attributes, XML comments and CDATA produced ghost or missing test cases (a commented-out failing test was reported as failed) | Both parsers now use a strict XML reader (no DTD/entities, depth and size limits); malformed XML is an error instead of an empty result |
| Telemetry | Numbers/strings like `1` became 1970 or machine-time-zone dates | Only ISO-8601 strings and plausible epoch seconds/ms are timestamps; others stay `null` |
| MCP | `orbit_search_memory` failed with the 48 KiB cap on ordinary data; history returned only the oldest records; abbreviated/upper-case SHAs found nothing; unbounded cycle and module lists; unbounded integrity problem list; DB not closed when the transport closed | Content truncated at 500 chars with a flag; newest-first history with totals; SHA prefix and case handling; lists capped with totals; integrity problems capped; DB closed on transport close |

Not changed (reported only): read-only open of a WAL database creates `-wal`/`-shm` files (SQLite behaviour); a malformed JSON line on MCP stdin gets no `-32700` reply (SDK behaviour); `orbit_analyze_impact` output is still bounded only by the response cap; the FLARE/CAPSULE/telemetry-persistence modules were only spot-checked (a full audit pass was interrupted by a usage limit and is still open).

## Prompt 5 summary (ATLAS persistent memory + read-only MCP)

- `packages/atlas/src/memory.ts`: validated memory records stored as versioned `Decision` / `Documentation` graph nodes with deterministic SHA-256 evidence; lexical search; append-only updates; tombstone invalidation; Markdown/ADR import; explicit `Supersedes` edges and declared-conflict notices; source freshness only when callers provide current hashes.
- Memory is deliberately contextual (`NOT_MEASURED`), not a correctness or test signal. Missing source hashes produce `unknown`; changed hashes produce `stale`. Contradictions are not inferred by an AI model: only source-authored `Conflicts with` metadata is flagged. Supersedes edges are added only when the referenced memory node has the same graph type.
- `packages/mcp`: stdio MCP server with 12 read-only tools for repository map, symbol search/detail, callers/callees, impact, related tests, indexed history, memory search, architecture, change context and evidence retrieval. Responses are capped at 48 KiB; list/search inputs are bounded.
- SQLite `openDatabase({ readonly: true })` uses the driver's read-only + file-exists flags, skips directory creation and migrations, and rejects writes at the database connection layer. MCP has no graph mutation, shell, file-write, network-fetch or device-control tool.
- CLI entry point: `orbit mcp start --db <existing-db> [--repo <repository-key>]`. ADR-0012 documents the boundary and trade-offs.
- Local validation on Linux / Node 22: `pnpm run check` passed (format, lint, all workspace typechecks, tests and builds). Counts: shared 36, core 66, database 41, graph 14, atlas 104, api 12, cli 19, web 6 and MCP 2 = **300 tests**. A clean standalone MCP build and source test run also passed (2/2 tests).

Known Prompt 5 limitations:

- Memory ranking is deterministic lexical matching, not embeddings, semantic retrieval or an LLM assistant.
- Staleness is evaluated against a caller-supplied hash manifest; ORBIT does not yet run a background document watcher.
- Conflict detection is limited to explicit document metadata. Semantic contradictions and unreferenced decisions require human review.
- MCP reads only data already present in the local ORBIT database. The server does not index the repository or create/migrate a database when launched.
- MCP transport currently supports stdio only; remote HTTP transport, authentication and hosted multi-tenant operation are not included.

## Prompt 6 summary (WITNESS: git-based PR verification, `packages/witness`)

- `packages/witness`: Git diff (merge base to head, `--unified=0`) to exact changed head lines (added / modified / deletion-only, renames, binary); changed-file classification (ATLAS classifier); changed-symbol mapping from ATLAS extraction of the file *at head*; LCOV and Cobertura XML parsers; JUnit XML parser; changed-line coverage (covered / uncovered / non-executable) that never infers from file coverage; per-symbol coverage; regression comparison (base vs head coverage per file, base vs head test results); test linkage via ATLAS static facts (direct vs indirect); sensitive-file rules; relevant ADRs by textual mention; findings with stable IDs (`WIT-<RULE>-<hash>`), severity, explanation, location, evidence and suggested action; Markdown, JSON and SARIF 2.1.0 renderers; opt-in graph recording (`--record`: evidence per input + `Finding` nodes + `AFFECTS` edges).
- CLI (git mode of `orbit verify`): `--base --head [--repo --coverage --base-coverage --test-report --base-test-report --build-result --coverage-commit --min-coverage --format md|json|sarif --out --force --record --key --db --fail-on PARTIAL|INCOMPLETE|FAIL]`. New exit code 6 (`VERIFICATION_FAILED`). `--out` refuses to overwrite without `--force`.
- Status rules and design: ADR-0016. The earlier coverage-only prototype in `@orbit/atlas` (`verifyChangedLineCoverage`, diff-file mode of `orbit verify`) is kept for compatibility; `orbit verify` now has two modes (diff-file, or `--base/--head` git mode).
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
- The consolidated PR #5 CI matrix now passes on Windows and macOS as well as Linux. Real-world scanner performance and filesystem-specific behaviour have not been separately benchmarked on those operating systems.
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
| `pnpm run test`      | 499 tests pass (shared 36, core 66, database 45, graph 14, atlas 164, mcp 5, witness 62, api 39, cli 41, web 27) |
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
2. **Merged engineering CI has passed.** GitHub Actions run #109 passed the full repository check on Ubuntu, macOS and Windows before PR #5 was merged. The merge does not mean the prototype is release-ready.
3. A fresh-clone install was tested locally only (see below).
4. Competitor claims for CodeGraph, CodeCortex, Chisel and PatchProof remain unverified (`docs/COMPETITIVE_ANALYSIS.md`).
5. Project name availability (GitHub, npm, domains, trademarks) not checked.
6. No `LICENSE` file yet (Apache-2.0 targeted).
7. Repository moved/renamed: GitHub reports the canonical URL as `claudeee617-hue/New-Orbit-`; the session's remote uses the lowercase form, which redirects.
8. MCP SDK 1.32.2 is installed and used by the Prompt 5 stdio server on main; only local stdio transport is implemented.

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

Next engineering work: complete the remaining Prompt 11–17 roadmap gates, especially API/CLI depth, full Command Center UX, security review, broader validation and release polish. Physical serial capture remains a separately scoped future capability.


## Prompt 6–8 extension work merged via PR #5 (CI passed)

This implementation was consolidated from the `feat/orbit-evidence-engines` base and `feat/prompts-6-8-completion`, then merged to `main` in PR #5.

### Prompt 6 — WITNESS extensions

- Added `packages/atlas/src/witness-extended.ts`:
  - path-name-only sensitive-file findings for common credential-bearing filenames (no content inspection);
  - exact-path baseline/candidate coverage comparison with REGRESSION / IMPROVED / UNCHANGED / NOT_COMPARABLE;
  - caller-supplied changed-symbol and related-test mapping with explicit limitations;
  - Markdown and SARIF 2.1.0 renderers with stable finding fingerprints.
- Existing added-line unified-diff parser, LCOV/Cobertura adapters and changed-line coverage summary remain the first verification layer.
- CLI adds `orbit witness coverage-compare` and `orbit witness sensitive-paths`.

### Prompt 7 — FLARE extensions

- Added `packages/atlas/src/flare-extended.ts`:
  - bounded JSON adapters for pytest-json-report, Jest JSON and Go `go test -json` event streams;
  - failure-message clustering using normalized signatures;
  - slow-test mean, p95 and maximum durations;
  - test reliability history with existing minimum-sample / pass-fail-flip / Wilson-interval classification.
- CLI adds `orbit flare analyse <reports...> --format junit|pytest-json|jest-json|go-json`.
- The CLI combines the report files supplied in one invocation. A durable, multi-run database history store and historical run ingestion remain outstanding.

### Prompt 8 — CAPSULE extensions

- Added `packages/atlas/src/capsule-extended.ts`:
  - asdf `.tool-versions`, Rust toolchain, Python requirements, common pyproject dependency declarations;
  - Dockerfile image references, devcontainer images/features and workspace signals (pnpm, Turbo, Nx, Lerna, Cargo and Go workspaces);
  - deterministic extended fingerprint and explicit parser limitations.
- CLI adds `orbit capsule inspect-extended <repository>`; it inspects a bounded set of manifest files, never executes package managers or build commands, never reads `.env` secret files, and reports its manifest-only mode.

### Tests added and verified by CI

- `packages/atlas/src/engines-extended.test.ts`: WITNESS regression/SARIF/sensitive paths, FLARE adapters/analytics, CAPSULE polyglot manifests and limits.
- `apps/cli/src/advanced-engines.test.ts`: regression comparison, path findings, multi-report reliability analysis, and manifest-only environment inspection.
- Existing baseline engine tests remain in place.

### Remaining limitations / release gates

- Extended modules currently live in `@orbit/atlas` for compatibility with the in-progress prototype; a later refactor may split WITNESS, FLARE and CAPSULE into independent packages once contracts stabilise.
- Sensitive-path findings are name-based warnings only; no secret scanning of file contents is claimed.
- Coverage regression compares supplied coverage maps for exact paths; it does not attribute coverage to individual tests.
- pytest/Jest/Go adapters cover common JSON report forms, not every framework/version variation.
- Failure clustering is heuristic text normalization; duration comparisons do not normalize runner hardware.
- Capsule fingerprints represent supplied manifest declarations, not actual installed dependencies, container digests or the running OS.
- CI verification: GitHub Actions run `42477639701` passed on Ubuntu, macOS and Windows. The workflow's `pnpm run check` completed format, lint, typecheck, all 316 tests and builds successfully. This does not substitute for product acceptance review or the remaining roadmap gates.


## Prompt 9 summary (FLIGHT RECORDER — recorded telemetry)

- packages/atlas/src/flight-recorder.ts: bounded JSON, NDJSON, CSV and key-value parsing; normalized event categories; SHA-256 of exact input bytes; raw lines are not copied into parsed output.
- packages/atlas/src/flight-recorder-extended.ts: typed metric analysis, explicit units, explicit threshold rules, stable watchdog/reset/threshold findings and aggregate min/max/mean statistics.
- packages/atlas/src/telemetry-store.ts: re-reads a repository-local artifact, resolves its real path under the selected root, checks the raw SHA-256 and writes immutable TelemetrySession evidence/node plus optional device/firmware/commit graph links atomically.
- CLI: orbit device replay accepts units/thresholds; optional persistence requires the DB, repo root and repo-relative artifact path. orbit device serial-status reports that physical serial transport is unavailable.
- Synthetic ESP32 and STM32 fixtures are clearly labelled DEMO.
- Boundaries: 10 MiB, at most 100,000 records, at most 200 threshold rules; no USB serial connection, live stream or hardware command support.

## Prompt 10 summary (Change Passport + Replay Room backend)

- packages/atlas/src/passport.ts: strict input validation, canonical content hash, rule-based completeness dimensions, explicit verificationStatus and no aggregate score.
- packages/atlas/src/passport-engine.ts: only exact-commit immutable evidence is correlated; bounded import-impact/related-test graph context; graph-backed versioned ChangePassport node; atomic evidence/node/edge transaction; history and comparisons; human-run reproduction plan.
- CLI: orbit passport create --db --repo, history, compare and plan. Plans mark all steps automaticExecution false.
- Remaining work: visual Replay Room, user-configurable completeness policy, richer UI timeline and live hardware transport; these are not claimed as implemented.

## Prompt 9–10 CI status

Verified by GitHub Actions run `42481493312` on Ubuntu, macOS and Windows; the engineering branch recorded 331 passing tests plus format, lint, typecheck and build. The changes were merged into `main` through PR #5.

## Final Prompt 0–10 integrated state

- Engineering Prompts 0–10 are merged into `main` through the engineering implementation and verification path.
- The separate App Business Module Prompts 0–4 are also merged into `main` through PR #9.
- Final main-head validation is performed by the latest `main` push-CI after the Business Module merge. All three OS jobs passed in run `42482443566`.
- Business and engineering layers remain separated: business UI uses local planning state and does not add billing, hosted customer data, CRM, payment processing or live accounting.
- The repository still has no `LICENSE` file, so the project should not be described as currently licensed open source until that file is added.

## App Business Module sub-prompts 0–4 (separate from engineering roadmap)

**Status:** Merged into `main` through PR #9 on 2026-11-08; GitHub Actions run #113 passed on Ubuntu, macOS and Windows.

- **Business Prompt 0 — Research:** source-linked vendor pricing references, customer segments, beachhead and evidence-led assumptions.
- **Business Prompt 1 — Business model:** hybrid Community / Team / Enterprise / Embedded packaging with proposed paid prices labelled as hypotheses or future offers.
- **Business Prompt 2 — Data contract:** typed strategy model, offer maturity, customer segments, research references, gated roadmap, unmeasured KPIs and privacy guardrails.
- **Business Prompt 3 — Command Center:** accessible Overview / Business navigation and Business strategy / market-research view.
- **Business Prompt 4 — Business Intelligence:** local-only actual-vs-forecast inputs, profit/margin calculations, customer counts, INR/USD display formatting, pricing / unit-economics simulator and break-even seats.
- No live accounting, billing, checkout, CRM, customer database, hosted sync or payment integration. Financial inputs remain in local React state and are discarded after refresh. No demo revenue/customer data is seeded.


## Prompt 11 — Local API and CLI (in progress on feat/prompt-11-api-cli)

- Added persistent local API Bearer session-token support. The token is random, stored beside the workspace database in a private `api.token` file, and never returned in API responses or logs. `ORBIT_API_TOKEN` can override the file token.
- Added authenticated repository, scan, graph, evidence, Change Passport, impact/ATLAS report and CI/test/environment/recorded-telemetry ingestion routes under `/api/v1`. Public `/health` and Host-header/DNS-rebinding protection remain.
- API ingestion uses bounded inputs and allowlisted CI summary/environment metadata; it does not persist arbitrary credential fields or raw test/telemetry report bodies as graph attributes.
- Added CLI `init`, `doctor`, `graph summary`, `graph nodes`, `ci ingest`, `tests ingest` and `tests history` commands.
- Added API token lifecycle, API route/integration and CLI workspace/ingestion tests.
- **Status:** Implementation pushed in PR #11; full format/lint/typecheck/test/build matrix passed on Ubuntu, macOS and Windows in GitHub Actions run #136. Ubuntu reported 373 passing tests across nine workspace suites; 15/15 typecheck tasks and 9/9 build tasks passed. PR #11 is ready for review and is not merged.


## Prompts 14–17 documentation and security groundwork

Branch: `docs/prompt-15-17-security-release`.

- Prompt 14: provider/privacy policy documented in `docs/AI_PROVIDER_POLICY.md`. No provider adapter or AI UI has been implemented; AI remains unavailable and must not be described as shipped.
- Prompt 15: `SECURITY.md`, `docs/PRIVACY.md`, scheduled CodeQL workflow and Dependabot configuration added. This is groundwork, not an independent security audit. Parser/path/XXE/secret-redaction tests and host/CSRF review remain.
- Prompt 16: `docs/VALIDATION_GAPS.md` records outstanding E2E, fuzz, migration, action and controlled-scenario tests. Existing CI and unit/API/CLI tests do not close those gaps.
- Prompt 17: Apache-2.0 license text, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CITATION.cff`, issue templates and `docs/RELEASE_CHECKLIST.md` added. No package or Marketplace release has been published.

All these changes require CI and owner/legal review before merge. ORBIT's working codename and package/repository names have not been trademark-cleared.
