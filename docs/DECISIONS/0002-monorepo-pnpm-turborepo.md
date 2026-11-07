# ADR-0002: Monorepo with pnpm workspaces and Turborepo

Status: Proposed · Date: 2026-11-07

## Context
Multiple apps and ~13 packages share types and need independent builds and tests.

## Decision
Use pnpm workspaces plus Turborepo for task orchestration and caching. Verify current versions at install time (Prompt 2).

## Consequences
Fast incremental builds and clear boundaries; contributors need pnpm. Alternative considered: npm workspaces (simpler, slower caching).
