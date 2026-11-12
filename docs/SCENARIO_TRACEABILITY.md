# Scenario traceability (S1–S10) — TEST-02

Canonical definitions: `docs/TEST_STRATEGY.md` §4 (not invented here). Date: 2026-11-12.
Evidence rule: a row is **PASS** only for the behaviour its test actually asserts. Gaps are listed, not hidden.
Inputs are synthetic or hand-written parser fixtures; no real CI run, device or live provider was used.

| # | Expected result (TEST_STRATEGY §4) | Automated test | Status | Gap |
| --- | --- | --- | --- | --- |
| S1 | Coverage PASS; no high findings; hardware completeness per config | `packages/witness/src/scenarios.test.ts` › S1 | PARTIAL | Coverage PASS and no high findings asserted; the passport hardware dimension for this case is covered separately by S8, not within the same run |
| S2 | Coverage PARTIAL; exact uncovered lines | witness `scenarios.test.ts` › S2 | PASS | — |
| S3 | Regression finding with before/after | witness `scenarios.test.ts` › S3 | PASS | Before/after asserted as presence of the percentage values in the finding |
| S4 | FLARE suspected/confirmed per sample-size rule | `packages/atlas/src/scenarios.test.ts` › S4 | PARTIAL | "suspected" asserted; the classifier has no "confirmed" state, so TEST_STRATEGY wording ("suspected/confirmed") is only half implemented |
| S5 | CAPSULE lists missing tool; replay plan generated | atlas `scenarios.test.ts` › S5; `passport-engine.test.ts` (reproduction plan) | PARTIAL | Missing dependency diff asserted; plan generation is tested separately, not chained from the same environment diff |
| S6 | ATLAS circular-dependency finding | atlas `scenarios.test.ts` › S6 | PASS | Runtime cycle from a real scan; no "new vs base" cycle comparison |
| S7 | Flight recorder flags crash event; passport links session | atlas `scenarios.test.ts` › S7 | PARTIAL | Watchdog flagged and passport carries the session SHA in memory; graph-persisted link covered by `telemetry-store`/`passport-engine` tests; event name is a watchdog, not a "crash" |
| S8 | Passport: no matching device session; never claims hardware verification | atlas `scenarios.test.ts` › S8 | PARTIAL | Asserts hardware not PRESENT and no session/firmware; the literal phrase "no matching device session" is not emitted by the product |
| S9 | Malformed/missing coverage → INCOMPLETE with reason, not 0% | witness `scenarios.test.ts` › S9 | PARTIAL | Asserts never PASS/0% and a finding exists; observed status may be NOT_MEASURED rather than the INCOMPLETE named in the strategy |
| S10 | Malicious report rejected; nothing read outside root | witness `scenarios.test.ts` › S10 (XXE, traversal, 65 MiB) | PASS | XXE is neutralised and flagged malformed rather than thrown |

## Observed deviations from the written expectations (to resolve by decision, not by weakening tests)

1. No "confirmed" flaky classification exists (S4).
2. S8 never emits the sentence "no matching device session"; it reports the hardware dimension status instead (S8).
3. S9 may report NOT_MEASURED rather than INCOMPLETE (S9).
4. The strategy's fixture repository `fixtures/demo-repository/` does not exist (only `fixtures/hardware-telemetry/`); scenarios use generated fixtures instead.

Owner decision needed: update `docs/TEST_STRATEGY.md` to match behaviour, or change the product. Until then none of S1, S4, S5, S7, S8, S9 is claimed as fully PASS.
