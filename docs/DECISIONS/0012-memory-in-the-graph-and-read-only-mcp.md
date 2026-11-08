# ADR-0012: Memory lives in the graph; the MCP server is read-only

Status: Accepted · Date: 2026-11-08

## Context

Prompt 5 adds persistent project memory (decisions, constraints, conventions, known bugs, fixes) and an MCP server so Claude Code can query ORBIT. `docs/DATA_MODEL.md` had planned a separate `memory_items` table.

Memory must be versioned, never silently overwritten, tied to evidence, and must not let an AI-generated summary pass as an engineering decision.

## Decision

1. **Memory items are graph nodes**, not a separate table. Normative categories (architecture decision, design constraint, API contract, team convention, build requirement) are `Decision` nodes; descriptive ones (known bug, historical fix, repository discovery) are `Documentation` nodes. The node key is the stable id `memory/<category>/<slug>`. This reuses what ADR-0010 already guarantees: append-only versions, the evidence requirement, the hash-chained ledger and integrity verification. A separate table would have needed all of that again.
2. **Every version has evidence.** Human-written: `manual`, `PARTIAL`, limitation "ORBIT did not verify the statement". Imported from a repository document: `parser`, `PASS` (the artifact hash is verifiable), with the limitation that ORBIT did not check the code follows it. AI-suggested: `ai-note`, `NOT_MEASURED`. The existing rule that an `ai-note` can never be `PASS` is what keeps AI text non-authoritative.
3. **Authority is explicit.** `human`, `imported` (verbatim from a file) or `ai-suggested`. Only a person can `confirm` an AI suggestion; that is a new version, and the AI version stays in history. `authoritative` is true only for an active, non-AI item whose decision status is not proposed, rejected, deprecated or superseded and that nothing supersedes. Conflict detection ignores everything that is not authoritative.
4. **Staleness is computed, not stored.** A memory is stale only when a file it cites was removed or its SHA-256 differs from the hash recorded when the memory was written or last updated. ORBIT checks the working tree when given a root, otherwise the hashes from the last scan. Anything it cannot check is reported as unverifiable, never guessed. Updating a memory re-baselines its hashes (it means "I checked this against the files now").
5. **Conflicts are reported, never resolved.** Exact: same `topic`, different `choice`. Heuristic (labelled): shared scope plus a prohibitive sentence overlapping a prescriptive one in three or more significant terms. A person invalidates or supersedes one side.
6. **`DOCUMENTS` may now point at `Commit`, `PullRequest` and `Issue`.** A decision or note links to the change that carried it out. Links are made only from text that supports them (commit subject cites `ADR-n`, the memory id or the full title; explicit source references written by a person). PR and issue nodes are inferred from commit subjects and say so; GitHub is not queried.
7. **The MCP server is read-only by construction**: the database is opened with SQLite's read-only flag (writes fail inside SQLite), tools are annotated `readOnlyHint`, inputs are validated with zod, paths are normalised and refused if absolute or containing `..`, and output is capped. Writes happen only through the CLI.
8. **Official SDK 1.32.2, stdio transport.** The v2 branch is not on the `latest` tag.

## Consequences

- No new tables or migrations; the node and edge rule table gained three `DOCUMENTS` targets.
- Memory search is an in-process scan, deterministic and fast for the sizes expected (hundreds to low thousands). Revisit with an FTS index if a workspace holds far more.
- Heuristic conflict detection will miss paraphrases and may flag some false positives; both are stated in its output.
- Commit-message bodies, PR descriptions and issue text are not read yet (Prompt 13).
