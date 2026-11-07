# ADR-0006: Change Passport is immutable, versioned and deterministic

Status: Proposed · Date: 2026-11-07

## Decision
A passport is assembled from stored evidence, serialised canonically and identified by its content hash. New evidence produces a new passport version; old versions remain. The passport never asserts hardware verification without a matching telemetry session.

## Consequences
Replayable and auditable history; storage grows with versions (retention policy is an open question in DATA_MODEL.md).
