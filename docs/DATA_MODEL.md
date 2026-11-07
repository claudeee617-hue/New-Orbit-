# ORBIT — Data Model

Version: 0.1 (planning) · Date: 2026-11-07

## 1. Concepts

- **Node**: an entity in the engineering graph.
- **Edge**: a typed, directed relationship between nodes.
- **Evidence**: an immutable record that supports a node, edge, finding or passport claim.
- **Finding**: a deterministic observation with severity, produced by a rule.
- **Change Passport**: an immutable, versioned bundle correlating evidence for one change.

All records belong to exactly one `repositoryId`. Queries never cross repositories unless explicitly requested.

## 2. Node types

Repository, File, Symbol, Function, Class, Module, Dependency, Commit, PullRequest, Issue, Decision, Documentation, Test, TestRun, CIWorkflow, Environment, Build, Artifact, Firmware, HardwareDevice, TelemetrySession, Finding, ChangePassport.

Common node fields:

| Field | Type | Notes |
|---|---|---|
| id | string | Deterministic: hash of (repositoryId, type, natural key) |
| repositoryId | string | |
| type | enum | from list above |
| key | string | natural key (path, symbol FQN, SHA, …) |
| attrs | JSON | type-specific attributes |
| validFromCommit / validToCommit | string? | temporal bounds |
| createdAt | timestamp | ingestion time |
| sourceEvidenceId | string | provenance |

## 3. Edge types

IMPORTS, CALLS, DEPENDS_ON, MODIFIES, TESTS, BUILDS, RUNS_IN, OBSERVED_ON, INTRODUCES, FIXES, DOCUMENTS, SUPERSEDES, AFFECTS, VERIFIED_BY.

Edge fields: `id`, `repositoryId`, `type`, `fromId`, `toId`, `attrs`, `confidence` (parser confidence, 0–1, only where a parser produced it), `evidenceId`, `validFrom`, `validTo`.

Allowed (from → to) pairs are enforced by a table in `@orbit/core`; invalid relationships are rejected and tested.

## 4. Evidence record

```ts
interface Evidence {
  id: string;                 // content-derived
  repositoryId: string;
  source: string;             // e.g. "ci:github-actions:run/123", "file:coverage/lcov.info"
  sourceType: 'git' | 'coverage' | 'test-report' | 'ci' | 'environment'
            | 'build' | 'telemetry' | 'parser' | 'manual' | 'ai-note';
  timestamp?: string;         // only if the source provides one
  commitSha?: string;
  location?: { path: string; startLine?: number; endLine?: number };
  contentHash: string;        // SHA-256 of the stored artifact
  status: 'PASS' | 'FAIL' | 'PARTIAL' | 'NOT_MEASURED' | 'INCOMPLETE';
  limitations: string[];      // always present, may be empty only if truly none
  relatedEntityIds: string[];
  supersedes?: string;        // new evidence replaces, never edits
}
```

Rules:
- Append-only. Corrections add a new record with `supersedes`.
- `ai-note` evidence is labelled and can never carry status `PASS`.
- Missing or malformed inputs produce `INCOMPLETE` or `NOT_MEASURED` with a reason, never an implied zero.

## 5. Immutable event ledger

Every insert/supersede is written to `ledger(seq, ts, op, entityKind, entityId, hash, prevHash)` forming a hash chain so tampering is detectable. Verified by a graph-consistency test.

## 6. Finding

`id` (stable: hash of ruleId + normalised location + subject), `ruleId`, `severity` (`info|low|medium|high`), `title`, `explanation`, `location?`, `evidenceIds[]`, `suggestedAction`. No numeric risk score.

## 7. Domain tables (engine-specific)

| Table | Used by | Key columns |
|---|---|---|
| symbols | ATLAS | id, fileId, name, kind, startLine, endLine, parser, confidence |
| memory_items | ATLAS | id, category, body, sourceRefs[], version, status (active/stale/invalidated) |
| diff_hunks | WITNESS | id, commitRange, path, addedLines[], deletedLines[] |
| coverage_records | WITNESS | evidenceId, path, line, hits, format |
| test_runs | FLARE | testId, runId, commit, outcome, durationMs, failureSignature, env |
| env_manifests | CAPSULE | commit, fingerprint, tools[], lockfiles[], envVarNames[] |
| telemetry_sessions | FLIGHT RECORDER | id, deviceLabel, firmwareBuildId?, commitSha?, startedAt, rawArtifactHash, isDemo |
| telemetry_events | FLIGHT RECORDER | sessionId, ts, kind, key, value, unit |
| passports | Evidence Engine | id, version, commit, baseSha, diffHash, contentHash, body JSON |

## 8. Change Passport schema

```ts
interface ChangePassport {
  id: string;              // derived from contentHash
  version: number;
  repositoryId: string;
  commitSha: string;
  baseSha: string;
  diffHash: string;
  createdAt: string;
  impact: { nodeIds: string[]; edgeIds: string[] };
  evidence: EvidenceRef[];            // refs only, with hashes
  findings: FindingRef[];
  missingVerification: MissingItem[]; // explicit, e.g. "no hardware session for build X"
  environment?: { manifestId: string; fingerprint: string };
  builds: BuildRef[];
  hardwareSessions: SessionRef[];     // empty unless a matching session exists
  completeness: CompletenessReport;   // per-dimension, rule-based
  contentHash: string;
}
```

`CompletenessReport` lists each dimension (diff, coverage, tests, CI history, environment, build, hardware) as `PRESENT | PARTIAL | MISSING | NOT_APPLICABLE` with the rule that decided it. There is no aggregated percentage.

Determinism: passport JSON uses canonical ordering; the same evidence set must produce the same `contentHash`.

## 9. Indexing plan

Indexes on (repositoryId, type, key), edges (repositoryId, fromId, type), edges (repositoryId, toId, type), evidence (repositoryId, commitSha), test_runs (testId, ts), telemetry_events (sessionId, ts).

## 10. Open questions

1. Symbol identity across renames/moves (hash of FQN vs. similarity tracking).
2. Retention and compaction policy for large telemetry and test history.
3. Whether the ledger hash chain is per repository or global.


## 11. Implemented in Prompt 3 (ORBIT Core)

Authoritative sources: `packages/core/src` (vocabulary, rules, schemas, hashing), `packages/database/src/schema.ts` and migrations `0001`/`0002`, `packages/database/src/store.ts`, `packages/graph/src`. Rationale: ADR-0010.

- **Tables:** `repositories`, `evidence`, `evidence_refs`, `nodes`, `node_versions`, `edges`, `edge_versions`, `ledger` (plus mutable `meta`). All graph tables are append-only (triggers).
- **Views:** `node_current`, `edge_current` (latest non-deleted version).
- **Node types (23)** and **edge types (14):** see `NODE_TYPES` / `EDGE_TYPES`; allowed endpoint pairs in `EDGE_RULES`.
- **Evidence fields:** repository, source, source type, timestamp, commit SHA, location (path + line range), content hash, status, limitations, related entity IDs, supersedes. Each evidence record can be superseded at most once.
- **Not yet implemented:** Finding, Change Passport and engine-specific domain tables (later prompts).
