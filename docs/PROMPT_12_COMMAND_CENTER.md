# ORBIT Prompt 12 — Command Center

**Status:** Incomplete implementation on `feat/prompt-12-command-center-final` in draft PR #13, based on updated `main` after Prompt 11 was merged. This is a functional initial vertical slice, not a complete Command Center. Do not merge until fresh Ubuntu/macOS/Windows CI, local API integration tests and browser-level UX validation pass.

## Implemented

- Same-origin API client for authenticated local repository, graph, evidence, passport, ATLAS report and scan endpoints.
- API token entered by the local user, held in page memory only, sent in the Authorization header and never persisted in browser storage or placed in a URL.
- Dark-first Command Center with repository selection, overview metrics, graph-node table, evidence list, Change Passport list, and loading/error/empty states.
- Overview navigation integration while retaining the Business Module.
- API client tests for token validation, authentication failure handling, URL encoding and abort-signal forwarding.

## Local use

1. Start ORBIT's local services from the repository root with `pnpm dev`.
2. Open the dashboard on its loopback Vite address.
3. Locate the private `api.token` file next to the configured local database.
4. Enter the token in the Command Center connection form.
5. Select a registered repository and inspect its stored graph, evidence and passports.

Keep `api.token` private. Do not commit it, paste it into an issue, or expose it to browser extensions. Disconnecting clears the in-memory token from the React component state. Reloading the page also clears it.

## Security and evidence boundaries

- Requests use the same-origin `/api/v1` proxy and bearer authentication.
- No token is stored in localStorage, sessionStorage, cookies or URLs.
- Dashboard counts are the bounded API page returned by the server, not claims about complete repository totals.
- Empty evidence/passport states are shown as empty; no demo records or fabricated metrics are inserted.
- This UI does not upload source code to a hosted service, execute builds, control hardware or certify correctness.

## Remaining work

- Complete the UX specification: sidebar, responsive navigation and dedicated engine views.
- Interactive Engineering Graph and ATLAS symbol/memory drill-down.
- WITNESS coverage/finding screens and FLARE reliability history.
- CAPSULE environment comparison and FLIGHT RECORDER recorded-session playback.
- Change Passport detail, evidence verification and Replay Room compare/timeline.
- Browser-level component tests, keyboard/accessibility pass and full Ubuntu/macOS/Windows CI.
- The separate Prompt 14 experiment in draft PR #21 adds an AI evidence preview/approval panel on a stacked branch; it is not part of PR #13 or `main`.

Prompt 12 is not complete until the remaining screens are implemented, the API/UI behavior is verified against real local data, browser E2E and accessibility tests pass, and the cross-platform CI matrix passes.
