# ADR-0008: better-sqlite3 as the SQLite driver

Status: Accepted · Date: 2026-11-07

## Context
Both better-sqlite3 13.0.3 and Node 22's built-in `node:sqlite` loaded in this environment. `node:sqlite` is flagged experimental and emits a warning on Node 22.

## Decision
Use better-sqlite3 through Drizzle ORM. Keep all driver access inside `@orbit/database` so switching is a local change.

## Consequences
Stable, synchronous, well supported. It is a native module: install must be verified on every CI platform, and pnpm needs it in `onlyBuiltDependencies`.

## Update (Prompt 2, 2026-11-07)
better-sqlite3 13 ships prebuilt binaries inside the package (Linux, macOS, Windows; x64 and arm64) and declares `gypfile: false`. pnpm 10 still tried an implicit `node-gyp rebuild` because the package contains `binding.gyp`, which failed where Node headers cannot be downloaded (HTTP 403 from nodejs.org). Decision: do not allow its build script. `pnpm-workspace.yaml` lists it under `ignoredBuiltDependencies`, and the prebuilt binary is used. CI on Windows and macOS is the check that the prebuilds load there.
