# ORBIT — Test Strategy

Version: 0.1 · Date: 2026-11-07

## 1. Rules

- A feature is complete only when its tests pass. Tests are never weakened to make a build pass.
- Every phase ends with a recorded test run (exact output summary in `ORBIT_BUILD_STATE.md`).
- Performance claims come only from reproducible benchmarks.

## 2. Test layers

| Layer | Tooling | Scope |
|---|---|---|
| Unit | Vitest | Parsers, hashing, graph ops, statistics, rules |
| Contract | Vitest | Every adapter implements its interface (language parser, coverage, test report, transport, AI provider) |
| Integration | Vitest | Engines + SQLite on fixture repos |
| API | Vitest + Fastify inject | Endpoints, auth token, loopback binding |
| CLI | Vitest + child process | Commands, JSON mode, exit codes, Windows/Unix paths |
| MCP | MCP client harness | Tool schemas, bounded output, evidence citations |
| GitHub Action | Local runner + recorded events | Comment upsert, annotations, fork safety |
| Migration | Vitest | Schema upgrades preserve data |
| Security | Vitest | Path traversal, XXE, size limits, redaction, no auto-exec |
| End-to-end | Playwright | Command Center flows against demo workspace |
| Benchmarks | Custom scripts | Indexing, traversal, report generation, large-log ingestion |

## 3. Fixture repository

`fixtures/demo-repository/` contains: a TypeScript backend, a Python component, an ESP32/STM32-style C/C++ firmware component, unit tests, CI result files (JUnit/pytest/Jest/Go JSON samples), LCOV and Cobertura reports, environment manifests (lockfiles, Dockerfile, devcontainer), and synthetic telemetry in `fixtures/hardware-telemetry/` (all labelled DEMO).

## 4. Controlled scenarios with expected results

| # | Scenario | Expected result |
|---|---|---|
| S1 | Clean change, fully covered, all tests pass | Coverage PASS; no high findings; completeness shows hardware NOT_APPLICABLE or MISSING per config |
| S2 | Uncovered changed lines | Coverage PARTIAL; finding lists exact uncovered lines |
| S3 | Coverage regression vs. base | Regression finding with before/after |
| S4 | Flaky test | FLARE marks suspected/confirmed according to sample-size rule |
| S5 | Missing environment dependency | CAPSULE comparison lists missing tool; replay plan generated |
| S6 | Architecture dependency breakage (new cycle) | ATLAS circular-dependency finding |
| S7 | Firmware watchdog event | FLIGHT RECORDER flags crash event; passport links the session |
| S8 | Missing hardware evidence | Passport lists "no matching device session"; never claims hardware verification |
| S9 | Malformed/missing coverage file | INCOMPLETE with reason, not 0% |
| S10 | Malicious report (XXE, traversal, huge file) | Rejected with safe error; no file read outside root |

## 5. Specific correctness tests

- Git diff parsing: renames, binary files, added/deleted/modified lines, no-newline-at-EOF.
- LCOV/Cobertura parsing, path normalisation (Windows backslashes, relative vs. absolute).
- Wilson interval values against hand-computed references; low-sample handling (e.g. 1 fail in 3 runs is "suspected", not "confirmed").
- Graph: duplicates, invalid edges, historical versions, traversal determinism, repository isolation, hash verification.
- Passport: same evidence ⇒ same content hash; changed evidence ⇒ new version.
- Telemetry parser: malformed lines, overlong lines, unit handling, reset/watchdog detection.
- SARIF output validates against the 2.1.0 schema.
- PR comment upsert never creates duplicates.

## 6. Benchmarks (to be measured, never assumed)

Index time vs. repo size; graph traversal depth vs. latency; report generation time; ingestion throughput for large logs. Results are stored with machine details in `docs/benchmarks/`.

## 7. CI

Matrix over Windows, macOS, Linux; jobs for lint, typecheck, unit, integration, security, e2e, dependency audit. Coverage of ORBIT itself reported but not treated as proof of quality.
