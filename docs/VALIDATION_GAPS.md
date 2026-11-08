# ORBIT Validation Gaps

**Status:** Living checklist. A listed gap is not an implemented feature.

## Prompt 12 — Command Center

- Interactive node-link graph with filters, edge navigation and evidence drill-down.
- ATLAS architecture/symbol/memory screens.
- WITNESS change/coverage/findings and SARIF export screens.
- FLARE test history, failure clusters, duration and sample-size views.
- CAPSULE environment snapshots and comparisons.
- FLIGHT RECORDER session list, charts, timeline and crash inspection.
- Change Passport details, history, comparison and completeness.
- Replay Room timeline and comparison UI.
- Evidence Explorer hash verification.
- MCP & AI, Integrations and Settings.
- Responsive sidebar/mobile navigation, keyboard operation, WCAG AA review and reduced-motion handling.
- Playwright end-to-end tests against a real local API and fixture workspace.

## Prompt 13 — GitHub Action

- Run on Ubuntu, macOS and Windows.
- Validate pull_request event and merge-base behavior for same-repository and fork PRs.
- Prove PR head code is never executed.
- Test optional comment upsert and duplicate prevention.
- Test read-only fork token behavior.
- Validate SARIF against the SARIF 2.1.0 schema and permissions.
- Add test-report ingestion and FLARE historical summaries.
- Add per-line annotations only when they can be mapped to real changed-line evidence.
- Release/tag/Marketplace readiness review.

## Prompt 14 — ORBIT AI

- No implementation currently shipped.
- Implement provider adapters only after official API contracts are re-verified.
- Explicit opt-in, exact context preview, redaction, per-request approval and no-network-by-default tests.
- Citation validation, prompt-injection tests, bounded requests/responses and provider retention disclosure.
- AI output must never be promoted to verification evidence or applied automatically.

## Prompt 15 — Security

- Independent review of API Host/Origin/CSRF/DNS-rebinding behavior.
- Path traversal, symlink escape, XML entity, decompression and parser resource tests.
- Secret redaction and report export review.
- MCP prompt-injection boundary and output caps.
- Local API token file permissions and Windows ACL review.
- Dependency audit and CodeQL review.
- Review of GitHub Action permissions and fork threat model.
- Review every new network, provider and hardware boundary.

## Prompt 16 — Testing

- Add Playwright or equivalent browser E2E infrastructure.
- Complete controlled scenarios S1–S10 from docs/TEST_STRATEGY.md.
- Add migration tests across supported schema versions.
- Add SARIF schema validation.
- Add action event fixtures and local action runner tests.
- Add fuzz/property tests for untrusted parsers.
- Measure performance on a documented fixture repository; do not publish unmeasured claims.

## Prompt 17 — Release

- Clean-machine install walkthrough on all supported OSs.
- Confirm package metadata, licensing, third-party notices and trademark availability.
- Versioning, changelog, release automation and rollback instructions.
- Publish only after explicit owner approval.
