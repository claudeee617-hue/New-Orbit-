# ORBIT — Complete Repository Audit & Claude Handoff

**Audit snapshot:** 10 November 2026 (updated after the 9 November baseline)  
**Repository:** https://github.com/claudeee617-hue/New-Orbit-  
**Default branch:** main  
**Coverage:** Full known PR history #1–#27, all 27 branches returned by the latest branch search, engineering Prompts 0–17, App Business Module sub-prompts 0–4, commercial strategy, security/release groundwork, Dependabot PRs, CI evidence, known gaps and next actions.

> This is a repository-wide handoff, not a report limited to PRs #22–25. It distinguishes merged code, closed/superseded work, current open PRs, historical branches and unimplemented roadmap scope. A green CI run does not by itself mean a feature is complete or release-ready.

## 1. Executive summary

ORBIT is a local-first engineering intelligence platform. Its intended workflow connects repository structure, source changes, test/coverage evidence, declared environments, recorded embedded-device telemetry and a versioned evidence graph. Its central artifact is the Change Passport: a content-hashed record of a change, supplied evidence, known findings and missing verification.

Three product workstreams are represented in the repository:

1. **Engineering platform:** ORBIT Core, ATLAS, WITNESS, FLARE, CAPSULE, FLIGHT RECORDER, Change Passport, MCP, local API/CLI, Command Center, GitHub Action and optional AI.
2. **App Business Module:** market research, business strategy, data contract, business dashboard and local financial/pricing simulator.
3. **Governance and commercialization:** hybrid open-core strategy, security/privacy documentation, contributor/release groundwork, license, dependency automation and validation gates.

### Current state

- Engineering Prompts **0–11** are represented in merged main according to the merge history, with Prompt 11 merged through PR #11.
- App Business Module sub-prompts **0–4** are merged through PR #9.
- Security/privacy/release groundwork from Prompts **15–17** is merged through PR #15. This is not a security certification or release approval.
- Prompt 12 is a partial Command Center vertical slice in draft PR #23.
- Prompt 13 is a partial GitHub verification Action in draft PR #25.
- Prompt 14 is experimental opt-in AI provider/preview/approval work in draft PR #24, stacked on the current PR #23 head; the branch was manually reconciled so it is ahead 19 / behind 0 from the parent and includes a browser approval-flow test.
- Dependabot PRs #17–20 were individually merged into main on 10 November 2026 after their CI/Security workflows passed.
- No public release is approved. ORBIT remains a working codename pending name/trademark checks.

## 2. Complete PR register — #1–#27

“Closed, unmerged” means the PR is not the merge target; trace its implementation to the consolidation/replacement PR below. Merged status is based on the GitHub PR metadata returned during this audit.

