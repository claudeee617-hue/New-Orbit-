# ADR-0007: Pin TypeScript 6.0.x

Status: Accepted · Date: 2026-11-07

## Context
The npm registry `latest` for TypeScript is 7.0.2. typescript-eslint 8.72.1 declares a peer range of `>=4.8.4 <6.1.0`.

## Decision
Use TypeScript 6.0.3 until typescript-eslint supports 7.x. Set `types` explicitly in tsconfig (TypeScript 6 no longer auto-includes all `@types`).

## Consequences
Linting stays supported. Revisit when the peer range widens; upgrading is expected to be a contained change.
