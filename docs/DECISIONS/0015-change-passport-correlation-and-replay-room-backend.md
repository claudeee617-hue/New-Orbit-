# ADR-0015: Change Passport is a commit-scoped, versioned evidence record

- **Status:** Accepted for the Prompt 10 prototype
- **Date:** 2026-11-08
- **Scope:** Evidence Engine, Change Passport and Replay Room backend

## Context

The evidence engines produce separate artifacts. A useful Passport must correlate them without inventing test results, treating a missing report as zero, mixing evidence from different commits or hiding failing observations.

## Decision

1. A graph-backed Passport is created for an explicit repository, commit SHA and diff SHA-256.
2. Evidence is sourced from immutable ORBIT evidence records. Automatically discovered commit evidence and evidence related to changed files are included only when their `commitSha` exactly matches the Passport commit. Explicit evidence IDs and supplied evidence references are validated against the same repository and commit.
3. The graph correlation computes bounded impact from existing file-import edges and related-test edges. Missing graph facts remain absent; the algorithm does not infer relationships from file names.
4. Completeness is shown as per-dimension `PRESENT`, `PARTIAL`, `MISSING` or `NOT_APPLICABLE` for diff, coverage, tests, CI, environment, build and hardware. There is no composite score.
5. Measurement outcome is separate from presence: the Passport reports `PASS`, `FAIL`, `PARTIAL` or `NOT_MEASURED`. A present report may still contain a failure.
6. Passport content is canonicalized and content-hashed. The graph stores each update as an append-only node version backed by evidence; history remains queryable.
7. Comparison reports evidence, file, finding and completeness changes between two Passports. It does not assign a quality score or infer that a change is safe.
8. The Replay Room backend exposes history, comparison and a human-readable reproduction plan. The plan is advisory; every step is marked `automaticExecution: false`. ORBIT does not execute package managers, builds, tests or hardware commands.
9. A Passport that lacks a telemetry record must say so. Hardware evidence is only linked when a matching, explicitly stored telemetry session is present.

## Consequences

- The same commit cannot accidentally inherit a coverage or CI result from another commit.
- Passports remain auditable through immutable history and underlying evidence IDs.
- The current implementation is a backend/CLI vertical slice. A dedicated Replay Room UI, policy-configurable required dimensions and richer timeline visualizations remain future work.
