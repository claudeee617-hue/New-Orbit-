# ADR-0009: pnpm 10.28 and ESM-only packages

Status: Accepted · Date: 2026-11-07

## Decision
Pin pnpm 10.28.0 via `packageManager` (verified working here; newer majors exist but were not validated). All packages are ESM (`"type": "module"`), built with tsc to `dist/`, consumed via `exports`.

## Consequences
Predictable installs and one module system. CommonJS-only consumers are not supported.
