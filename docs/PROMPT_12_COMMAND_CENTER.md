# ORBIT Prompt 12 — Command Center

**Status:** Implementation submitted in PR #23. The dashboard is a local-first, authenticated read surface. The cross-platform test-timeout hardening from PR #37 is now merged to `main`; Prompt 12 still requires fresh CI on the updated merge base, manual accessibility review and a real local-workspace acceptance run.

## Implemented

- Same-origin API client for authenticated local repository, graph, evidence, passport, ATLAS report and scan endpoints.
- API token entered by the local user, held in page memory only, sent in the Authorization header and never persisted in browser storage or placed in a URL.
- Dark-first Command Center with repository selection, overview metrics, independently paginated graph nodes/edges, evidence list, paginated Change Passports, and loading/error/empty states.
- Integrated Engine Workbenches for ATLAS, WITNESS, FLARE, CAPSULE, FLIGHT RECORDER, Change Passports, Replay Room and MCP/integrations.
- Graph view renders a radial node-link overview from loaded graph records, with exact node-type filtering, keyboard-operable SVG node selection, table selection, and direct navigation between connected edge endpoints when both nodes are loaded.
- ATLAS node rows are keyboard-accessible inspection controls that reveal the selected node's raw stored fields and exact connected edge records from the loaded graph page.
- Selected ATLAS symbols expose qualified name, kind, file, line range, export state and complexity; Decision/Documentation nodes expose memory kind, decision status, topic, summary, tags and source/supersedes/conflict references.
- File nodes can request a local impact report on demand; evidence records can be selected to inspect their complete stored metadata without exposing raw artifact content.
- Change Passport workbench can fetch the selected passport's version history and compare it with another stored passport through the existing authenticated local API endpoints.
- Evidence timeline orders records newest-first using stored timestamps (falling back to recordedAt), displays valid timestamps, and preserves stable order for equal or missing dates. Workbench filters and bounded evidence views remain data-backed; missing evidence stays unmeasured and the UI does not infer coverage, flakiness, live hardware activity or correctness.
- Graph nodes and edges use independent offsets, and Change Passports can be paged on demand.
- API client tests for token validation, authentication failure handling, URL encoding and abort-signal forwarding.
- API integration coverage for authentication, independent graph pagination offsets, evidence ingestion, validation, Host-header protection and integrity verification.
- Integrity endpoint rate limiting: 60 requests per client per minute, with a Retry-After header and a bounded in-memory client map.

## Local use

1. Start ORBIT's local services from the repository root with `pnpm dev`.
2. Open the dashboard on its loopback Vite address.
3. Locate the private `api.token` file next to the configured local database.
4. Enter the token in the Command Center connection form.
5. Select a registered repository and inspect its stored graph, evidence and passports.
6. Use Engine Workbenches to inspect the available engine-specific evidence views.

Keep `api.token` private. Do not commit it, paste it into an issue, or expose it to browser extensions. Disconnecting clears the in-memory token from the React component state. Reloading the page also clears it.

## Security and evidence boundaries

- Requests use the same-origin `/api/v1` proxy and bearer authentication.
- No token is stored in localStorage, sessionStorage, cookies or URLs.
- Dashboard counts are the bounded API page returned by the server, not claims about complete repository totals.
- Empty evidence/passport states are shown as empty; no demo records or fabricated metrics are inserted.
- This UI does not upload source code to a hosted service, execute builds, control hardware or certify correctness.
- FLIGHT RECORDER displays recorded telemetry only; it does not open serial ports or claim a live device connection.
- Replay Room displays stored reproduction plans without executing commands.

## Remaining work before merge

- Add a richer visual evidence history with event grouping and source-specific drill-down. Current timeline is a chronological view of stored evidence records only.
- Playwright Chromium browser E2E covers connect/disconnect, Authorization-header-only token use, repository switching, graph/evidence/passport navigation, workbench navigation, API failure and empty-workspace states. CI #325 passed these browser tests and the Ubuntu/macOS/Windows check matrix on commit `58120793`. The runner retries CI failures twice, captures trace/video/screenshots on failure, and uses semantic locator fallbacks before failing. CI installs Playwright transiently and uploads diagnostics on failure; it does not add Playwright to the production dependency graph.
- Run keyboard/screen-reader accessibility checks and responsive viewport validation. Accessible labels have been added to ATLAS inspection controls, but this is not a substitute for a full accessibility audit.
- Pass fresh Ubuntu/macOS/Windows CI, including format, lint, typecheck, unit/integration tests and build, plus the new Chromium browser E2E job.
- Verify the API/UI against a real local workspace and document any intentionally deferred capabilities.

The browser E2E suite and cross-platform CI matrix passed in CI #325 on commit `58120793`; CodeQL #119 also passed on that commit. Those historical checks do not validate the current PR head. Fresh CI must pass after the PR #37 timeout fix; keyboard/screen-reader and responsive accessibility checks and the real local-workspace smoke test must also be completed and reviewed.
## Cross-platform rebase verification

- Rebased Prompt 12 onto the stabilized `main` commit `1157869e81507277282fbe3e4c7009a8a44f1dd2` after the test-timeout correction merged in PR #37.
- A fresh CI and Security run is required for the rebased PR head; historical run numbers above are retained only as historical evidence and are not current-head acceptance.
