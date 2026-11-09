# WITNESS verification: FAIL

Repository `sample-repo` · base `bd01b9f787` (bd01b9f7877299105c24bd1d4d2cfea477faad00) · merge base `bd01b9f787` · head `080a9d2fd2` (feature)

> PASS means every measured dimension passed. NOT_MEASURED and INCOMPLETE are never counted as passing. A passing test run does not prove correctness.

## Result by dimension

| Dimension | Status | Detail |
| --- | --- | --- |
| coverage | PARTIAL | 1 of 4 executable changed lines covered (25.0%); 1 of 2 changed source files have no measurable changed lines. |
| tests | FAIL | 1 passed, 1 failed, 0 skipped of 2. |
| build | PASS | Build reported success (as recorded in the supplied file). |
| test-linkage | PARTIAL | 1 of 2 changed source files have a directly linked test (static links, not proof of coverage). |

## Change summary

- Files changed: 3
- Lines: +10 / -1
- Executable changed lines covered: 1 of 4; uncovered: 3
- Changed source files with no coverage data: 1
- Tests: FAIL (1 passed, 1 failed, 0 skipped)
- Build: PASS (`pnpm build`)
- Impacted modules: `src`

## Files

| File | Change | Category | +/- | Changed-line coverage | Linked tests |
| --- | --- | --- | --- | --- | --- |
| `.github/workflows/ci.yml` | added | config | +3/-0 | — | — |
| `src/auth.ts` | modified | source | +1/-1 | NOT_MEASURED | PARTIAL (0 direct, 0 indirect) |
| `src/math.ts` | modified | source | +6/-0 | PARTIAL (1/4) | PASS (1 direct, 0 indirect) |

## Changed symbols

| Symbol | Location | Changed lines | Covered | Uncovered | Coverage |
| --- | --- | --- | --- | --- | --- |
| `login` (function) | `src/auth.ts:1-3` | 1 | 0 | 0 | NOT_MEASURED |
| `div` (function) | `src/math.ts:4-9` | 3 | 1 | 1 | PARTIAL |
| `mul` (function) | `src/math.ts:10-12` | 3 | 0 | 2 | PARTIAL |

## Test failures and regressions

- FAIL `math::div by zero`: expected to throw
- REGRESSION `math::div by zero`: passed → failed
- REGRESSION `math::legacy`: passed → missing

## Findings

### WIT-TEST-FAILURE-d8c57103 — HIGH: Test failed: math::div by zero

expected to throw

- Evidence: JUnit report
- Suggested action: Fix the failing test or the code it exercises.

### WIT-TEST-REGRESSION-e91ea94a — HIGH: Test passed at base and fails at head: math::div by zero

This is a regression relative to the base test report.

- Evidence: base: passed, head: failed
- Suggested action: Restore the test, or confirm it was intentionally removed or renamed.

### WIT-SENSITIVE-FILE-abca1f72 — HIGH: Sensitive file changed: .github/workflows/ci.yml

CI configuration controls what runs with repository credentials. Category: ci-workflow.

- Source: `.github/workflows/ci.yml`
- Evidence: git diff bd01b9f787..080a9d2fd2 touches this path (added)
- Suggested action: Have an owner of this area review the change explicitly.

### WIT-SENSITIVE-FILE-0977e99c — HIGH: Sensitive file changed: src/auth.ts

Path suggests authentication, authorisation or cryptography code. Category: auth-security.

- Source: `src/auth.ts`
- Evidence: git diff bd01b9f787..080a9d2fd2 touches this path (modified)
- Suggested action: Have an owner of this area review the change explicitly.

### WIT-UNCOVERED-LINES-85e36af8 — HIGH: Changed lines not executed by tests: src/math.ts:6

These lines were added or modified in this change and the coverage report records zero executions for them.

- Source: `src/math.ts:6`
- Evidence: coverage entry "src/math.ts" reports hits=0 for lines 6
- Suggested action: Add or extend a test that executes these lines, then regenerate coverage.

### WIT-UNCOVERED-LINES-0d75b726 — HIGH: Changed lines not executed by tests: src/math.ts:10-11

These lines were added or modified in this change and the coverage report records zero executions for them.

- Source: `src/math.ts:10-11`
- Evidence: coverage entry "src/math.ts" reports hits=0 for lines 10-11
- Suggested action: Add or extend a test that executes these lines, then regenerate coverage.

### WIT-UNTESTED-SYMBOL-23b34ee0 — HIGH: function mul changed with no executed changed line

None of the executable changed lines in mul (src/math.ts:10-12) were executed. File-level coverage is not used to infer that this symbol is tested.

- Source: `src/math.ts:10-12`
- Evidence: uncovered changed lines: 10-11
- Suggested action: Add a test that calls mul.

### WIT-TEST-REGRESSION-a5031892 — MEDIUM: Test passed at base but is missing at head: math::legacy

A test that passed on the base is absent from the head report. It may have been renamed or deleted, or it did not run.

- Evidence: base: passed, head: missing
- Suggested action: Restore the test, or confirm it was intentionally removed or renamed.

### WIT-NO-COVERAGE-72a1c474 — MEDIUM: No coverage data for changed file: src/auth.ts

Coverage could not be measured for this file: the coverage report has no entry for this file. A changed file is not assumed to be tested.

- Source: `src/auth.ts`
- Evidence: the coverage report has no entry for this file
- Suggested action: Include this file in coverage instrumentation, or confirm it cannot be executed by tests.

### WIT-NO-RELATED-TEST-602d5d7b — MEDIUM: No test directly linked to src/auth.ts

ATLAS found no test file that imports or is conventionally named for this file.

- Source: `src/auth.ts`
- Evidence: ATLAS TESTS edges and reverse-import walk found no direct test
- Suggested action: Add a test that imports this file, or confirm an existing test exercises it.

### WIT-COVERAGE-REGRESSION-caaf8631 — MEDIUM: Coverage of src/math.ts dropped from 100.0% to 62.5%

Whole-file line coverage is lower at head than at base (instrumented lines only).

- Source: `src/math.ts`
- Evidence: base 100.0% → head 62.5%, threshold 1.0 points
- Suggested action: Cover the new or changed behaviour, or explain why coverage legitimately decreased.

## Relevant architecture decisions

- `docs/DECISIONS/0001-math-module.md` — ADR-0001: Keep arithmetic in src/math.ts (Accepted); mentions `src/math.ts`

## Inputs

- coverage: `lcov.info` sha256 `269c559edc783481…` — PASS
- base-coverage: `base-lcov.info` sha256 `e8688a4967da6a35…` — PASS
- test-report: `junit.xml` sha256 `db4d140fe3b9d873…` — PASS
- base-test-report: `base-junit.xml` sha256 `d3ffc71efc397e31…` — PASS
- build-result: `build.json` sha256 `7983c72902489dea…` — PASS

## Assumptions

- The coverage report is assumed to have been produced from the head commit; ORBIT cannot verify that from the report itself.

## Limitations

- Relevant architecture decisions are found by textual mention of changed paths (heuristic); a decision may apply without naming the path.
- Test linkage uses static imports and naming conventions; calls through dynamic dispatch or reflection are not seen.

_Generated by ORBIT WITNESS 0.1.0._
