# ORBIT — Build State

Durable progress log. Update after every implementation phase.
Last updated: 2026-11-07

## Current phase

**Prompt 0 — Project brain and master plan: COMPLETE (documents only)**

## Phase checklist

| Prompt | Scope | Status |
|---|---|---|
| 0 | Master plan and planning documents | Done (docs only, no code) |
| 1 | Technical design and architecture finalisation | Not started |
| 2 | Monorepo foundation | Not started |
| 3 | ORBIT Core graph | Not started |
| 4 | ATLAS scanning | Not started |
| 5 | ATLAS memory and MCP | Not started |
| 6 | WITNESS | Not started |
| 7 | FLARE | Not started |
| 8 | CAPSULE | Not started |
| 9 | FLIGHT RECORDER | Not started |
| 10 | Change Passport and Replay Room | Not started |
| 11 | API and CLI | Not started |
| 12 | Command Center | Not started |
| 13 | GitHub Action | Not started |
| 14 | ORBIT AI | Not started |
| 15 | Security review | Not started |
| 16 | Testing and validation | Not started |
| 17 | Release polish | Not started |

## Files created in Prompt 0

- ORBIT_MASTER_PLAN.md
- ORBIT_BUILD_STATE.md
- docs/PRD.md
- docs/ARCHITECTURE.md
- docs/DATA_MODEL.md
- docs/ROADMAP.md
- docs/COMPETITIVE_ANALYSIS.md
- docs/THREAT_MODEL.md
- docs/UX_SPECIFICATION.md
- docs/TEST_STRATEGY.md
- docs/DECISIONS/0001 … 0006 (ADRs)

## Test results

None. No code exists yet.

## Unresolved issues / open questions

1. Competitor claims for CodeGraph, CodeCortex, Chisel and PatchProof (from the original idea notes) were **not verified**; web search returned many unrelated repositories. Marked "unverified" in COMPETITIVE_ANALYSIS.md. Re-check before any public positioning.
2. Project name availability (GitHub org, npm scope, domains, trademarks) not checked.
3. Exact library versions (Node, Fastify, Drizzle, Vitest, MCP SDK, tree-sitter bindings) must be verified at install time in Prompt 2. Research found the MCP TypeScript SDK at v1.27.1 (Feb 2026) with a breaking v2 branch in progress, so pin and re-check.
4. Licence not yet committed. Target: Apache-2.0.
5. Nothing has been pushed to GitHub. Do not push without explicit instruction.

## Next step

Prompt 1: turn the plan into an implementation-ready technical design (package boundaries, interfaces, Mermaid diagrams), still without application code.
