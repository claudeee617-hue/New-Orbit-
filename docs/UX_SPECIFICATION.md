# ORBIT — UX Specification

Version: 0.1 · Date: 2026-11-07

## 1. Principles

- Information-dense but readable; purposeful motion only.
- Every control works. No decorative buttons, no dead tabs.
- Every number is backed by stored data or visibly labelled **DEMO**.
- Evidence is one click away from any claim.

## 2. Visual identity

Dark-first. Deep charcoal/black background, neon cyan primary accent, restrained violet secondary. Status colours must also be distinguishable without colour (icon + label): PASS, FAIL, PARTIAL, NOT_MEASURED, INCOMPLETE. Monospace for code, hashes and telemetry; a clean sans for UI. Meets WCAG AA contrast. Light theme optional later.

## 3. Navigation

Overview · Engineering Graph · ATLAS · WITNESS · FLARE · CAPSULE · FLIGHT RECORDER · Change Passports · Replay Room · Evidence Explorer · MCP & AI · Integrations · Settings.
Desktop: left sidebar. Mobile: bottom bar with overflow menu.

## 4. Screens

| Screen | Contents | Key interactions |
|---|---|---|
| Overview | Indexed repos, recent changes, pending findings, test reliability, latest CI, environment diffs, recent device sessions, latest passports | Click any card → its engine screen; only stored-data metrics |
| Engineering Graph | Interactive node-link graph | Select node, follow dependencies, filter by node type, show affected tests, view history, trace evidence |
| ATLAS | Architecture map, symbol index, file tree, memory, decision history | Search symbols, open file at line, add/invalidate memory with sources |
| WITNESS | PR list, changed-line coverage view, evidence table, findings | Expand finding → evidence + suggested action; export MD/JSON/SARIF |
| FLARE | Reliability heatmap, test timeline, failure clusters, slow tests | Filter by test/time; "suspected" vs "confirmed" badges with sample size |
| CAPSULE | Manifest, fingerprint, diff between two manifests, replay plan | Approve/cancel replay; view captured output |
| FLIGHT RECORDER | Live stream, metric charts, session playback, crash inspector | Connect (with approval), record, scrub timeline, filter, export CSV/JSON |
| Change Passport | Evidence chain, completeness table, missing verification | Open evidence, copy hash, export |
| Replay Room | Browse old passports, timeline, compare, reproduction plan | Pick two passports to diff |
| Evidence Explorer | Search/filter all evidence | Verify hash |
| MCP & AI | MCP status and tool list; provider setup; AI run history | Test connection; see exact context sent |
| Integrations | GitHub, CI sources | Connect/disconnect |
| Settings | Paths, limits, privacy, approvals | |

## 5. Required states for every screen

- **Loading**: skeleton, no spinners that block navigation.
- **Empty**: explains what is missing and offers the exact CLI command or button to fix it.
- **Error**: plain-language cause, technical detail expandable, retry.
- **Disconnected device**: clear banner, last known session still viewable.
- **Unsupported / unavailable**: states which optional integration is missing; never shows fabricated data.
- **Demo workspace**: persistent DEMO badge in header and on every demo-derived card.

## 6. Change Passport viewer (heart of the product)

Sections: summary header (commit, base, diff hash) → completeness table (dimension, status, deciding rule) → impact → evidence chain (each item shows source, hash, limitations) → findings → missing verification → environment → builds → hardware sessions → export. No composite score.

## 7. Responsive and accessibility

Desktop-first layouts that collapse to single column on mobile; graph switches to list view on small screens. Full keyboard navigation, focus rings, ARIA labels on charts with table alternatives, reduced-motion support.

## 8. Copy tone

Plain and specific: "No coverage report was supplied for this PR" rather than "0% coverage". Limitations are shown inline, not buried.
