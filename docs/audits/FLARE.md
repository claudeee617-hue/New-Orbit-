# FLARE audit (flaky-test analysis) — AUD-01

- **Date:** 2026-11-12
- **Reviewer:** Claude (AI, same author/maintainer lineage as the code). **Not an independent review.** Fuzz-clean is not the same as audited; this is a code review plus targeted regression tests.
- **Scope:** `packages/atlas/src/flare.ts`, `flare-extended.ts` (JUnit, pytest JSON, Jest JSON, Go test JSON parsers; history summary/analysis; failure signatures).
- **Tests:** `packages/atlas/src/flare-audit.test.ts` (19 tests) plus the existing FLARE suites and seeded parser fuzzing.

## Checklist

| Area | Result |
| --- | --- |
| Hostile/huge input bounds (size, count, nesting) | Reviewed, existing limits kept |
| Numeric sanitation of durations | **Finding F1, fixed** |
| Outcome mapping per framework | **Finding F2, fixed** |
| Test-id parsing with parameters | **Finding F3, fixed** |
| Failure-signature stability and ReDoS | **Finding F4, fixed** |
| Go message leakage on passing tests | **Finding F5, fixed** |
| Determinism of summaries | Reviewed, no defect |

## Findings

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| F1 | Medium | JUnit `time` blank, negative, huge or non-numeric values flowed into durations (blank became 0, negatives/huge skewed stats). | `sanitizeDuration` returns null outside 0..1e9 s. |
| F2 | Medium | pytest `xfailed`/`xpassed` and `disabled` outcomes were not mapped correctly; mixed-phase precedence undefined. | xfailed/disabled → skipped, xpassed → passed; precedence failed > skipped > passed. |
| F3 | Low | pytest node ids with `::` inside parameters were split wrongly. | Split only before the first `[`. |
| F4 | Medium | Failure-signature location masking used a pattern with super-linear behaviour on long input; URLs were not masked before locations. | Linear `maskLocations`, 4000-char input cap, URL masking first, exported `failureSignature`. |
| F5 | Low | Go message text attached to non-failed tests. | Message only when failed. |

## Remaining risks

- Framework formats are parsed from fixtures and recorded shapes, not every version of every framework.
- Flakiness conclusions depend on the supplied history; FLARE never reruns tests.
- No independent reviewer has signed off.
