# Contributing to ORBIT

Thanks for considering a contribution. ORBIT follows **evidence before confidence**: describe what changed, show how it was tested, and state what remains unverified.

## Before you start

- Read [README.md](README.md), [ORBIT_BUILD_STATE.md](ORBIT_BUILD_STATE.md), [the architecture](docs/ARCHITECTURE.md), [the threat model](docs/THREAT_MODEL.md) and [the test strategy](docs/TEST_STRATEGY.md).
- For substantial changes, open an issue or discussion first so scope and package boundaries can be agreed.
- Do not include credentials, private repository contents or real device identifiers in fixtures.
- Do not add dependencies without explaining why a built-in or existing dependency is insufficient.

## Development

Requirements: Node.js 22.12+ and pnpm 10.28.0.

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm dev
```

The full check runs formatting, lint, typechecking, tests and production builds. Run it before opening a PR.

## Engineering rules

- Keep Core deterministic and local-first.
- Never fabricate measurements, test outcomes, CI status, device events or confidence scores.
- Missing evidence must be explicit; do not turn missing data into a zero or PASS.
- Do not automatically execute untrusted repository code.
- Keep the API loopback-only unless a reviewed design explicitly changes that boundary.
- Keep MCP tools read-only and bounded.
- AI is optional, opt-in and advisory; it must not mutate the graph or apply code changes automatically.
- Preserve repository isolation and append-only evidence history.
- Add tests for parsers, limits, invalid input, Windows paths, repository boundaries and security regressions.
- Update `ORBIT_BUILD_STATE.md` and relevant docs when scope or limitations change.

## Pull requests

Include:
1. Problem and intended behavior.
2. Scope and non-goals.
3. Tests run and exact results (or state that they were not run).
4. Security/privacy impact and any new network or credential flow.
5. Screenshots for user-facing UI, with demo data labelled.
6. Known limitations and follow-up work.

Do not mark a PR ready while CI is failing or required checks are still running. Avoid bundling unrelated refactors with feature work.

## Reporting vulnerabilities

Do not disclose exploitable issues in public PRs. Follow [SECURITY.md](SECURITY.md).
