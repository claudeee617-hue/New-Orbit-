# ORBIT Command Center — Business Module (Prompts 0–5)

**Status:** Prompts 0–5 are implemented as local-only strategy, planning, unit-economics and opportunity-operations surfaces. No billing, CRM, subscription or financial ledger is connected.  
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


## Prompt 4 — Business intelligence and unit economics

**Status:** Interactive, local-only business intelligence inputs and simulator. This is not a connected accounting, billing or CRM system.

### Delivered capabilities

- Actual-versus-forecast input cards for revenue, operating expenses and paying-customer counts.
- Derived period profit, profit margin, forecast revenue change and revenue per paying customer. Percentages with missing or invalid denominators display as unavailable.
- Relative revenue comparison bars, scaled consistently to the larger of actual and forecast revenue.
- INR / USD display selection; it changes formatting only and does not perform currency conversion.
- Pricing and profitability simulator for monthly price per seat, variable cost per seat, fixed monthly cost and target paid seats.
- Derived monthly revenue, variable and total costs, profit/loss, margin, contribution per seat and break-even seats. Break-even is unavailable when contribution per seat is zero or negative.
- Customer panel distinguishes user-entered counts from connected customer records. Cohort, churn, CAC, retention and segment analytics remain unavailable until a consented and reviewed source exists.

### Data and privacy boundary

- Inputs are held in React page state only. They are not sent to the local API, persisted to disk, or retained after refresh.
- Empty inputs calculate as zero; count fields accept whole numbers only. Negative, non-finite and out-of-range values are normalised by the calculation layer.
- All values are marked user-entered / not connected. No demo revenue or fabricated customer records are seeded.
- Currency selection is display-only. No exchange rates, tax treatment, accounting recognition or invoice reconciliation is inferred.
- Do not enter payment-card data, personal customer details, secrets or other sensitive records.

### Acceptance criteria

- Calculations are deterministic and independently unit-tested, including zero denominators, losses, invalid values and break-even edge cases.
- User edits recalculate dependent metrics immediately without a backend request.
- Revenue bars share a common maximum scale; neither side is incorrectly fixed at 100%.
- The financial surface remains explicitly disconnected from live accounting, payments, CRM and analytics.
- The web package passes formatting, lint, typecheck, test and production build checks.


## Prompt 5 — Local commercial operations workspace

**Status:** Implemented on the feature branch; CI and review pending. This is a local planning tracker, not a connected CRM or source of revenue truth.

### Delivered capabilities

- Opportunity records for discovery, qualified, pilot, won and lost stages.
- Segment classification for product engineering, embedded / IoT, open source, consultancy and enterprise.
- Estimated monthly opportunity value, next action, follow-up date and evidence / discovery notes.
- Derived open-account, qualified, active-pilot, due-follow-up and open-pipeline estimate summaries.
- Filters by open pipeline or individual stage; edit and delete actions.
- Browser-local persistence under a versioned key; no server, API or cloud sync.
- Versioned JSON import/export with size, schema, field, date, value, record-count and duplicate-ID validation.
- Explicit empty states: no demo accounts, opportunities or revenue are seeded.

### Privacy and data boundary

- Browser local storage is scoped to the current browser profile and device; it is not encrypted by this app and may be cleared by browser settings.
- Users should store organisation-level labels only; do not enter personal customer data, credentials, payment-card data or secrets.
- Currency selection formats the estimate only; it does not convert exchange rates.
- The pipeline estimate is not recognised revenue, contract value, a forecast commitment or a verified CRM record.
- Malformed or unsupported saved workspaces are not silently replaced. Export JSON backups before changing devices or clearing browser data.

### Acceptance criteria

- A clean browser shows a useful empty state without fabricated accounts.
- Valid opportunity records can be added, edited, deleted, filtered and persisted locally.
- JSON export can be parsed back through the same schema validator.
- Invalid versions, stages, segments, dates, numeric values, oversized files and duplicate IDs are rejected.
- Derived pipeline totals exclude won and lost opportunities and do not claim actual revenue.
- No server request is made by the workspace.
- Business module tests, web typecheck, lint, formatting and production build pass before merge.


### Concurrency and recovery hardening

- Every create, update and delete acquires an origin-wide Web Lock, re-reads the latest persisted workspace while holding the lock, validates the result and then writes it. Concurrent tabs therefore append or modify against the latest saved document rather than replacing a stale snapshot.
- Other tabs listen for the browser `storage` event and refresh their in-memory view. If storage is cleared or becomes invalid, editing pauses and the UI requires explicit backup import recovery.
- Import requests are numbered. A slower earlier file read cannot replace a newer selected backup; the request is checked again after acquiring the write lock.
- A rejected or failed storage write never updates the in-memory workspace or reports success. The last valid state remains available for backup export when recovery is not required.
- Browsers without Web Locks are placed in read-only mode for mutations rather than pretending multi-tab safety.
- Account names are trimmed and validated before state changes; the 250-opportunity limit is enforced inside the locked transaction. Imported decimal values remain editable without changing their precision.

### Interaction test coverage

- Playwright browser tests cover add / reload persistence, whitespace-only account rejection, parallel writes from two tabs, corrupted-storage recovery, overlapping import selection, decimal edit / delete, 250-record limit and a simulated storage quota failure.
- Unit tests cover maximum valid record count, worst-case escaped-note backup size, JSON round-trip, version / field / date / value validation and pipeline calculations.
