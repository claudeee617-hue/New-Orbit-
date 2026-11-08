# ORBIT — Master Plan

**ORBIT — Engineering Intelligence Platform**
Tagline: *Understand Everything. Trace Every Change. Prove What Works.*
Philosophy: **Evidence before confidence.**
Status: Active development. Prompts 0–4 complete; Prompt 5 is next (see `ORBIT_BUILD_STATE.md`).
Date: 2026-11-07

> "ORBIT" is a working codename, not a cleared brand. Before any public release, check GitHub, npm, domains and trademarks (task REL-01).

---

## 1. What ORBIT is

ORBIT treats a software repository as a living engineering system rather than a pile of source files. It connects code, history, tests, CI, environments, builds and (for embedded projects) real device telemetry into one evidence graph, and produces a **Change Passport** for every important change: a record of what changed, what it affected, how it was tested, where it was built and what happened when it ran, with every claim linked to a real artifact.

It is local-first, works with no AI API key, and never fabricates a test result, build, measurement or confidence number.

## 2. The five engines plus the core

| Component | Role | One-line purpose |
|---|---|---|
| ORBIT CORE | Living Engineering Graph | Nodes, edges, evidence ledger, provenance, hashing |
| ATLAS | Codebase intelligence | Scan, symbols, dependencies, architecture map, decision memory |
| WITNESS | PR verification | Diff analysis, changed-line coverage, regression, findings |
| FLARE | CI intelligence | Test history, flakiness statistics, failure clusters |
| CAPSULE | Environments | Detect, fingerprint, compare and (with approval) replay environments |
| FLIGHT RECORDER | Embedded telemetry | Read-only serial/file telemetry capture, sessions, playback |
| Evidence Engine | Correlation | Joins evidence across engines, assesses completeness |
| ORBIT AI | Optional analysis | Provider-agnostic specialist agents that cite evidence |
| Command Center | UI | Dashboard, graph explorer, Passport viewer, Replay Room |
| MCP server | Agent access | Read-only tools so Claude Code and others can query ORBIT |

## 3. Non-negotiable principles

1. No fake functionality, integrations or metrics. Synthetic data is always labelled DEMO.
2. Core works with zero network and zero API keys. AI is optional.
3. Every claim points to evidence (source, hash, location). Missing evidence is reported, never filled in.
4. Never execute untrusted repository code automatically. Execution requires explicit approval.
5. Hardware access is read-only and requires local approval. Device commands are off by default.
6. Preserve history: evidence is append-only; corrections create new records.
7. No arbitrary "risk score" or "confidence percentage". Completeness is rule-based and explained.
8. No claim that ORBIT is unique without evidence (see `docs/COMPETITIVE_ANALYSIS.md`).

## 4. Delivery strategy

Ship a working vertical slice early instead of five half-built prototypes.

| Milestone | Deliverable | Prompts |
|---|---|---|
| M1 | Monorepo, Core graph, ATLAS (TS/JS first) | 2, 3, 4 |
| M2 | WITNESS, first Change Passport (git + coverage only) | 6, 10 (partial) |
| M3 | FLARE, CAPSULE | 7, 8 |
| M4 | FLIGHT RECORDER (serial + replay) | 9 |
| M5 | Full cross-engine correlation, Replay Room | 10 |
| M6 | ATLAS memory, MCP, ORBIT AI | 5, 14 |
| M7 | API, CLI, Command Center, GitHub Action | 11, 12, 13 |
| M8 | Security pass, validation, public release | 15, 16, 17 |

Rule: do not start a milestone while the previous one has unresolved critical failures or failing tests.

## 5. Planning documents

| Document | Purpose |
|---|---|
| `ORBIT_BUILD_STATE.md` | Durable progress log, updated after every phase |
| `docs/PRD.md` | Users, problems, requirements, non-goals |
| `docs/ARCHITECTURE.md` | Modules, interfaces, technology choices, diagrams |
| `docs/DATA_MODEL.md` | Graph schema, evidence record, passport schema |
| `docs/ROADMAP.md` | 50–80 task breakdown, phases, demo storyline |
| `docs/COMPETITIVE_ANALYSIS.md` | Researched competitors and honest differentiation |
| `docs/THREAT_MODEL.md` | Assets, threats, mitigations |
| `docs/UX_SPECIFICATION.md` | Command Center design and states |
| `docs/TEST_STRATEGY.md` | Test layers, fixtures, scenarios, benchmarks |
| `docs/DECISIONS/` | Architecture decision records |

## 6. Hybrid business strategy

ORBIT follows a local-first open-source core with paid Team and Enterprise services. Community must remain useful offline: local scanning, graph/evidence inspection, deterministic Change Passport exports and local developer interfaces must not require an account or cloud entitlement. Team monetizes shared workspaces, collaboration, policy, managed integrations and optional coordination. Enterprise adds identity, governance, private deployment, audit and support commitments.

The first market to validate is embedded/IoT engineering teams, because their change-verification workflow can link source, build/environment evidence and real device telemetry. This is a hypothesis to test with design partners, not a proven market position.

The hosted control plane is optional. Source code and raw evidence remain local by default; any metadata synchronisation must be explicitly configured, minimised, documented and customer-controlled. Billing and entitlements belong at the service boundary, never inside analysis engines. Do not build cloud/billing infrastructure until a working Community vertical slice and customer validation justify it.

The planned Apache-2.0 licence is not yet final or granted because the repository has no LICENSE file. If Apache-2.0 is selected, the commercial moat must be service quality, collaboration, enterprise operations, integrations, brand and support—not exclusive rights over the Community code. Obtain legal review before publishing licensing, contribution, privacy or commercial terms.

The detailed packaging, three-plane architecture, licensing guardrails, go-to-market gates and success metrics are in [docs/COMMERCIALIZATION_STRATEGY.md](docs/COMMERCIALIZATION_STRATEGY.md).

## 7. Top risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Scope explosion | Five engines plus UI plus AI is very large | Vertical slice first, strict phase gates, ROADMAP priorities |
| Parser accuracy | Wrong symbols or calls poison the graph | Real parsers (tree-sitter), store confidence and source location, report unsupported constructs |
| Coverage misinterpretation | Coverage ≠ correctness; line coverage ≠ test attribution | Explicit limitation text in every report; no per-test claims without instrumentation |
| Flaky statistics with tiny samples | False accusations against tests | Wilson intervals, minimum-sample rule, "suspected" vs "confirmed" |
| Untrusted input | Malicious reports, paths, repos | Threat model, size limits, safe XML, path validation, no auto-exec |
| Hardware variability | Boards and serial formats differ widely | Parser config, replay-first development, DEMO mode, read-only |
| Name conflicts | "ORBIT" is a common word | Availability check before release |
| Dependency drift | MCP SDK, Node, libraries move fast | Verify versions at install time; pin; record in ADRs |

## 8. Definition of done for the release candidate

The workflow in `docs/ROADMAP.md` §Acceptance must run end to end on a fixture repository containing TypeScript, Python and C/C++ firmware, with real parsed test and coverage reports and a clearly labelled synthetic ESP32 telemetry session. Optional integrations that are unavailable are reported as unavailable.
