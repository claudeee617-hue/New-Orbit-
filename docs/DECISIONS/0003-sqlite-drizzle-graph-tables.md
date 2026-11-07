# ADR-0003: SQLite with structured graph tables (Drizzle ORM)

Status: Proposed · Date: 2026-11-07

## Context
We need local-first storage with relationships, history and an append-only ledger.

## Decision
Start with indexed SQLite tables (nodes, edges, evidence, ledger) and Drizzle for typed access and migrations. Do not introduce a graph database without a measured performance need.

## Consequences
Single-file portability and easy testing. Deep traversals may need recursive CTEs; benchmark in Prompt 16 and revisit only with data.
