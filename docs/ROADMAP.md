# ORBIT — Roadmap and Task Breakdown

Version: 0.1 · Date: 2026-11-07
Priority: **P0** = needed for first public vertical slice · **P1** = full v1 · **P2** = later.

## 1. Phases and milestones

| Milestone | Deliverable | Prompts |
|---|---|---|
| M1 | Monorepo, Core graph, ATLAS (TS/JS first) | 2, 3, 4 |
| M2 | WITNESS, first Change Passport (git + coverage) | 6, 10 (partial) |
| M3 | FLARE, CAPSULE | 7, 8 |
| M4 | FLIGHT RECORDER (serial + replay) | 9 |
| M5 | Full correlation and Replay Room | 10 |
| M6 | ATLAS memory, MCP, ORBIT AI | 5, 14 |
| M7 | API, CLI, Command Center, GitHub Action | 11, 12, 13 |
| M8 | Security pass, validation, public release | 15, 16, 17 |

The first public version should contain a genuinely working scanner, evidence graph, PR verification and Change Passport. Later engines ship as incremental releases.

## 2. Task breakdown (74 tasks)

### Core infrastructure

| ID | Task | Pri | Prompt |
|---|---|---|---|
| INF-01 | Initialise pnpm workspace and Turborepo with verified current versions | P0 | 2 |
| INF-02 | Strict TypeScript, ESLint, Prettier, shared tsconfig | P0 | 2 |
| INF-03 | Shared errors, structured logging, config/env loader | P0 | 2 |
| INF-04 | SQLite connection, Drizzle schema, migration runner | P0 | 2–3 |
| INF-05 | Core node/edge/evidence repositories with invalid-relationship checks | P0 | 3 |
| INF-06 | Immutable hash-chained ledger and SHA-256 evidence hashing | P0 | 3 |

### ATLAS

| ID | Task | Pri | Prompt |
|---|---|---|---|
| ATL-01 | Repository registration, scan scope and exclusions | P0 | 4 |
| ATL-02 | Language, framework and dependency detection | P0 | 4 |
| ATL-03 | tree-sitter parser interface; TS/JS implementation | P0 | 4 |
| ATL-04 | Symbol, import and call extraction with location and confidence | P0 | 4 |
| ATL-05 | Architecture/dependency graph, cycles, hotspots, entry points, test mapping | P1 | 4 |
| ATL-06 | Git history indexing, ownership, incremental re-index with cache invalidation | P1 | 4 |
| ATL-07 | Python, Java, C, C++ parsers | P1 | 4 |

### WITNESS

| ID | Task | Pri | Prompt |
|---|---|---|---|
| WIT-01 | Base/head git diff parser (hunks, renames, binaries) | P0 | 6 |
| WIT-02 | LCOV adapter and Cobertura adapter behind a `CoverageAdapter` interface | P0 | 6 |
| WIT-03 | Changed-line coverage calculation and statuses (PASS/FAIL/PARTIAL/NOT_MEASURED/INCOMPLETE) | P0 | 6 |
| WIT-04 | Deterministic finding rules with stable IDs; sensitive-file detection | P0 | 6 |
| WIT-05 | Regression comparison vs. base coverage; changed-symbol and related-test mapping | P1 | 6 |
| WIT-06 | Markdown, JSON and SARIF 2.1.0 renderers | P0 | 6 |

### FLARE

| ID | Task | Pri | Prompt |
|---|---|---|---|
| FLA-01 | Test-report adapters: JUnit XML, pytest, Jest, Go test JSON | P1 | 7 |
| FLA-02 | Historical test-result store | P1 | 7 |
| FLA-03 | Flip detection, Wilson intervals, minimum-sample gating | P1 | 7 |
| FLA-04 | Failure clustering, duration trends, slow-test ranking | P1 | 7 |
| FLA-05 | Fixture datasets with reliable and deliberately flaky tests | P1 | 7 |

### CAPSULE

| ID | Task | Pri | Prompt |
|---|---|---|---|
| CAP-01 | Detect package managers, lockfiles, runtimes, toolchains, build/test commands | P1 | 8 |
| CAP-02 | Detect Docker, dev container and Nix configs; env variable names only | P1 | 8 |
| CAP-03 | Environment fingerprint and manifest generation | P1 | 8 |
| CAP-04 | Manifest comparison and reproduction guide | P1 | 8 |
| CAP-05 | Approved, isolated replay capturing stdout/stderr/exit status as evidence | P2 | 8 |

