# Evidence-engine prototype scope

This document describes the first cross-engine integration prototype. It is deliberately explicit about what works and what remains unimplemented.

## WITNESS — changed-line coverage

Input: a unified Git diff plus one LCOV or Cobertura report.

Output: added lines per file, measured/covered/uncovered counts, percentage over measured lines, stable finding IDs and a status. Missing coverage is `INCOMPLETE`, not zero coverage. A reported hit is execution evidence only, not proof of correctness.

The prototype currently handles added lines in ordinary unified-diff hunks. Renames, deleted lines, binary diffs and ambiguous source-path matching have limited or excluded handling.

## FLARE — JUnit and test history

Input: a JUnit XML report or an ordered array of test outcomes.

Output: per-test pass/fail/skip counts, duration, failure rate, outcome-flip count and a Wilson 95% interval. The default minimum sample count is eight and the default minimum flip count is three before a test can be labelled `suspected-flaky`.

A report containing one execution is not historical evidence. Persistent ingestion across CI runs and adapters for Jest, pytest and Go are not implemented.

## CAPSULE — declared environment snapshot

Reads only explicitly supplied configuration/manifest files. It records runtime constraints, package-manager declarations, dependencies, scripts, environment variable names from example files, container configuration filenames and lockfile SHA-256 values.

It does not read `.env` files, discover installed packages, inspect the host OS image, or execute build/test commands.

## FLIGHT RECORDER — recorded telemetry

Parses JSON, NDJSON, CSV and key-value text logs. It stores a SHA-256 digest of the raw input and extracts numeric metrics and event labels. Watchdog/reset counts are keyword-based and should be interpreted against the firmware logging contract.

It does not open serial ports, issue commands or claim that a synthetic sample came from a physical board.

## Change Passport

Assembles a deterministic, content-hashed evidence bundle from an explicit input object. Missing git, coverage, test-report and CI evidence is listed. Optional environment and telemetry hashes can be attached.

It is not yet a persistent graph entity. Full cross-engine correlation, build artifact verification, device/firmware identity validation and Replay Room remain future work.

## Local CLI

- `orbit verify <diff-file> --lcov <file>`
- `orbit verify <diff-file> --cobertura <file>`
- `orbit flare summarize <junit-file>`
- `orbit capsule inspect <repository>`
- `orbit capsule compare <before-json> <after-json>`
- `orbit device replay <log-file>`
- `orbit passport create <input-json>`

All report output is local. `--out` writes a new file and refuses to overwrite.
