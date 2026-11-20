# ORBIT Full Upgrade — Execution Baseline

**Status:** Discovery complete; implementation work is staged behind this branch.
**Base:** `main` (preserved)
**Scope:** Production hardening, product completeness, verification integrity and release readiness.

## Verified repository baseline

The current README and build-state record describe ORBIT as a pre-release TypeScript/pnpm monorepo. The default branch already contains the Core graph and hash-chained ledger, ATLAS scanner and memory, read-only stdio MCP, WITNESS, FLARE, CAPSULE, recorded-file FLIGHT RECORDER, Change Passport backend, local API/CLI, Command Center, opt-in AI preview and GitHub Action prototype.

The root `pnpm run check` is the project-defined validation gate: formatting, lint, typecheck, tests and build. CI currently covers Ubuntu, Windows and macOS, plus MCP stdio acceptance and Chromium browser E2E.

## Upgrade workstreams

### 1. Security and trust-boundary hardening — highest priority
- Re-run the API Host/Origin/authentication boundary tests, including encoded paths and default-deny behavior.
- Review API token file permissions on Windows; `chmod 0600` does not establish a Windows ACL.
- Add focused XSS review for the Command Center's token-in-memory and rendered evidence paths.
- Review MCP prompt-injection boundaries and ensure repository content remains untrusted data.
- Reconcile current code, threat model and security review; retain explicit human-review requirements.

### 2. Evidence integrity and verification UX
- Ensure every UI state preserves `NOT_MEASURED`, partial and stale distinctions.
- Add explicit provenance and limitation display for imported reports and simulator/device recordings.
- Keep AI output separate from verification evidence and prevent automatic promotion or execution.
- Add regression cases for missing, malformed, stale and mismatched evidence.

### 3. Command Center completeness and accessibility
- Audit every panel against `docs/VALIDATION_GAPS.md`.
- Add keyboard and screen-reader coverage, visible focus, reduced-motion support and WCAG AA checks.
- Ensure loading, empty, partial, stale and error states are distinguishable.
- Add browser E2E coverage for evidence selection, Passport history, integrity failures and AI approval boundaries.

### 4. Performance and operational resilience
- Benchmark ATLAS scan time and memory on a committed, documented fixture corpus.
- Add bounded pagination/large-repository regression tests and cancellation behavior.
- Verify database backup/restore and migration rollback guidance without weakening append-only integrity.
- Document support diagnostics that do not expose API tokens or source secrets.

### 5. Release readiness
- Complete clean-machine install checks on supported operating systems.
- Verify package metadata, third-party notices, licensing and release artifacts.
- Publish only after explicit owner approval.

## Acceptance gates

- No changes to `main` from this branch; changes are proposed through a pull request.
- Run `pnpm install --frozen-lockfile` and `pnpm run check` in a clean checkout.
- Run focused API security, parser, MCP and browser E2E suites after each relevant change.
- Review CI results and inspect the final diff for dropped hunks before merge.
- No deployment, Marketplace publication, external telemetry opt-in or paid subscription changes are authorized by this plan.

## Current execution note

This commit records the inspected baseline and implementation gates. It does not claim that tests have run, that an independent security audit has occurred, or that any production deployment has changed.