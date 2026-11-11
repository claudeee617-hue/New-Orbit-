# ADR-0016: WITNESS git-based verification model

Status: Accepted · Date: 2026-11-10

## Context
A pull-request verifier is only useful if a green result means something. The common failure modes are treating "the file has coverage" as "the change is tested", treating "tests ran" as "the change is correct", and silently turning missing or broken evidence into a pass.

## Decision
1. **Inputs are evidence files, never executed.** WITNESS reads a Git diff plus LCOV or Cobertura XML coverage, JUnit XML test reports and a small build-result JSON. It never runs tests, builds or repository code. Git is invoked read-only via `execFile` with external-program config neutralised, refs that start with `-` are refused, and file contents come from `git show <head>:<path>` rather than the working tree.
2. **Diff.** The diff is taken from the merge base to head with `--unified=0`, so hunks give exact head-side line numbers: added, modified (replaced) and deletion-only hunks. Renames and binary files are recorded.
3. **Changed-line coverage uses only the changed lines.** Every added or modified head line is classified `covered`, `uncovered` or `non-executable` from the coverage entry of that exact file. A symbol's coverage is derived from its own changed lines (innermost symbol containing the line, ranges from ATLAS extraction at head). File-level coverage is never used to infer that a symbol is tested.
4. **Path matching is conservative.** Exact repository-relative matches win; a suffix match is accepted only when exactly one coverage entry and one changed file claim each other, and is labelled in the report. Ambiguity yields NOT_MEASURED, not a guess.
5. **Status vocabulary** is the graph's: PASS, FAIL, PARTIAL, NOT_MEASURED, INCOMPLETE. Per dimension (coverage, tests, build, test-linkage): no input is NOT_MEASURED; malformed or truncated input, or coverage from a different commit, is INCOMPLETE; PASS requires complete evidence. Uncovered changed lines give PARTIAL; coverage FAILs only against an explicit user threshold (`--min-coverage`), because ORBIT does not invent a policy number. Overall: FAIL if any FAIL; else INCOMPLETE if any INCOMPLETE; else PARTIAL if any PARTIAL or NOT_MEASURED; else PASS. Dimensions that do not apply (for example coverage when only docs changed) are shown as not applicable and ignored.
6. **Tests.** Failures and errors are FAIL. With a base report, tests that passed at base and fail at head are regressions (FAIL); tests that vanished are reported separately (medium). A passing run is reported as "the suite did not fail", not as correctness.
7. **Test linkage** comes from ATLAS static facts (imports and naming), direct versus indirect, and is reported as linkage, not coverage. It needs a graph scan of head: WITNESS scans the working tree only when it is clean and exactly at head, otherwise it uses an existing scan of head from the database, otherwise it says NOT_MEASURED.
8. **Sensitive files** (secrets, CI workflows, auth/security paths, dependency manifests, lockfiles, containers, migrations, infrastructure) are flagged by path rules. This is a review prompt, not a vulnerability scan.
9. **Findings** have a deterministic ID `WIT-<RULE>-<8 hex of sha256(rule, location key, merge base, head)>`, severity, explanation, source location, supporting evidence and a suggested action. Output is Markdown, JSON and SARIF 2.1.0 (`partialFingerprints.orbitFindingId/v1`). Reports contain no timestamps, so identical inputs give byte-identical output.
10. **Persistence is opt-in** (`--record`): a `git` evidence record, one evidence record per input (hash of the input bytes, status, limitations), `Finding` nodes keyed by finding ID and `AFFECTS` edges to File nodes that exist. Re-running with the same inputs writes nothing new.

## Consequences
- Coverage staleness cannot be detected from the report alone; WITNESS states the assumption and offers `--coverage-commit`.
- Architecture decisions are matched by textual mention of changed paths (heuristic and labelled).
- SARIF was validated structurally by tests; the official JSON schema could not be fetched in the build environment, so schema validation against it has not been run.
- Branch coverage, per-test coverage contexts and flaky-test detection are out of scope (FLARE, Prompt 7).
