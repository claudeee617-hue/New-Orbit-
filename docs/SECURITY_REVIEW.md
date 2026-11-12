# ORBIT Security Review — local API and GitHub Action (SEC-01)

**Reviewer:** Claude (AI engineering agent), 2026-11-12, against `main` @ `65c90cf`.
**Sign-off status:** **Independent human review NOT obtained.** This is a code-level review by the same agent family that wrote much of the code, so it is not independent. It must not be presented as an independent audit. A human reviewer who did not write the code should still review the threat model and findings below.

## 1. Assets and trust boundaries

| Asset | Where | Boundary |
| --- | --- | --- |
| Evidence graph / ledger (append-only, hash-chained SQLite) | `ORBIT_DB_PATH` | API process ↔ browser/CLI clients |
| Local API session token | `api.token` beside the database, or `ORBIT_API_TOKEN` | Same-OS-user processes ↔ other local users ↔ web pages |
| Repository contents scanned by ATLAS | Paths supplied to the API/CLI | Untrusted repository data → parsers (never executed) |
| CI runner secrets / filesystem | GitHub Actions runner | Fork PR head (untrusted) → Action |

Attackers considered: (a) a web page the user visits (cross-site and DNS-rebinding), (b) another user or process on the same machine/network when the API is exposed, (c) a malicious pull request author (including forks), (d) malicious report/diff/telemetry files.
Out of scope: malware already running as the same OS user (it can read the token file and the database directly), physical access, GitHub's own platform security.

## 2. Request lifecycle (API)

`onRequest` hook, in order: (1) Host allow-list → 403 `FORBIDDEN_HOST`; (2) Origin allow-list when an `Origin` header is present → 403 `FORBIDDEN_ORIGIN`; (3) route-based default-deny: every matched route except `/health` requires `Authorization: Bearer <token>` (constant-time compare) → 401. Unmatched URLs reach the 404 handler and return no data. Body limit 2 MiB + 64 KiB, JSON only (form/multipart/text bodies are refused or fail validation). Error bodies for 5xx are generic. Expensive reads are rate-limited (60/min/client).

Why CSRF is not a classic risk: authentication is a bearer header, never a cookie, so browsers never attach credentials automatically; the API emits no CORS headers, so cross-origin scripts cannot read responses or pass a preflight for `Authorization`. Defence in depth: the Origin check also blocks cross-site requests that already know the token.

## 3. Findings

| ID | Severity | Finding | Disposition | Regression test |
| --- | --- | --- | --- | --- |
| SEC-F1 | **High** | **Auth bypass regression on `main`.** The squash of PR #23 silently reverted PR #32's API fixes: the auth hook decided on `request.url.startsWith('/api/v1/')`, which percent-encoded paths (e.g. `/%61pi/v1/…`) bypass, plus lost input validation and error codes. | Fixed: route-based default-deny and the lost validation/tests restored (re-applied PR #32's API diff). | `apps/api/src/server.test.ts` (encoded-path, default-deny cases), `security.test.ts` |
| SEC-F2 | Medium | Host parsing accepted trailing garbage after an IPv6 literal (`[::1]evil`), non-numeric/out-of-range ports and other non-`host[:port]` shapes. Not exploitable from a browser today but weakens the rebinding allow-list. | Fixed: strict `host[:port]` grammar; anything else is rejected. | `security.test.ts` › Host header |
| SEC-F3 | Medium (hardening) | No `Origin` enforcement; protection against cross-site use relied on bearer-header + absent CORS alone. | Fixed: any request carrying an `Origin` that is not an allowed local host (or is `null`/opaque/has userinfo/path) is refused. CLI/curl/same-origin dev proxy send no Origin and are unaffected. | `security.test.ts` › Origin header |
| ACT-F1 | Medium | Action `coverage-file` was contained with a lexical `resolve()` check, then read through symlinks. A PR could commit `coverage.lcov` as a symlink to a runner file. | Fixed: symlinks refused (`lstat`), real-path containment re-checked. | `orbit-action.test.mjs` (symlink file, symlinked directory) |
| ACT-F2 | Medium | Composite Action referenced `actions/*`, `pnpm/action-setup`, `github-script`, `codeql-action` by mutable tag (and used the deprecated `upload-sarif@v3`). | Fixed: every step pinned to a full commit SHA with the tag in a comment; `upload-sarif` moved to v4. Dependabot keeps SHAs current. | `orbit-action-security.mjs` (pin policy test) |
| ACT-F3 | Medium | The runtime pinned by the Action (`fde44b7`) predated later parser/security fixes. | Fixed: pin bumped to reviewed `65c90cf`; the Action integration workflow and 9 script tests ran against it. Keep bumping only after review. | `orbit-action-test.yml`, `orbit-action.test.mjs` |
| ACT-F4 | Info | Action inputs reach shell steps only through `env:`; no `pull_request_target`; default `contents: read`. | Verified; now asserted. | `orbit-action-security.mjs` |

## 4. Abuse cases covered by automated tests

DNS rebinding (hostile hostnames, suffix/prefix tricks, userinfo, ports, missing Host over a real socket); cross-site requests with and without a valid token; CORS header absence and preflight; cookie/Basic/lowercase-scheme/whitespace/truncated/extended credentials; token in query string; form/multipart/text bodies; token and Authorization never logged or echoed; extra allowed host handling.

## 5. Accepted residual risks (owner: project maintainer)

1. **Windows token file ACL not verified.** `chmod 0600` is a no-op on Windows; the file inherits the directory ACL. Keep the database under the user profile. Needs a human review on a Windows host.
2. **`ORBIT_ALLOW_NON_LOOPBACK=true`** exposes the API over plain HTTP; the token travels unencrypted and `0.0.0.0` is not a valid Host value for remote clients. Documented as unsupported for untrusted networks; put a TLS reverse proxy in front.
3. `/health` is unauthenticated and discloses the service version and schema version (by design for liveness probes).
4. Only expensive reads are rate-limited; token guessing (256-bit) is infeasible but 401s are not throttled.
5. The Command Center keeps the pasted token in page memory; XSS in the dashboard would expose it. No stored XSS sink was found but the web app has not had an XSS-focused review.
6. Same-OS-user malware is out of scope.
7. PR comment upsert matches existing comments by bot type plus marker; a different bot that reproduces the marker only causes a caught 403 warning.

## 6. Process finding

Two squash merges on 2026-11-11 silently reverted already-merged fixes (evidence ordering from #36, API hardening from #32) because stacked PR branches predated them. CI stayed green because the reverted tests were removed with the code. Mitigation: after merging stacked PRs, diff the merge result against the previous main for dropped hunks. The scan used to find SEC-F1 is described in `ORBIT_BUILD_STATE.md`.
