# ADR-0013: Extend verification engines with bounded adapters and explicit evidence limits

- **Status:** Proposed implementation decision; confirm after branch CI and integrated review.
- **Date:** 2026-11-08
- **Scope:** Prompts 6–8 (WITNESS, FLARE, CAPSULE)
- **Branch:** `feat/prompts-6-8-completion`

## Context

The initial WITNESS, FLARE and CAPSULE prototypes provide a vertical-slice demonstration, but omit practical CI report formats, comparative coverage analysis, reliability diagnostics and common polyglot environment declarations. The project needs useful additions without weakening ORBIT's local-first, evidence-before-confidence principles or silently claiming more than supplied artifacts prove.

## Decision

1. Extend the current `@orbit/atlas` prototype with separate source modules while package boundaries and evidence contracts stabilise:
   - `witness-extended.ts`
   - `flare-extended.ts`
   - `capsule-extended.ts`
2. Expose these functions through the existing ATLAS package barrel and local CLI commands. Do not add hosted services, billing, source uploads, automatic build execution, device commands or network calls.
3. WITNESS:
   - compare baseline and candidate coverage maps using exact repository-relative paths;
   - report missing comparisons as `NOT_COMPARABLE`, not zero;
   - emit deterministic filename-only sensitive-path findings;
   - map changed lines to caller-supplied ATLAS symbol/test references without inventing relationships;
   - render Markdown and SARIF 2.1.0.
4. FLARE:
   - accept bounded pytest JSON, Jest JSON and Go test JSON in addition to JUnit XML;
   - calculate failure clusters and duration summaries from supplied run records;
   - retain minimum sample and pass/fail flip gates; use `suspected-flaky`, not a claim of root cause.
5. CAPSULE:
   - parse additional toolchain, Python dependency, Docker/devcontainer and workspace declarations;
   - hash supplied lockfiles/manifests deterministically;
   - never execute package managers, read actual secret `.env` files or claim the declared versions are the installed versions.
6. Bound input size, manifest count and output size. Explicitly report limitations. New output schemas are versioned.

## Consequences

### Positive

- More useful local PR verification and portable CI report formats.
- More practical test-history analysis while retaining statistical caution.
- Better support for polyglot and embedded software repositories.
- All functionality remains usable offline and does not need a subscription or cloud account.

### Negative / limitations

- The engine implementations remain colocated temporarily in `@orbit/atlas`, which is not the final package decomposition.
- Parsers cover common formats and are not complete implementations of every framework schema/version.
- Coverage comparisons do not imply test attribution or correctness.
- Failure clustering is heuristic; runner duration comparisons are not hardware-normalised.
- Environment inspection represents supplied configuration declarations, not actual host/container state.
- Filename-based secret warnings can produce false positives and cannot detect credentials in ordinary source files.

## Validation required

- Unit tests cover parsing, bounds, deterministic output, regression states, missing data and explicit limitations.
- CLI integration tests exercise report ingestion without writing over existing output files.
- Branch CI must pass format, lint, typecheck, tests and build before this ADR is accepted.
- The end-to-end test strategy must later validate real multi-run history ingestion and a full Change Passport; those are not complete in this ADR.
