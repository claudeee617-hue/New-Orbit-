# ADR-0001: Local-first, deterministic core, evidence before confidence

Status: Proposed · Date: 2026-11-07

## Context
Developers distrust AI output they cannot verify. ORBIT's value is traceability, not generation.

## Decision
- Core analysis is deterministic and runs locally without network access or API keys.
- AI is an optional layer that explains stored evidence and must cite it.
- No arbitrary confidence or risk percentage; completeness is rule-based and explained.
- Missing data is reported as NOT_MEASURED/INCOMPLETE, never implied zero.

## Consequences
Reports may look less "smart" than LLM summaries but are auditable. Some questions need AI and will be unavailable without a provider; that is reported plainly.
