# Flight-recorder audit (telemetry parsing/analysis/persistence) — AUD-03

- **Date:** 2026-11-12
- **Reviewer:** Claude (AI). **Not an independent review.**
- **Scope:** `packages/atlas/src/flight-recorder.ts`, `flight-recorder-extended.ts`, `telemetry-store.ts`. Recorded telemetry only; **no real hardware was used** (see HW-01, BLOCKED).
- **Tests:** `packages/atlas/src/flight-recorder-audit.test.ts` (6 tests) plus existing suites and fuzzing. Atlas total after this audit: 218 passing.

## Checklist

| Area | Result |
| --- | --- |
| Event classification vs. false anomalies | **Finding R1, fixed** |
| Reset/restart counting | **Finding R2, fixed** |
| Threshold rules that never match | **Finding R3, fixed** |
| Inherited-property unit lookups | **Finding R4, fixed** |
| Session time when recording has no timestamps | **Finding R5, fixed** |
| Persistence (realpath containment, SHA verify, re-parse, transaction) | Reviewed, no defect |
| Never opens serial ports / sends commands | Reviewed, no defect |

## Findings

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| R1 | Medium | "watchdog fed/enabled" was classified as a watchdog anomaly. | Only action wording (timeout, bite, trigger, reset…) counts; otherwise `watchdog_info`. Negation ("no watchdog reset") is a documented limitation. |
| R2 | Low | "restart" was not counted as a reset. | Mapped to `reset`; counters use exact event names; `canonicalEvent` is idempotent. |
| R3 | Medium | A typo'd threshold metric produced no anomalies, reading as compliance. | `unmatchedRuleIds` plus a limitation; persisted with the session. |
| R4 | Low | Metric named `constructor`/`toString` picked up inherited unit values. | `Object.hasOwn`. |
| R5 | Low | Without timestamps the session time silently became ingestion time. | `startedAtSource` recorded and a limitation added when it is ingestion time. |

## Remaining risks

- Event classification is keyword-based; firmware-specific wording needs validation against real device logs.
- Units are source-supplied; nothing is inferred.
- Real serial/hardware behaviour is unverified.
- No independent reviewer has signed off.