### FLIGHT RECORDER

| ID | Task | Pri | Prompt |
|---|---|---|---|
| FLR-01 | Transport interface; file replay transport (CSV/JSON/NDJSON/key-value) | P1 | 9 |
| FLR-02 | Configurable telemetry parser and typed metrics/events | P1 | 9 |
| FLR-03 | Session store, raw-artifact hashing, firmware build/commit linkage | P1 | 9 |
| FLR-04 | USB serial transport with explicit approval, read-only | P1 | 9 |
| FLR-05 | Anomaly rules, boot/reset/watchdog detection, crash inspector | P1 | 9 |
| FLR-06 | Synthetic ESP32/STM32 demo sessions labelled DEMO; CSV/JSON export | P1 | 9 |

### Evidence engine

| ID | Task | Pri | Prompt |
|---|---|---|---|
| EVI-01 | Cross-engine correlation queries over the graph | P0 | 10 |
| EVI-02 | Rule-based completeness assessment (no composite score) | P0 | 10 |
| EVI-03 | Immutable, canonical, versioned Change Passport assembly | P0 | 10 |
| EVI-04 | Replay Room backend: passport compare, timeline, reproduction plan | P1 | 10 |

### MCP and AI

| ID | Task | Pri | Prompt |
|---|---|---|---|
| MCP-01 | Memory engine: create/search/update/invalidate with sources and versions | P1 | 5 |
| MCP-02 | ADR/doc import; staleness and conflicting-decision detection | P1 | 5 |
| MCP-03 | Read-only MCP server with 12 tools, validated inputs, bounded output | P1 | 5 |
| AI-01 | Provider adapters: Anthropic, OpenAI-compatible, Ollama | P2 | 14 |
| AI-02 | Specialist agent roles with bounded retrieval and citation checks | P2 | 14 |
| AI-03 | Orchestration with human approval, token budgeting, caching, rate-limit handling | P2 | 14 |

### API and CLI

| ID | Task | Pri | Prompt |
|---|---|---|---|
| API-01 | Fastify local API bound to loopback with session token | P0 | 11 |
| API-02 | Endpoints: repos, indexing, graph, evidence, passports, reports | P0 | 11 |
| API-03 | Ingestion endpoints: CI results, environment snapshots, device sessions | P1 | 11 |
| CLI-01 | Commander CLI: init, scan, status, graph, impact, verify, passport | P0 | 11 |
| CLI-02 | Remaining commands (ci ingest, tests history, capsule, device, mcp start, doctor); JSON mode; exit codes | P1 | 11 |

### Dashboard

| ID | Task | Pri | Prompt |
|---|---|---|---|
| DSH-01 | Vite/React/Tailwind shell, theme tokens, navigation, state components | P1 | 12 |
| DSH-02 | Overview and Engineering Graph views | P1 | 12 |
| DSH-03 | ATLAS and WITNESS views | P1 | 12 |
| DSH-04 | FLARE and CAPSULE views | P1 | 12 |
| DSH-05 | FLIGHT RECORDER, Change Passport and Replay Room views | P1 | 12 |
| DSH-06 | Evidence Explorer, MCP & AI, Integrations, Settings; DEMO workspace | P1 | 12 |

### GitHub integration

| ID | Task | Pri | Prompt |
|---|---|---|---|
| GH-01 | Action metadata and runtime; read coverage/test artifacts | P0 | 13 |
| GH-02 | Single upserted PR comment; annotations; SARIF upload | P0 | 13 |
| GH-03 | Fork-safe, least-privilege workflow examples | P0 | 13 |
| GH-04 | Sample repositories and integration guides (Action, local CLI, Claude Code via MCP, existing CI) | P1 | 13 |

### Security

| ID | Task | Pri | Prompt |
|---|---|---|---|
| SEC-01 | Central path-safe resolver, size/depth limits, safe XML | P0 | 3, 15 |
| SEC-02 | Redaction, secret-pattern scanning, credential handling | P1 | 15 |
| SEC-03 | Security regression suite; SECURITY.md, privacy policy | P1 | 15 |

### Testing

| ID | Task | Pri | Prompt |
|---|---|---|---|
| TST-01 | Vitest infrastructure and per-package contract tests | P0 | 2 |
| TST-02 | Fixture repository (TS + Python + C/C++ firmware) | P0 | 16 |
| TST-03 | Ten controlled scenarios with expected results (S1–S10) | P1 | 16 |
| TST-04 | Playwright e2e and reproducible benchmarks | P1 | 16 |