| PR | Subject | State at audit | History / disposition |
|---|---|---|---|
| [#1](https://github.com/claudeee617-hue/New-Orbit-/pull/1) | Initial cross-engine evidence prototype and local CLI | Closed, unmerged | Early WITNESS/FLARE/CAPSULE/FLIGHT RECORDER/Passport/ATLAS memory/MCP/CLI prototype; superseded by #5 |
| [#2](https://github.com/claudeee617-hue/New-Orbit-/pull/2) | Hybrid monetization architecture | Closed, unmerged | Early commercial strategy branch; later commercial docs consolidated |
| [#3](https://github.com/claudeee617-hue/New-Orbit-/pull/3) | Hybrid business model and commercial roadmap docs | Closed; metadata marks merged | Description says commercial docs were consolidated into main through #5; inspect merge ancestry if exact file provenance matters |
| [#4](https://github.com/claudeee617-hue/New-Orbit-/pull/4) | Replacement cross-engine evidence prototype | Closed, unmerged | Sanitized replacement for #1 history; implementation consolidated into #5 |
| [#5](https://github.com/claudeee617-hue/New-Orbit-/pull/5) | Engineering Prompts 5–10 consolidation | **Merged** | Main engineering implementation: ATLAS memory/MCP, WITNESS, FLARE, CAPSULE, FLIGHT RECORDER and Change Passport backend |
| [#6](https://github.com/claudeee617-hue/New-Orbit-/pull/6) | App Business Module Prompts 0–3 | Closed, unmerged | Superseded by consolidated #9 |
| [#7](https://github.com/claudeee617-hue/New-Orbit-/pull/7) | Prompt 4 Business Intelligence dashboard | Closed, unmerged | Superseded by consolidated #9 |
| [#8](https://github.com/claudeee617-hue/New-Orbit-/pull/8) | Engineering Prompts 0–10 + Business Module consolidation | Closed, unmerged | Superseded to avoid duplicated engineering history; Business Module moved to #9 |
| [#9](https://github.com/claudeee617-hue/New-Orbit-/pull/9) | App Business Module Prompts 0–4 | **Merged** | Main Business Module: research, business model, typed data contract, dashboard and local BI/pricing simulator |
| [#10](https://github.com/claudeee617-hue/New-Orbit-/pull/10) | Earlier Business Module Prompts 0–3 branch | Closed, unmerged | Superseded by #9 |
| [#11](https://github.com/claudeee617-hue/New-Orbit-/pull/11) | Prompt 11 local API and CLI workflows | **Merged** | Authenticated local API, token lifecycle, ingestion, graph/evidence/Passport routes and expanded CLI |
| [#12](https://github.com/claudeee617-hue/New-Orbit-/pull/12) | Earlier Prompt 12 Command Center | Closed, unmerged | Superseded by clean replacement #23 |
| [#13](https://github.com/claudeee617-hue/New-Orbit-/pull/13) | Earlier Prompt 12 Command Center | Closed, unmerged | Superseded by clean replacement #23 |
| [#14](https://github.com/claudeee617-hue/New-Orbit-/pull/14) | Earlier Prompt 13 GitHub Action | Closed, unmerged | Superseded by clean replacement #25 |
| [#15](https://github.com/claudeee617-hue/New-Orbit-/pull/15) | Prompts 14–17 security/privacy/release groundwork | **Merged** | SECURITY.md, privacy, CodeQL, Dependabot, validation gaps, Apache-2.0 LICENSE, contribution and release docs |
| [#16](https://github.com/claudeee617-hue/New-Orbit-/pull/16) | Earlier Prompt 14 AI provider adapters | Closed, unmerged | Superseded by clean replacement #24 |
| [#17](https://github.com/claudeee617-hue/New-Orbit-/pull/17) | Dependabot: actions/setup-node 4 → 7 | **Merged** | GitHub merge recorded 10 November 2026; resulting main checks passed |
| [#18](https://github.com/claudeee617-hue/New-Orbit-/pull/18) | Dependabot: actions/checkout 4 → 7 | **Merged** | GitHub merge recorded 10 November 2026; resulting main checks passed |
| [#19](https://github.com/claudeee617-hue/New-Orbit-/pull/19) | Dependabot: github/codeql-action 3 → 4 | **Merged** | GitHub merge recorded 10 November 2026; resulting main checks passed |
| [#20](https://github.com/claudeee617-hue/New-Orbit-/pull/20) | Dependabot: pnpm/action-setup 4 → 6 | Open | CI dependency update; verify pnpm 10 pin and all OS workflows |
| [#21](https://github.com/claudeee617-hue/New-Orbit-/pull/21) | Earlier Prompt 14 AI preview/approval | Closed, unmerged | Superseded by clean replacement #24 |
| [#22](https://github.com/claudeee617-hue/New-Orbit-/pull/22) | Repository status/docs and Claude handoff | Open | Documentation-only corrections to README/build-state and this full handoff |
| [#23](https://github.com/claudeee617-hue/New-Orbit-/pull/23) | Prompt 12 Command Center clean replacement | Open, draft | Partial Command Center vertical slice based directly on main |
| [#24](https://github.com/claudeee617-hue/New-Orbit-/pull/24) | Prompt 14 AI preview/approval clean replacement | Open, draft | CI #403 and CodeQL #196 passed, including AI approval-flow browser E2E; live provider smoke remains opt-in |
| [#25](https://github.com/claudeee617-hue/New-Orbit-/pull/25) | Prompt 13 GitHub Action clean replacement | Open, draft | CI #422, Security #215, Action integration #10 passed; static fork-safety guard included; live external-fork event pending |
| [#26](https://github.com/claudeee617-hue/New-Orbit-/pull/26) | MCP all-tool integration coverage + Claude Code guide | Open | CI #414 and Security #207 passed; includes 12-tool tests and production stdio / disposable SQLite read-only acceptance |
| [#27](https://github.com/claudeee617-hue/New-Orbit-/pull/27) | ACCELQ enterprise regression (ACCELQ-only after cleanup) | Open, draft | Pre-cleanup CI/Security and ACCELQ runner validation passed; cleanup-head runner validation passed; fresh full CI/Security checks rerunning |

### PR lineage

- Cross-engine prototype: **#1 → #4 → #5**. #1 and #4 are closed unmerged; #5 is the merged consolidation.
- Commercial strategy docs: **#2 / #3**. #3 metadata is marked merged, while its description says commercial docs were consolidated through #5. Preserve this provenance nuance; do not double-count features.
- Business Module: **#6 + #7 + #10 → #9**.
- Engineering consolidation attempt: **#8** closed as superseded; it duplicated engineering work already merged through #5.
- Prompt 12: **#12 / #13 → #23**.
- Prompt 13: **#14 → #25**.
- Prompt 14: **#16 / #21 → #24**; #24 is now based on the current #23 head with the current Command Center UI merged in.
- Security/release groundwork: **#15** merged.
- Documentation correction/full handoff: **#22**, open.
- Dependency automation: **#17–20**, all merged into `main` on 10 November 2026.

Closed superseded PRs are historical records, not active merge targets. Trace their changes to the consolidation/replacement PR above.

## 3. All 27 branches returned by GitHub after dependency merges

The 11 November refresh returned 27 branch names. Presence in this list does not imply an open PR or release readiness.

### Main and documentation
- `main`
- `docs/orbit-commercial-architecture`
- `docs/prompt-15-17-security-release`
- `docs/status-audit-2026-11-08`

### Engineering / early cross-engine
- `feat/orbit-evidence-engines`
- `feat/prompts-6-8-completion`
- `feat/orbit-prompts-0-10-business-consolidated`
- `feat/prompt-11-api-cli`
- `prompt-6-witness`
- `wip/prompt5-duplicate-local`

### Business Module
- `feat/app-business-module-prompts-0-3`
- `feat/business-intelligence-prompt-4`
- `feat/business-module-prompts-0-4-main`

### Command Center / Action / AI / CI
- `feat/prompt-12-command-center`
- `feat/prompt-12-command-center-final`
- `feat/prompt-12-command-center-rebased`
- `feat/prompt-13-github-action`
- `feat/prompt-13-github-action-rebased`
- `feat/prompt-14-opt-in-ai`
- `feat/prompt-14-opt-in-ai-full`
- `feat/prompt-14-ai-rebased`
- `feat/accelq-enterprise-regression`

### Maintenance / strategy
- `fix/audit-2026-11-08`
- `fix/audit-docs-deps-ci`
- `fix/prompt12-prettier-format`
- `strategy/hybrid-monetization`

### Dependabot
- `dependabot/github_actions/github/codeql-action-4`

**Branch hygiene:** closed PR branches remain in the repository. Do not delete branches just because their PR is closed. Verify unique work, reachability from main/replacement branches and open PR dependencies first. PR #24 is stacked on PR #23; PR #27 is stacked on PR #23. No historical/WIP branch should be deleted without ancestry and content review.

## 4. Prompt-by-prompt implementation map

### Engineering Prompts 0–4 — foundation

The master plan/build-state describe these as implemented on main:

- **Prompt 0 — Master plan:** product definition, principles, scope, milestones and roadmap documents.
- **Prompt 1 — Technical design:** architecture, data model, product requirements, threat model, UX and testing design.
- **Prompt 2 — Monorepo foundation:** pnpm workspace, TypeScript, lint/format/test/build tooling, workspace packages and CI.
- **Prompt 3 — ORBIT Core:** graph model, nodes/edges/evidence, validation, persistence and hash-chained ledger foundations.
- **Prompt 4 — ATLAS:** repository scanning, language/framework/dependency detection and architecture/symbol indexing foundations.

Claude must verify exact current implementation against packages/core, packages/graph, packages/database, packages/atlas, workspace scripts and tests. Do not assume every roadmap parser/language task is complete.

### Engineering Prompts 5–10 — merged through PR #5

**Prompt 5 — ATLAS memory + MCP**
- Versioned Decision/Documentation memory nodes, source references, SHA-256 evidence, deterministic lexical search, invalidation/tombstones, Markdown/ADR import and explicit supersedes/conflict metadata.
- Read-only stdio MCP with 12 bounded tools for repository, symbol, impact, history, memory and evidence queries.
- SQLite opened read-only for MCP; no graph mutation, shell, file-write, network-fetch or device-control tools.
- Limits: lexical matching, not embeddings; freshness depends on caller-supplied hash manifests; conflicts are explicit metadata, not semantic contradiction detection; stdio only.

**Prompt 6 — WITNESS**
- Unified diff parsing, changed-line coverage with LCOV/Cobertura, deterministic findings, baseline/candidate comparison semantics, sensitive-path filename checks and Markdown/SARIF output.
- Coverage is execution evidence, not proof of correctness. Unsupported/ambiguous diff cases need tests. Missing coverage must remain NOT_MEASURED/incomplete, not zero.

**Prompt 7 — FLARE**
- Bounded JUnit, pytest, Jest and Go report adapters; reliability history, failure clustering and duration analytics.
- One report is not enough to label a test flaky; durable history depends on supplied/ingested prior runs and minimum-sample gating.

**Prompt 8 — CAPSULE**
- Polyglot manifest/toolchain/container/workspace inspection and deterministic fingerprints.
- Declared configuration only, not a full host image or installed dependency inventory; no automatic build replay in the merged implementation.

**Prompt 9 — FLIGHT RECORDER**
- Bounded JSON/NDJSON/CSV/key-value recorded telemetry parsing, normalized event categories, units/thresholds, SHA-256-verified repo-local persistence, device/firmware/commit links and DEMO fixtures.
- Recorded-file replay only; no live serial/USB capture or hardware commands. Synthetic ESP32/STM32 data must remain labelled DEMO.

**Prompt 10 — Change Passport + Replay Room backend**
- Exact-commit evidence correlation, bounded graph impact, completeness dimensions, immutable graph-backed history, comparisons and non-executing reproduction plan.
- Backend/CLI prototype only; visual Replay Room and full user-facing evidence exploration remain incomplete.

**PR #5 validation:** CI run 42481776408 completed successfully. PR description records Ubuntu, macOS and Windows passed; Ubuntu recorded 331 passing tests and format/lint/typecheck/build success. This is not proof all roadmap acceptance scenarios or security requirements are complete.

### App Business Module sub-prompts 0–4 — merged through PR #9

Separate from engineering Prompts 0–17.

- **Business Prompt 0 — Research:** vendor-linked adjacent-market price references, billing units/research dates, customer segments, beachhead/buyer hypotheses and validation gates. Adjacent tools are not automatically direct substitutes.
- **Business Prompt 1 — Business model:** hybrid open-core packaging proposals for Community, Team, Enterprise and Embedded. Proposed paid prices are hypotheses/future offers, not active checkout prices.
- **Business Prompt 2 — Data contract:** typed strategy, offer, segment, market reference, commercial gate, KPI and privacy structures. KPIs remain Not measured until real data is supplied.
- **Business Prompt 3 — Command Center:** Overview/Business navigation, strategy and market-research view, packaging, segments, vendor benchmarks, roadmap gates and safeguards.
- **Business Prompt 4 — Business Intelligence:** user-entered actual-vs-forecast revenue, expenses and customer counts; derived profit, margin, revenue change and revenue per paying customer; INR/USD display formatting without FX conversion; pricing/profitability simulator for price, costs, seats, contribution, margin and break-even.

**Business Module boundaries:** no live accounting, billing, payment, checkout, CRM, hosted customer database or customer-data connector. BI values live in local React state and are discarded after refresh; they are planning inputs, not verified company performance.

**PR #9 validation:** CI run 42482180835 completed successfully on the commit associated with the PR; PR #9 description records cross-platform validation. Re-run a fresh full check before release.

### Engineering Prompt 11 — merged through PR #11

**Local API**
- Preserves public GET /health and loopback Host-header protection.
- Persistent random local Bearer token; first startup creates api.token beside the configured database with restrictive Unix permissions; ORBIT_API_TOKEN can be supplied.
- Authenticated /api/v1 routes for repositories/local scan, graph nodes/edges, evidence, Change Passport history/comparison/creation, ATLAS impact/export and CI/test/environment/recorded-telemetry ingestion.
- Bounded request bodies, pagination and field validation.
- Allowlisted CI summary/environment metadata; unknown fields rejected; raw test/telemetry input hashed and parsed rather than copied into graph attributes.
- No hosted sync, remote repository URL scanning, shell execution, hardware control or cloud data path.

**CLI**
- orbit init, orbit doctor, graph summary/nodes, CI ingestion, test ingestion/history, plus existing scan/ATLAS/WITNESS/FLARE/CAPSULE/FLIGHT RECORDER/Passport/MCP commands.

**Important boundary:** local-development API, not a multi-user server. Keep loopback binding; do not expose it on an untrusted network. doctor does not prove the API process is reachable. Environment ingestion accepts allowlisted metadata, not arbitrary env files or secret values.

**PR #11 validation:** CI run 42485192323 completed successfully. PR description records run #136 passing Ubuntu/macOS/Windows, 373 Ubuntu tests, formatting, ESLint, all 15/15 typecheck tasks and all 9/9 production build tasks.

### Prompt 12 — Command Center (open draft PR #23)

Partial vertical slice:
- Authenticated same-origin local API client; token held in React component memory.
- Dark-first Command Center with repository selector, overview, graph-node, evidence and Change Passport lists.
- Read-only ledger-integrity endpoint/indicator.
- Existing Business Module navigation retained.
- API and integrity endpoint tests.

Rebase fixes:
- Fixed exactOptionalPropertyTypes errors in two CommandCenter call sites and API request option typing.

Verified:
- CI run #229 passed Ubuntu/macOS/Windows.
- Security run #23 passed.
- PR #23 is based directly on main.

Pending:
- Dedicated ATLAS/WITNESS/FLARE/CAPSULE/FLIGHT RECORDER screens and deeper engine drill-down.
- Change Passport detail, evidence verification and visual Replay Room.
- Browser E2E against a real local workspace.
- Accessibility, keyboard and screen-reader validation; real-world UX review.

This is not a finished Command Center.

### Prompt 13 — GitHub Action (open draft PR #25)

Partial composite Action:
- .github/actions/orbit/action.yml and .github/scripts/orbit-action.mjs.
- Uses trusted ORBIT runtime/CLI from PR base SHA; PR head is treated as diff data and is not executed.
- LCOV/Cobertura changed-line coverage and filename-only sensitive-path checks.
- Markdown report, workflow summary and optional SARIF.
- Optional PR comment and SARIF upload; least-privilege design.
- Missing coverage is NOT_MEASURED, not 0%.
- Dedicated .github/workflows/orbit-action-test.yml exercises the action against a PR diff with read-only permissions, no secrets and no comment/SARIF upload.

Verified:
- CI run #226 passed Ubuntu/macOS/Windows.
- Security run #20 passed.
- Action integration run #1 passed.

Pending:
- Fork-PR behavior, token permissions and comment failure behavior.
- SARIF upload path with exact required permissions.
- Review action references still using older major versions and CI Node-runtime deprecation warnings.
- Invalid/missing coverage and unsupported report formats.
- Broader report ingestion/per-line annotations are future scope.

### Prompt 14 — optional ORBIT AI (open draft PR #24; stacked on #23)

Experimental implementation:
- Dependency-light @orbit/ai adapters for OpenAI Responses, Anthropic Messages and local Ollama.
- Local API preview/analysis endpoints and Command Center AI Analysis panel.
- AI disabled unless local API operator sets ORBIT_AI_ENABLED=true.
- Provider keys stay in local API process, not browser JavaScript.
- Exact evidence-context preview includes destination, selected evidence IDs, hash, byte count, redaction count and limitations.
- Explicit approval bound to exact preview SHA-256, provider, model and destination.
- Prompt/context/output limits, best-effort secret redaction, timeouts and streaming-enforced 256 KiB provider response cap.
- OpenAI request sets store:false.
- No tools, shell execution, graph mutation, automatic patch application, PR approval or hardware control.
- Regression test for oversized responses; duplicate integrity test removed.

Verified:
- Earlier CI #225 passed Ubuntu/macOS/Windows.
- Latest CI #231 passed Ubuntu/macOS/Windows after documentation-only policy correction.
- Security run #25 passed.

Pending:
- Live provider smoke tests with disposable test credentials; never commit secrets or send private user data.
- Browser E2E proving no provider request occurs before explicit approval of the exact preview.
- Invalidate approval when evidence/provider/model/destination changes.
- Timeout, malformed JSON, 401/429/5xx, remote Ollama approval, redaction edge cases and prompt-injection tests.
- Ensure provider credentials never enter browser bundles, logs or rendered UI.
- Cancellation, token/cost estimates, model capability selection and retention disclosures.
- Independent privacy/data-flow review.

AI is advisory and experimental, not an autonomous coding agent. Redaction is best-effort; the user must inspect the exact preview before approving transmission.

### Prompts 15–17 — security and release groundwork merged through PR #15

Merged:
- SECURITY.md, privacy/data-handling documentation, CodeQL workflow, Dependabot configuration.
- AI provider/privacy policy (at merge time, AI was not implemented and had to remain opt-in).
- Validation-gap register for Prompts 12–16.
- Apache-2.0 LICENSE, CONTRIBUTING.md, CODE_OF_CONDUCT.md, CITATION.cff, issue templates and release checklist.

Verified:
- CI run 42487762067 completed successfully.
- Security run 42487762037 completed successfully.

Pending:
- Independent security review; CodeQL is not a security audit.
- Parser/path/XXE/fuzz and adversarial tests.
- Browser E2E, accessibility and supported schema migration tests.
- Provider privacy/data-flow review.
- Clean-machine install/quick-start validation.
- Third-party notices and dependency-license review.
- ORBIT name, GitHub/npm/domain and trademark checks.
- Owner approval, versioning and release tagging.

| [#26](https://github.com/claudeee617-hue/New-Orbit-/pull/26) | MCP integration tests and Claude Code guide | **Open** | Adds tests invoking all 12 MCP tools via official in-memory transport, limit/traversal/ledger invariance checks, and a Claude Code setup guide. PR description reports full `pnpm run check`; manual other-client and Windows/macOS setup remain untested. |

## 5. Dependabot PRs #17–20 — merged

All four dependency updates were merged into `main` on 10 November 2026:
- #17 actions/setup-node 4 → 7
- #18 actions/checkout 4 → 7
- #19 github/codeql-action 3 → 4
- #20 pnpm/action-setup 4 → 6

The latest `main` commit after these updates is `55e52804efe26dbc365910ac3e1b7d4136e5d04b`. Its Ubuntu, macOS and Windows CI jobs and CodeQL check completed successfully. Continue monitoring dependency alerts and re-run the full matrix after subsequent workflow changes.

## 6. CI evidence ledger

| PR/work | Run | Result recorded in this audit |
|---|---|---|
| #5 engineering Prompts 5–10 | CI 42481776408 | Completed successfully |
| #9 Business Module | CI 42482180835 | Completed successfully |
| #11 local API/CLI | CI 42485192323 | Completed successfully |
| #15 governance/release | CI 42487762067 | Completed successfully |
| #15 governance/release | Security 42487762037 | Completed successfully |
| #23 Prompt 12 | CI #229 | Ubuntu/macOS/Windows passed |
| #23 Prompt 12 | Security #23 | Passed |
| #24 Prompt 14 | CI #231 | Ubuntu/macOS/Windows passed |
| #24 Prompt 14 | Security #25 | Passed |
| #25 Prompt 13 | CI #226 | Ubuntu/macOS/Windows passed |
| #25 Prompt 13 | Security #20 | Passed |
| #25 Prompt 13 | Action integration #1 | Passed |

This is a dated snapshot, not a live guarantee. Before merging, query latest checks for the current PR head SHA. An old green run does not cover later commits.

## 7. Main-branch documentation drift

At audit time, README.md and ORBIT_BUILD_STATE.md on main still describe Prompt 11 as awaiting review and Prompt 12/13/14 as not started or unimplemented. That is stale relative to later merge/replacement activity.

PR #22 corrects README and build-state status and adds this repository-wide handoff. Until #22 merges:
- main remains stale in its status narrative.
- This handoff branch is the more current snapshot for review.
- Do not treat the current main README's old status table as authoritative latest state.

Also reconcile the historical Prompt 15 AI policy with later Prompt 14 work: PR #15 correctly recorded AI as not implemented at that time; PR #24 later adds experimental AI work but remains open and unmerged.

## 8. Repository architecture and implementation boundaries

Workspace areas:
- apps/api — local API.
- apps/cli — CLI workflows.
- apps/web — React/Vite Command Center and Business Module.
- packages/core, packages/graph, packages/database — core graph, data and persistence foundations.
- packages/atlas — ATLAS and currently colocated extended engine implementations.
- packages/mcp — read-only stdio MCP.
- packages/ai — experimental optional provider adapters on PR #24, not yet in main.

Toolchain documented in package.json:
- Node.js >=22.12.0.
- pnpm 10.28.0.
- TypeScript, ESLint, Prettier, Turborepo and Vitest.
- Root pnpm run check runs format check, lint, typecheck, tests and build.

Workspace pnpm-workspace.yaml includes apps/* and packages/*. esbuild is allowed to run its install build; better-sqlite3 is deliberately ignored to avoid unnecessary node-gyp rebuilds in restricted environments. Verify this install strategy against current supported platform binaries and clean-install behavior.

### Non-negotiable principles
- Local-first; Core works without network access or AI API keys.
- Never fabricate tests, build results, measurements, telemetry or confidence.
- Synthetic fixtures are labelled DEMO.
- Evidence is content-hashed; missing evidence is explicitly reported.
- Do not execute untrusted repository code automatically.
- Hardware access remains read-only/off by default; no device commands.
- AI is optional and requires explicit approval before external provider transmission.
- No unsupported claim of correctness, security certification or commercial readiness.

## 9. Prioritized repository-wide work plan for Claude

### P0 — establish truth and protect main
1. Pull latest main and inspect every open PR (#22–27) by current head SHA.
2. Build a reliable PR/branch/commit map; confirm merged commit ancestry and ensure closed superseded work is preserved or intentionally abandoned.
3. Reconcile README, ORBIT_BUILD_STATE.md, ORBIT_MASTER_PLAN.md, docs/ROADMAP.md and validation-gap docs.
4. Run fresh pnpm install --frozen-lockfile and pnpm run check on a clean environment and all supported CI platforms.
5. Confirm the merged dependency versions remain pinned and compatible after subsequent workflow edits.

### P1 — finish product vertical slice
6. Complete Prompt 12 browser E2E, accessibility, engine screens and Change Passport/Replay Room detail, or formally scope PR #23 as an initial vertical slice.
7. Complete Prompt 13 fork safety, SARIF and permissions tests; update deprecated Action majors after compatibility checks.
8. Complete Prompt 14 approval-flow browser tests, provider smoke tests with disposable credentials and data-flow/privacy review.
9. Verify local API auth, loopback binding, token file permissions, Host-header validation, ingestion bounds and secret handling through adversarial tests.
10. Validate Business Module calculations and assumptions; clearly label unmeasured KPIs and do not imply live integrations.

### P2 — harden and release
11. Add parser fuzzing, path traversal/XXE adversarial fixtures and migration tests.
12. Add the full fixture repository and ten controlled acceptance scenarios from the test strategy.
13. Validate clean-machine install, docs, license notices, dependency licenses, ORBIT name/trademark and release packaging.
14. Obtain owner review before release tagging or publication.

### PR dependency order
- Review/merge #22 documentation corrections when accepted.
- Review #23 Prompt 12 first.
- #24 is stacked on #23: merge #23 first, retarget #24 to main, then rerun full checks.
- #25 is independent of #23 and can be reviewed separately.
- #17–20 have been merged; verify the dependency updates remain healthy in the latest main CI.

## 10. Required audit output from Claude

Claude should return a separate audit report containing:
1. Verified main commit SHA and clean-install/toolchain result.
2. Every PR #1–25 with exact current state, merge SHA if merged, head SHA, changed-file count, base branch, CI checks and disposition.
3. Every branch with whether it is active, merged, superseded, dependency-generated or safe to archive; no deletion without proof.
4. Prompt-by-prompt matrix for engineering Prompts 0–17 and Business Module 0–4: implemented, partial, experimental, missing, test evidence and owner action.
5. Findings classified Critical/High/Medium/Low with file path and line references.
6. Reproducible commands and test results; no claims based only on README prose.
7. Fix plan ordered by risk and dependency, with no unapproved destructive changes.
8. A final ready/not-ready decision for each PR and for release, with reasons.

## 11. Guardrails for Claude

- Do not assume all branches are merged or all PRs with green CI are ready.
- Do not merge/close PRs, delete branches, rewrite history, rotate secrets or publish packages without explicit owner approval.
- Never expose API tokens, provider keys or private workspace data in logs, reports or commits.
- Never run untrusted PR source code in the trusted verification Action.
- Do not send private source/evidence to AI providers during smoke tests.
- Do not treat best-effort redaction as a guarantee.
- Do not label the Business Module a finance/accounting system.
- Do not claim live serial/USB capture, build replay, hosted sync, billing or CRM integrations unless implemented and verified.
- Do not claim ORBIT is security-certified, correctness-guaranteeing or release-ready.
- Keep findings evidence-backed with exact paths, commit/PR references and reproducible steps.

---
**Handoff intent:** Claude is being asked to audit the entire ORBIT repository and its complete known PR/branch history, not merely PRs #22–25. Treat this as a dated starting point and refresh GitHub state before any implementation or merge decision.


## 12. Update after the 8 November audit — PR #26 and branch inventory

A fresh repository query on 9 November returned 26 branches (the previous snapshot listed 24). The additional branch names include `fix/audit-2026-11-08` and `wip/prompt5-duplicate-local`; neither should be deleted or assumed redundant without ancestry and content review. PR #26 is now open and proposes integration tests for all 12 MCP tools plus `docs/CLAUDE_CODE_MCP.md`. The PR description reports `pnpm run check` passing (15/15 tasks, 9/9 builds) and 13 MCP tests. These are PR-reported results, not a substitute for checking the current head SHA and latest workflow runs.

The PR #26 integration test exercises `createOrbitMcpServer` using an in-memory graph store and linked in-memory MCP transport. It verifies tool responses, input bounds, traversal-style path behavior and unchanged ledger head. It does **not by itself** prove the production `orbit mcp start` process opens a real on-disk SQLite database read-only; that launch/database-mode path remains a separate acceptance test. The manual Claude Code smoke test is Linux-only; Claude Desktop, Cursor, Windows and macOS remain unverified.

Current open PRs observed after dependency maintenance: #22 (status/handoff docs), #23 (Prompt 12), #24 (Prompt 14 stacked on #23), #25 (Prompt 13), #26 (MCP tests/guide) and #27 (ACCELQ-only integration). PRs #17–20 have since merged. Refresh all PR head SHAs, base branches, review state and CI/security/action checks before any merge. Do not merge #24 before #23; do not merge or close any PR solely because its description reports a green historical run.


### Additional Prompt 13 security correction found during 9 November review

The first draft of PR #25 checked out `${{ github.event.pull_request.base.sha }}` from the ORBIT repository as its trusted runtime. That SHA belongs to the caller repository when the Action is consumed externally, so the published example would fail for consumers whose base commit does not exist in ORBIT. The PR #25 feature branch pins the trusted ORBIT runtime to commit `fde44b79d97a9e9c8e62120816799dee48c41233`, independently of the caller's `base-sha`/`head-sha`; the Action documentation explains the cross-repository SHA boundary and requires consumers to pin the Action release by immutable SHA. On 10 November, CI #390, Security #184 and Action integration #7 passed; the integration workflow supplied an LCOV fixture and validated SARIF 2.1.0 generation while keeping upload disabled. The remaining specific gate is fork-originated PR permission behavior; actual SARIF upload is intentionally not executed in that test to avoid publishing unwanted alerts. The Action is still a draft and not a Marketplace release.



## 13. 10 November 2026 verified GitHub refresh

The following are PR-reported verified head/run pairs as observed during this refresh; always re-query before action:

| PR | Head SHA | Verified checks | Remaining release work |
|---|---|---|---|
| #22 | `9cbb23d3be10d4bfb16db43e7e0401c8d4a11dd9` | CI #241 and Security #35 passed | Docs-only snapshot; review then owner merge decision |
| #23 | `f0db435f9a209ebcfd1e187a5d937107cdc2f65e` | CI #393 and CodeQL #187 passed | User-local workspace test and manual accessibility audit |
| #24 | `1a80972a417fc96bd6c3f21c521fc94b4e0b5a86` | CI #403 and CodeQL #196 passed; Chromium AI preview/approval browser test passed | Live provider smoke remains opt-in / NOT RUN pending owner credentials |
| #25 | `60f6aacd10b204a60f0025353153d964d2d97d23` | CI #390, Security #184, Action integration #7 passed | Fork-PR permission test; actual SARIF upload intentionally not run |
| #26 | `64f90c95b34c30238e8b53bb7c64deceffddb001` | CI #414 (Ubuntu/macOS/Windows + production stdio SQLite acceptance) and Security #207 passed | User-local DB validation and other MCP client/platform manual smoke remain separate gates |
| #27 | `317bf937c9ac9863d4e953e62660897164ac2cbf` | ACCELQ runner validation passed on cleanup head; fresh full CI/Security pending at handoff refresh | Live ACCELQ remains NOT RUN pending tenant/job/agent setup; user-local DB and manual accessibility still pending |

The current branch inventory returned 27 branches, including `feat/accelq-enterprise-regression` and `fix/audit-docs-deps-ci`. Do not delete historical/experimental branches merely because they are absent from the open-PR list; first inspect ancestry and unique commits. No PR was merged by this refresh.

