# CAPSULE audit (environment snapshot) — AUD-02

- **Date:** 2026-11-12
- **Reviewer:** Claude (AI). **Not an independent review.**
- **Scope:** `packages/atlas/src/capsule.ts`, `capsule-extended.ts`.
- **Tests:** `packages/atlas/src/capsule-audit.test.ts` (14 tests) plus existing suites and fuzzing.

## Checklist

| Area | Result |
| --- | --- |
| Prototype-pollution safety of maps keyed by file content | **Finding C1, fixed** |
| Secret leakage via version specs / image refs | **Finding C2, fixed** |
| Nested manifests overwriting each other | **Finding C3, fixed** |
| Silent skipping of oversized files | **Finding C4, fixed** |
| Windows path handling | **Finding C5, fixed** |
| Never executes tools or reads the host environment | Reviewed, no defect |

## Findings

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| C1 | High | Maps keyed by package names from untrusted manifests (`__proto__`, `constructor`) used plain objects. | Null-prototype `dict()`, `Object.hasOwn` in comparisons. |
| C2 | High | Credentials embedded in requirement specs, URLs or image references were copied into snapshots/fingerprints. | `redactSecrets` applied to spec and image values. |
| C3 | Medium | Manifests in different directories with the same tool/package overwrote one another. | Keys scoped as `dir::name` for nested manifests. |
| C4 | Medium | Files over 2 MiB were skipped without being reported. | Counted into a limitation line. |
| C5 | Low | Basename and devcontainer path logic broke on backslash paths. | Backslash-safe basename and regex. |

## Remaining risks

- Declarations only: installed versions are never inspected.
- Secret redaction is pattern-based and can miss unusual credential shapes.
- No independent reviewer has signed off.
