# ORBIT Command Center — Business Module (Prompts 0–3)

**Status:** Implemented as a read-only strategy view. No billing, CRM, subscription or financial ledger is connected.  
**Research snapshot:** 2026-11-08  
**Product boundary:** This module is a planning and market-research surface, not an operating finance system.

## Prompt 0 — Research and problem framing

ORBIT's commercial thesis is to monetise coordination, retained evidence, governance and support rather than restricting local engineering verification.

The initial beachhead is GitHub-centric product engineering teams (roughly 5–50 developers) that repeatedly reconstruct change impact, test history, coverage and environment context. Embedded / IoT engineering is a differentiated expansion because firmware changes, builds and device sessions are often disconnected. It should not be the first sales motion until the software evidence workflow has repeat users.

### Public market reference snapshot

| Vendor / plan | Public price | Unit and billing | Source |
|---|---:|---|---|
| GitHub Team | $4 | Per user / month | https://github.com/pricing |
| JetBrains Qodana | Quote / plan-dependent | Per active contributor; 90-day activity window; minimum 3 | https://www.jetbrains.com/qodana/buy/ and https://www.jetbrains.com/help/qodana/contributors.html |
| Graphite Starter | $20 | Per user / month, annual | https://graphite.com/pricing |
| Graphite Team | $40 | Per user / month, annual | https://graphite.com/pricing |
| CodeRabbit Essentials | $24 | Per developer / month, annual | https://www.coderabbit.ai/pricing |
| CodeRabbit Team | $48 | Per developer / month, annual | https://www.coderabbit.ai/pricing |
| CodeRabbit Advanced | $72 | Per developer / month, annual | https://www.coderabbit.ai/pricing |

The reference points are adjacent developer tools, not direct substitutes. Pricing pages can change; the application displays the research date and links to vendor-owned pages. Qodana's official contributor documentation defines the active-contributor window and minimum licence quantity; its pricing page is a plan selector, so this module deliberately does not infer a universal list price. Tax, region, annual commitments and usage limits may differ.

## Prompt 1 — Business model and packaging

Recommended model: hybrid open-core.

- **Community:** free, local-first and useful without an ORBIT account, hosted service or AI API key.
- **Team:** paid hosted collaboration, shared workspaces, opt-in metadata synchronisation, policy and retention.
- **Enterprise:** private deployment choices, identity, audit, governance, retention and support after operational readiness.
- **Embedded:** specialist firmware/build/device-session workflows after repeated use is validated.
- **Optional AI:** user-enabled and cost-transparent; never the source of truth.

Team pricing of $8–$12 per active contributor / month for early pilots and $12–$18 for a mature annual plan are hypotheses only. Embedded at $49–$199 per engineering workspace / month is also a hypothesis. Enterprise should be quoted only after customer discovery and deployment scope are known.

## Prompt 2 — Module data contract

The UI reads typed, version-controlled strategy data from `apps/web/src/business/model.ts`:

- Product offers and their status labels: core promise, pricing hypothesis or future offer.
- Customer segments, validated pain hypothesis, likely buyer and go-to-market motion.
- Competitor benchmark price, billing unit, relevance caveat and source URL.
- Commercial stages with product goal and exit gate.
- KPI definitions with an explicit **Not measured** state.
- Privacy and trust guardrails.

All values are static research/strategy inputs. There is no claim that the values were loaded from a live business database.

## Prompt 3 — Command Center implementation

The Command Center adds an accessible **Business** navigation view alongside Overview. The screen contains:

1. Hybrid model summary.
2. Four offer cards with explicit maturity labels.
3. Customer segment cards and beachhead.
4. Vendor-linked market benchmark table.
5. Six gated commercial stages (S0–S5).
6. KPI definitions shown as Not measured.
7. Local-first privacy / trust guardrails.

No purchase, billing, CRM, workspace sync, subscription validation, revenue reporting or customer analytics action is exposed. Those require separately designed services, authentication, data retention, export/deletion, threat modelling and operational ownership.

## Acceptance criteria

- All paid price points are labelled as hypotheses or future offers.
- All public benchmark prices link to an official vendor pricing page.
- Every benchmark shows its billing unit and the research date.
- Business KPIs never display invented values.
- The existing Overview and API health interaction remains functional.
- Keyboard-operable navigation exposes the active view with accessible state.
- The web package typecheck, lint, test and build checks pass.
