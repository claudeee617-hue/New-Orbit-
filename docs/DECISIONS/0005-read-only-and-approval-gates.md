# ADR-0005: Read-only by default, explicit approval for execution and hardware

Status: Proposed · Date: 2026-11-07

## Decision
- Repository content is never executed automatically.
- CAPSULE replay, device connections and any source/config modification require explicit local approval, with logged output as new evidence.
- MCP tools are read-only.
- GitHub Action analyses diffs and reports; it never runs PR-supplied commands and never uses `pull_request_target` to execute untrusted code.

## Consequences
Safer defaults; some workflows need an extra confirmation step.
