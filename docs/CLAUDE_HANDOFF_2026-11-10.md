# ORBIT — Engineering Handoff (2026-11-10)

> Purpose: a durable, execution-ready handoff for the next engineering session / Claude Code. Treat repository state and CI as authoritative; do not infer completion from a plan or from mocked tests.

> **2026-11-10 ACCELQ update:** The Node 22 direct REST runner and response-contract tests are committed. ACCELQ validation run #104 passed on merge-synced PR #27 head `ce2e192f4b128d772ef4a2fb92030155ab70304b`; the live vendor job was correctly skipped because owner secrets/tenant configuration are absent. The full CI run #394 on that same head has Ubuntu + macOS checks still in progress at last refresh, while Windows is still in progress; the disposable SQLite-backed real API browser E2E is PASS and CodeQL #188 is PASS. Actual user-local database and full manual WCAG audit remain NOT RUN/BLOCKED.

## 1. Repository and current verified state

- Repository: https://github.com/claudeee617-hue/New-Orbit-
- Default branch: `main`
- Current Command Center PR: [#23](https://github.com/claudeee617-hue/New-Orbit-/pull/23)
- PR #23 branch: `feat/prompt-12-command-center-rebased`
- Verified PR #23 head at handoff start: `bf083ad30f0a06f6873c023a0fcfdfec4408da59`
- PR #23 is **open, draft, and mergeable**. Do not merge or mark ready until all release gates below pass.
- Latest verified CI run: **#326**, run ID `42730797002`, completed successfully on the head above.
- Latest verified Security / CodeQL run: **#120**, run ID `42730797022`, completed successfully on the same head.
- The rate-limit review thread in `apps/api/src/server.ts` is resolved.
- ACCELQ enterprise integration branch: `feat/accelq-enterprise-regression`, proposed as [draft PR #27](https://github.com/claudeee617-hue/New-Orbit-/pull/27), based on the verified PR #23 head. PR #27 includes the ACCELQ REST runner, scenario plan, gated workflow and disposable local API/browser integration. Keep it draft until CI approval/checks and ACCELQ tenant configuration are verified.

A green CI and CodeQL result proves those workflows passed for that exact commit. It does **not** prove a real user's local database/workspace works, that AccelQ ran, or that the product passed a full WCAG accessibility audit.

## 2. Non-negotiable safety and release rules

1. Never request or paste API tokens, database passwords, AccelQ API keys, or other secrets into chat, PR comments, source files, logs, screenshots, or handoff documents.
2. Use GitHub Actions Secrets / environment secret stores. Use placeholders in examples.
3. Never claim real-workspace validation without a real local API + database + workspace run.
4. Never label mocked Playwright network responses as live integration tests.
5. Never label automated axe/lint checks as a complete accessibility audit.
6. Keep PR #23 draft and unmerged until real-workspace smoke testing, keyboard/screen-reader checks, responsive checks, CI, CodeQL, and review are complete.
7. Do not merge stacked PRs out of order. PR #24 is based on PR #23; validate and land the parent first, then retarget the child to `main`.
8. Do not run destructive tests against a user's real database. Use a disposable copy or isolated test database.
9. Any external provider transmission (including AI) must remain explicit, previewed, and user-approved; preserve the existing AI feature's opt-in security boundary.

## 3. Current architecture / implemented ORBIT capabilities

The repository is a local-first engineering intelligence platform. The Command Center in Prompt 12 is a read-oriented UI over the authenticated local API.

### Command Center (PR #23 / Prompt 12)

Implemented on the PR branch:
- Dark-first Command Center with repository selector, overview, graph, evidence, Change Passports and Engine Workbenches.
- Same-origin authenticated API client. The API token is held in React page memory and sent only in the Authorization header; it is not persisted in localStorage/sessionStorage/cookies or URLs.
- Independently paginated graph nodes and edges; paginated evidence and Change Passports.
- Graph visualization with exact node-type filters, keyboard-operable SVG/table selection and connected-edge navigation when both endpoints are loaded.
- ATLAS inspector for raw node fields, symbol metadata and Decision/Documentation memory fields; file nodes can request local impact analysis.
- Evidence chronology, record metadata inspection and browser-side SHA-256 comparison for a user-selected artifact without uploading the artifact.
- Change Passport version history and before/after comparison.
- Engine workbenches for ATLAS, WITNESS, FLARE, CAPSULE, FLIGHT RECORDER, PASSPORTS, REPLAY ROOM and MCP/AI integration status.
- Authenticated integrity endpoint with per-client rate limiting (60 requests / 60 seconds), HTTP 429 + Retry-After, and bounded in-memory rate-window storage.
- Unit/integration coverage for API security, pagination, evidence ordering, graph filtering, keyboard controls and error states.
- Playwright Chromium E2E for connect/disconnect, Authorization-header-only token use, repository switching, dashboard/workbench navigation, API failure and empty-workspace states.
- CI browser runner uses retries and retains traces/videos/screenshots on failure; Playwright is installed transiently rather than added as a production dependency.

Important limits:
- Current Playwright E2E stubs the API. It is useful UI contract/regression coverage, not a real local database/API smoke test.
- Graph/evidence counts are bounded page results, not necessarily complete repository totals.
- FLIGHT RECORDER displays recorded telemetry; it does not imply live serial/device capture.
- REPLAY ROOM displays stored reproduction plans; it must not execute arbitrary commands.
- Do not infer coverage, flakiness, hardware status, or correctness when source evidence is absent.

### Other active work / PR dependencies

- **PR #24 — Prompt 14 AI preview/approval layer:** stacked on PR #23. Implements optional OpenAI Responses, Anthropic Messages and local Ollama adapters; exact evidence-context preview; SHA-256-bound approval; opt-in AI; provider keys remain on the local API process; bounded payloads/redaction/timeouts and no tools/graph mutation. At the latest inspected state, GitHub reported `mergeable: false`; re-check after the parent branch changes. Live provider smoke tests and browser proof that no network call occurs before explicit approval remain pending.
- **PR #25 — Prompt 13 GitHub Action / WITNESS integration:** composite Action to inspect caller PR diffs and optional coverage reports; fork-safe design; SARIF upload opt-in. Validate the pinned ORBIT runtime SHA, action integration tests and release documentation before publishing. Do not assume this Action is Marketplace-ready.
- Earlier handoff scope also referenced Prompt 12 finishing work, Prompt 13/14, Prompts 0–17, Business Modules 0–4, and the wider PR/branch history. Inspect GitHub before changing or closing older PRs; do not infer their current status from this summary.

## 4. Remaining release gates for PR #23

Work in this order and record evidence for each item.

### Gate A — Finish Command Center UX
- Review Replay Room against its intended read-only behavior and show the full stored reproduction metadata.
- Review Change Passport detail/version history/compare states, including empty, loading, API error and malformed/missing data states.
- Improve evidence timeline grouping and source-specific drill-down without inventing metrics.
- Check graph interactions on large/paginated data and ensure selection/navigation is keyboard-operable.
- Check all loading, empty, error, rate-limit and disconnected states.
- Check dark theme contrast and responsive layouts at narrow mobile, tablet and desktop breakpoints.

### Gate B — Real local-workspace smoke test (required)
Use a local ORBIT checkout with a disposable or explicitly approved test database:
1. Start the local services using the repository's documented command (`pnpm dev` after verifying current package scripts).
2. Confirm the API health endpoint and local database connection.
3. Connect through the Command Center using the local API token, entered locally by the operator only.
4. Select an actual registered repository and verify graph, evidence and passports.
5. Exercise pagination, integrity verification, impact analysis, passport history and comparison.
6. Verify disconnect/reload clears the in-memory token and no token appears in browser storage, URL, console or network query strings.
7. Record OS, browser, app commit, database fixture type, scenarios, outcome and known limitations. Do not record secrets.
8. Repeat with empty workspace and API unavailable/error cases.
9. Do not report this gate as passed if the only data source is Playwright route mocks.

### Gate C — Accessibility audit (required)
- Run automated accessibility checks (for example axe) as a baseline, not as the sole sign-off.
- Keyboard-only audit: logical tab order, visible focus, no traps, all graph controls and dialogs operable, Escape behavior, skip/navigation behavior.
- Screen-reader audit: landmarks, headings, form labels, status/error announcements, selected states, graph alternative/table representation, dialogs and dynamic updates.
- Verify contrast against WCAG 2.2 AA targets, including muted text, focus indicators, disabled controls and status colors.
- Test zoom/reflow and responsive widths; no clipped controls or horizontal overflow for primary workflows.
- Record actual browser + assistive technology combinations and any exceptions.

### Gate D — Final CI/security/review
- Run format, lint, typecheck, unit/integration tests, build, Playwright E2E and cross-platform matrix.
- Re-run CodeQL after the final code commit; resolve new findings and verify review threads.
- Review dependency changes, permissions, action pins, secrets exposure, logs and artifact retention.
- Update PR description and `docs/PROMPT_12_COMMAND_CENTER.md` to reflect exact evidence and remaining limitations.
- Only after all gates pass should the PR be marked ready for review. Merge only after explicit owner/reviewer approval.

## 5. ACCELQ enterprise regression layer (additional, not replacement)

### Role in the test pyramid

Keep three complementary layers:
1. **Unit/integration tests:** fast deterministic tests for domain logic and local API boundaries.
2. **Playwright:** repository-owned browser E2E and UI contract checks. Keep the existing local Chromium CI suite unchanged.
3. **ACCELQ:** additional enterprise regression for business workflows, cross-environment execution, API/UI combined flows, and execution through a Local Agent inside the network.

ACCELQ does not replace or weaken Playwright. ORBIT's ACCELQ integration triggers the saved CI job in the ACCELQ tenant; the CI job itself must be configured to point at the intended disposable/staging application and scenarios. Merely triggering the job does not deploy the current PR build to that environment.

### Verified ACCELQ API contract and runtime choice

Official ACCELQ documentation describes:
- Trigger endpoint: `PUT /awb/api/1.0/{tenantCode}/jobs/{savedJobId}/trigger-ci-job`.
- Trigger headers: `API_KEY`, `USER_ID`, and JSON content type.
- Trigger payload: `{ "jobPid": <savedJobId>, "runProperties": { ... } }` where runProperties is optional.
- The official action reads the first returned PID and exposes it as `pid`; the runner accepts that documented response shape.
- The run-status API returns overall status, total test cases and pass/fail/not-run counts. The official ACCELQ GitHub action source confirms the run lookup route `/awb/api/1.0/{tenantCode}/runs/{runtimePid}`, the `API_KEY` / `USER_ID` headers and report deep link format.

The official ACCELQ GitHub Action v1.4 is legacy and declares the Node 12 runtime. ORBIT therefore uses a small **Node 22 direct REST runner** instead of executing that old action. This keeps the API contract while avoiding the legacy action runtime. Do not add the vendor action back without a fresh compatibility/security review.

### Implemented in this repository branch

- `scripts/accelq-ci.mjs`: Node 22 runner validates configuration, triggers the saved ACCELQ CI job, records its runtime PID, polls status, enforces an agent-pickup timeout and maximum runtime, and writes a GitHub Actions summary.
- `scripts/accelq-ci.test.mjs`: Node's built-in test runner covers the exact trigger/status URLs, PID parsing, malformed count rejection, non-secret run-property validation, summary normalization and strict pass/fail rules.
- `.github/workflows/accelq-regression.yml`: runs the runner unit tests without credentials; the actual ACCELQ job is gated by repository variable `ACCELQ_ENABLED=true`, and fork-originated PRs cannot receive the subscription credentials.
- The runner never prints API keys, sends them in URLs, follows redirects, or logs raw vendor error bodies. It uses HTTPS only and fails closed on missing/unknown/invalid results.
- The default run settings are 20 minutes for Local Agent pickup, 90 minutes maximum execution and 30 seconds between status polls. These can be overridden with workflow environment settings after review.
- A run is successful only when ACCELQ reports COMPLETED, at least one case ran, and both failed and not-run counts are zero. A skipped workflow is NOT RUN, not PASS.

### GitHub configuration required from the repository owner

Add these **repository Actions secrets** (do not paste them into chat, source, PR comments or logs):
- `ACCELQ_APP_URL` — tenant server root, for example placeholder only: `https://<tenant>.accelq.io`. Use the exact ACCELQ server URL from the account.
- `ACCELQ_USER_ID` — ACCELQ user's login/email used for API access.
- `ACCELQ_API_KEY` — API key from the same user's ACCELQ Profile / Auth Properties.
- `ACCELQ_TENANT_CODE` — tenant code from Profile / Auth Properties.
- `ACCELQ_JOB_ID` — saved CI Template Job ID from ACCELQ.

Optional repository variable (not a secret; safe non-sensitive values only):
- `ACCELQ_RUN_PROPERTIES_JSON` — JSON object for environment selectors or other non-secret run properties. Never place passwords, API keys or other credentials here; use ACCELQ encrypted properties/approved secret storage instead.

After all five secrets exist and a manual run of the saved CI job succeeds inside ACCELQ, add repository variable:
- `ACCELQ_ENABLED` = `true`

Until then, leave the variable unset/false. The workflow's lightweight Node unit tests still run; the external ACCELQ job remains skipped.

### ACCELQ Local Agent setup

For a desktop host, follow ACCELQ's current install wizard:
1. Open **Resources → Local Agents** and choose **Download Agent** for the host OS.
2. Run the installer; it checks for a compatible JDK and may offer Zulu JDK if none is installed.
3. Provide the ACCELQ server URL, login user ID and API key from **Profile → Auth Properties**. Add an outbound proxy only if required.
4. Give the Agent a unique name and choose an installation path without spaces. Enable auto-start for a dedicated CI host where policy allows.
5. Refresh **Resources → Local Agents** and confirm the Agent is online.

For headless hosts, use ACCELQ's command-line/manual install flow and its generated Agent Properties file.

Choose Agent visibility deliberately (User, Project or Tenant). Project-level Agent visibility may require the Project Code inside the Agent's own `agent.properties`. This is separate from the GitHub API runner: **Project Code is not a GitHub Actions secret** and is not required by the direct REST API runner.

In the saved CI Job, verify the Application Environment, browser/profile, application URL, test suite/scenarios and Agent assignment. Run the job manually once and confirm the assigned Agent picks it up and produces a COMPLETED report with a non-zero test count.

Prefer a disposable/staging workspace and test accounts. Do not point automation at a production database or use a developer's personal workstation as an always-on agent.

### Scenario catalogue to create in ACCELQ

Create and tag scenarios in ACCELQ (ACCELQ remains the source of truth for scenario assets):
- `ORBIT-CC-01` — Command Center connects to the local/staging API and disconnects safely.
- `ORBIT-CC-02` — repository selection and empty-workspace state.
- `ORBIT-CC-03` — graph filters, node selection, edge navigation and pagination.
- `ORBIT-CC-04` — evidence chronology, evidence detail and integrity result.
- `ORBIT-CC-05` — Change Passport list, history and before/after compare.
- `ORBIT-CC-06` — Replay Room remains read-only; no command is executed.
- `ORBIT-API-01` — authentication, unauthorized request, invalid input and host protection.
- `ORBIT-API-02` — rate-limit threshold, HTTP 429 and Retry-After.
- `ORBIT-API-03` — pagination boundaries, empty pages and malformed query values.
- `ORBIT-SEC-01` — API token is not present in URLs, browser storage, screenshots or reports.
- `ORBIT-A11Y-01` — core keyboard navigation and accessible status/error messaging; supplementary to manual screen-reader audit.

Add locator recovery scenarios `ORBIT-LOC-01` through `ORBIT-LOC-04` as described in `docs/ACCELQ_TEST_PLAN.md`. In ACCELQ Playback Settings, **Enable Self-Healing** applies to Smart Locator elements; feature/plan availability may vary. Review every healed element and preserve business assertions. A healed locator is not proof that the test reached the intended business outcome. Locator-Free identification is a separate strategy and should be chosen intentionally. Tag scenarios by feature, risk, environment and execution tier; use isolated disposable test data.

### ACCELQ release criteria

- All five GitHub secrets are configured correctly and stored only in Actions secrets.
- The saved CI Template Job ID belongs to the intended ACCELQ project and is assigned to an online Local Agent where required.
- A manual ACCELQ pilot completes with actual test cases and a report.
- The GitHub Actions invocation returns a runtime PID, polls the status API and reports the actual pass/fail/not-run counts.
- Failures propagate to GitHub Actions; no zero-case run or unknown status is treated as PASS.
- Test evidence is retained without credentials or sensitive user data.
- Until the above is verified, ACCELQ is an integration implementation / NOT CONFIGURED or NOT RUN, not a completed vendor test run.

## Disposable local API integration (implemented on PR #27)

The CI browser job now runs an additional non-mocked integration test using an isolated SQLite database and a small temporary fixture repository:
- Builds the local API and workspace dependencies, starts the actual API process on loopback, and waits for its real health endpoint.
- Uses the authenticated repository scan endpoint to index the disposable fixture.
- Verifies repository listing, graph nodes, evidence page, Change Passport page and integrity verification against the real API.
- Connects the browser Command Center to that API through the Vite proxy, selects the real scanned repository, and verifies the token is sent only as a Bearer Authorization header.
- Checks that the token does not appear in localStorage/sessionStorage or in browser URLs, then disconnects and verifies it remains absent.
- Uses only an ephemeral CI token and disposable CI database; it is **not** a test of the owner's own local database.

This uncovered and fixed a real proxy issue: the Vite `/api` proxy previously stripped `/api` from every request, which changed `/api/v1/...` into `/v1/...` even though Fastify registers authenticated routes at `/api/v1/...`. The Vite proxy now rewrites only `/api/health` to `/health` and preserves `/api/v1/...` for authenticated API calls. The real API browser test verifies the corrected route.

Verified evidence: the disposable SQLite-backed Playwright browser job completed successfully in CI run #394 on merge-synced head `ce2e192f4b128d772ef4a2fb92030155ab70304b`; Ubuntu CI and CodeQL #188 passed, and macOS/Windows jobs were still running at last refresh. Earlier formatting and lint failures were corrected. Do not call the complete matrix green until all platform checks finish.

## 7. Next work sequence

1. Finish/review Command Center UX and update Prompt 12 documentation.
2. Complete the real local-workspace smoke test and WCAG/accessibility audit; fix findings.
3. Run final CI + CodeQL on the final PR #23 head; resolve review threads.
4. Review PR #23 and obtain explicit owner approval; only then merge the parent PR #23.
5. Rebase/retarget PR #24 onto the updated main, resolve conflicts, run security/approval/provider tests, and preserve the browser proof that no provider request occurs before explicit approval. Keep live provider tests opt-in.
6. Review PR #25 fork-safety and SARIF permissions; pin action dependencies and runtime SHA; exercise the action against fork and same-repository fixtures.
7. Review PR #26 MCP integration coverage, update it against current main, rerun the checks and merge after human review.
8. Complete the ACCELQ account setup: configure its five GitHub secrets, create/validate the saved CI job and online Local Agent, run a manual pilot, then enable `ACCELQ_ENABLED=true`.
9. Continue FLARE/CAPSULE persistence/replay, fuzzing, security review, clean-machine release validation and documentation reconciliation.
10. Produce a final release report listing each gate as PASS / FAIL / BLOCKED / NOT RUN, with evidence links and exact commit SHAs.

## 8. Status vocabulary

Use only these labels:
- **PASS** — observed successful run with traceable commit/run ID and relevant evidence.
- **FAIL** — observed failing run or reproducible defect.
- **BLOCKED** — cannot proceed due to missing access, local environment, vendor tenant, or dependency.
- **NOT RUN** — not executed.
- **NOT MEASURED** — no trustworthy measurement exists.

Never turn BLOCKED, NOT RUN or NOT MEASURED into PASS.

## 9. Official ACCELQ references

- GitHub Actions CI integration: https://support.accelq.com/hc/en-us/articles/360061826632-CI-Integration-with-Github-Actions
- External REST API trigger: https://support.accelq.com/hc/en-us/articles/360021077312-REST-API-end-point-to-trigger-test-execution-externally
- External run status API: https://support.accelq.com/hc/en-us/articles/360029298792-Tracking-status-of-a-test-job-with-external-REST-API
- Local Agent installer: https://support.accelq.com/hc/en-us/articles/4404553259405-Installing-Local-Agent-using-Install-wizard
- Local Agent properties and visibility scopes: https://support.accelq.com/hc/en-us/articles/4404554006541-Configuring-Local-Agent-properties
- Local Agent / private network execution: https://support.accelq.com/hc/en-us/articles/360019691372-Securely-execute-tests-behind-firewall-using-Local-Agent
- External script runner parameters: https://support.accelq.com/hc/en-us/articles/360046404991-Running-ACCELQ-Tests-using-Scripts
- Locator-Free and Smart Locator: https://support.accelq.com/hc/en-us/articles/48792897764877-Locator-Free-and-Smart-Locator
- Playback and self-healing setting: https://support.accelq.com/hc/en-us/articles/48792885705741-Playback-and-Validation
- REST API testing: https://support.accelq.com/hc/en-us/articles/38191380630541-REST-API-Test-Automation-in-ACCELQ
- Encrypted/environment properties: https://support.accelq.com/hc/en-us/articles/38191464769165-Managing-API-Test-Environments-and-Configurations-in-ACCELQ

## 10. Handoff instruction to Claude Code

Start by fetching the latest remote state of all relevant branches and PRs. Never assume this document is newer than GitHub. Work only on the branch assigned to the task; preserve the draft/unmerged constraints. Make small, reviewable commits, run the relevant tests, inspect the diff, push, and report the exact commit SHA and workflow run IDs. Do not fabricate test results or claim access to local credentials/workspaces that were not provided through a secure, authorized channel.
