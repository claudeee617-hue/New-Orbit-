# ADR-0010: Append-only graph, per-repository hash-chained ledger

Status: Accepted · Date: 2026-11-08

## Context
ORBIT's promise is "evidence before confidence". Graph facts must be traceable to evidence, history must not be silently rewritten, and tampering must be detectable.

## Decision
1. **Content-derived IDs.** Repository, node, edge and evidence IDs are SHA-256 prefixes of canonical input, so re-ingesting the same fact is a no-op (`changed: false`) and never creates duplicates.
2. **Versions and tombstones, not updates.** Nodes and edges have an immutable identity row plus append-only `*_versions` rows. Retiring adds a tombstone version. `node_current` / `edge_current` views expose the latest non-deleted state. A retired node may be revived by a later upsert (new version).
3. **Immutability in the database.** SQLite triggers abort every UPDATE and DELETE on all eight graph tables (`ORBIT_IMMUTABLE`). Only `meta` is mutable.
4. **Hash-chained ledger per repository.** Each write appends `(seq, ts, op, entity_kind, entity_id, payload_hash, prev_hash, hash)`; chains start at a 64-zero genesis hash. Separate chains keep repositories independent.
5. **`verifyIntegrity`** recomputes every ledger hash, checks each entry still matches the stored entity, re-derives evidence IDs, and finds records inserted behind the ledger.
6. **Evidence is mandatory.** Every node/edge version cites an existing evidence record in the same repository. Evidence statuses are PASS/FAIL/PARTIAL/NOT_MEASURED/INCOMPLETE; NOT_MEASURED/INCOMPLETE require stated limitations; `ai-note` evidence can never be PASS.
7. **Edge rule table.** Relationship types are only allowed between specific node types; self-loops and cross-repository edges are rejected.
8. **Injected clock** so tests are deterministic.

## Consequences
- Tamper-evidence, not tamper-proofing: someone with file access can drop triggers and rewrite *everything* consistently. The ledger detects partial edits; anchoring the head hash externally (e.g. in a signed commit or CI artifact) is future work.
- Storage grows with history; compaction is out of scope for now.
- Writes cost an extra ledger row and a read of the chain tail, serialised by SQLite's single writer.
