# ADR-0018: Adopt Astryx incrementally behind an ORBIT UI boundary

- **Status:** Accepted for a staged compatibility spike; production component adoption is not yet approved.
- **Date:** 2026-11-14
- **Decision owners:** ORBIT maintainers

## Context

ORBIT's web application uses React 19, Vite 8 and Tailwind CSS 4 with a dark engineering-console theme. Meta's Astryx is an MIT-licensed React design system whose Core package uses StyleX-authored styles and is built as part of a larger pnpm workspace.

React compatibility is promising. Astryx ships prebuilt ESM and CSS for consumers; the primary integration risks are CSS layer order, theme token mapping, and runtime verification.

## Decision

Evaluate Astryx through a narrow, isolated integration spike. Keep ORBIT's application architecture, API contracts, domain components and Tailwind setup intact. Do not vendor the upstream monorepo or perform a wholesale UI replacement.

The first runtime adoption must be limited to one low-risk component behind an ORBIT-owned wrapper. The exact package version and transform configuration must be verified against the published package manifest before dependency changes are made.

## Consequences

### Positive

- ORBIT can reuse accessible, themeable primitives while preserving its product identity.
- The wrapper layer limits coupling to upstream component APIs.
- Incremental adoption makes regressions easier to isolate and revert.

### Negative / costs

- StyleX integration adds build configuration and maintenance surface.
- Token mapping and CSS ordering require explicit testing.
- Upstream updates need compatibility review and bundle-size monitoring.

## Guardrails

- Preserve ORBIT's dark theme, reduced-motion behavior, keyboard focus visibility and responsive layouts.
- Preserve MIT attribution and license notices.
- Do not claim success until dev, production build, browser behavior and existing tests are verified.
- Keep the existing UI as the fallback until each migrated pattern passes acceptance checks.

## Revisit when

The minimal component spike has passed the ORBIT CI matrix and responsive browser regression tests, or upstream package/build requirements materially change.