### Documentation and releases

| ID | Task | Pri | Prompt |
|---|---|---|---|
| DOC-01 | Keep ORBIT_BUILD_STATE.md and ADRs current after each phase | P0 | all |
| DOC-02 | README, quick-start, first scan and first passport walkthroughs | P1 | 17 |
| DOC-03 | Hardware setup, MCP, GitHub Action, troubleshooting and FAQ guides | P1 | 17 |
| DOC-04 | Verify unverified competitors; refresh COMPETITIVE_ANALYSIS.md | P0 | 1 |
| REL-01 | Check name availability (GitHub, npm, domains, trademarks) | P0 | 1 |
| REL-02 | LICENSE (Apache-2.0), CONTRIBUTING, CODE_OF_CONDUCT, CITATION, issue templates | P1 | 17 |
| REL-03 | Release workflows, versioning, changelog; publish only on explicit instruction | P1 | 17 |

## 3. MCP tools (ATL/MCP-03)

orbit_repository_map, orbit_search_symbols, orbit_get_symbol, orbit_get_callers, orbit_get_callees, orbit_analyze_impact, orbit_find_related_tests, orbit_search_history, orbit_search_memory, orbit_get_architecture, orbit_get_change_context, orbit_get_evidence.

## 4. Flagship demo storyline

**Scenario:** a developer changes an ESP32 sensor-communication module.

1. **ATLAS** detects the changed function and maps its dependents and related tests.
2. **WITNESS** finds uncovered changed lines and missing test evidence.
3. **FLARE** shows one failing test has an unreliable history (with sample size and interval, labelled suspected or confirmed).
4. **CAPSULE** compares the recorded toolchain/dependencies with the current environment and lists the mismatch.
5. **FLIGHT RECORDER** imports a telemetry session (DEMO-labelled unless a real device was used) containing a watchdog reset, linked by firmware build ID and commit.
6. **Evidence Engine** correlates commit, build and session.
7. **Change Passport** states what happened, what is verified, what is unknown, and what to investigate next.

If no real hardware is available, the demo says so on screen and never presents synthetic telemetry as real.

## 5. Acceptance workflow

Register a repository → index → generate graph → inspect a change → identify impacted modules and tests → ingest real test and coverage reports → detect the flaky-test scenario → inspect the environment → generate a Change Passport → record or import a telemetry session and link it → view everything in the Command Center → export the passport → retrieve context through MCP. Unavailable optional integrations are reported as unavailable.

## 6. Out of scope for v1

Device commands, hosted SaaS, GitHub App, mutation testing, per-test coverage tracing, automatic code modification.


### WITNESS / FLARE / CAPSULE extension scope (Prompts 6–8)

The first prototype remains in `@orbit/atlas` while the core contracts are stabilising. The following additions are implemented on `feat/prompts-6-8-completion`; they are not considered release-complete until the branch CI and integrated acceptance tests pass.

| ID | Prompt | Extension | Status |
|---|---:|---|---|
| WIT-07 | 6 | Path-name-only sensitive-file findings with explicit non-content-inspection limitation | Implemented; CI pending |
| WIT-08 | 6 | Baseline/candidate coverage comparison with exact-path regression states | Implemented; CI pending |
| WIT-09 | 6 | Changed-symbol / related-test context from caller-supplied ATLAS references | Implemented; CI pending |
| WIT-10 | 6 | Markdown and SARIF 2.1.0 report renderers | Implemented; CI pending |
| FLA-06 | 7 | pytest JSON, Jest JSON and Go test JSON adapters | Implemented; CI pending |
| FLA-07 | 7 | Failure-signature clustering and slow-test duration summaries | Implemented; CI pending |
| FLA-08 | 7 | Multi-report CLI analysis with minimum-sample/flip gates | Implemented; CI pending |
| CAP-06 | 8 | asdf/Rust/Python toolchain and requirements manifest inspection | Implemented; CI pending |
| CAP-07 | 8 | Docker/devcontainer image and workspace signal inspection | Implemented; CI pending |
| CAP-08 | 8 | Extended deterministic manifest fingerprint and bounded inspection CLI | Implemented; CI pending |

The FLARE CLI combines report files supplied to one invocation; durable historical persistence remains a separate outstanding task. CAPSULE reads declarations only and never executes tools or represents a manifest snapshot as proof of the running environment. WITNESS path warnings use filenames only and are not a secret-scanning guarantee.
