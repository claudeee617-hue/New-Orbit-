# Astryx UI integration assessment

**Status:** compatibility assessment complete; runtime component adoption is intentionally staged.  
**Target:** ORBIT Command Center (`apps/web`).  
**Upstream:** [meta/astryx](https://github.com/meta/astryx) (MIT; Meta Platforms, Inc.).  
**Working branch:** `feat/astryx-ui-foundation`.

## Executive decision

Adopt Astryx incrementally behind an ORBIT-owned UI boundary. Do not replace the existing dashboard wholesale and do not add the entire Astryx monorepo as an ORBIT workspace.

ORBIT's web app is a React 19 + Vite 8 + Tailwind CSS 4 application. Its current visual language is a dark engineering console defined in `apps/web/src/styles.css` and used by `App.tsx`, `CommandCenter.tsx`, and the business views. Astryx Core is a separate MIT-licensed React component package with StyleX-authored component styles, a dedicated build pipeline, theme packages, and CSS exports. The upstream repository uses pnpm 11.10.0 and a large multi-package workspace.

These are compatible at the React level, but **not automatically compatible at the styling/build level**. A package dependency alone does not prove that StyleX transforms, CSS layers, tokens, overlays, focus handling, and SSR/client boundaries are correctly configured in ORBIT's Vite app.

## Findings

| Area | ORBIT | Astryx | Integration implication |
| --- | --- | --- | --- |
| Runtime | React 19, Vite 8 | React component library, built with StyleX | React compatibility is promising; validate peer requirements |
| Styling | Tailwind CSS 4, CSS custom properties | StyleX + Astryx theme/CSS exports | Configure and test StyleX before importing components |
| Theme | Dark engineering palette (void/panel/cyan/violet) | Themeable component tokens and theme packages | Map tokens; retain ORBIT brand and dark default |
| App structure | Small Vite dashboard shell with API-driven views | Large design-system package | Import only selected components, not all packages |
| Quality | Existing unit/API/CLI checks and CI matrix | Extensive component, a11y, visual and package-boundary checks | Add focused integration tests and browser checks |
| License | ORBIT Apache-2.0 | Astryx MIT | Preserve upstream MIT copyright/license notices for copied or redistributed code |

## Guardrails

1. Keep ORBIT's data fetching, API contracts, domain logic, accessibility semantics, and evidence claims unchanged.
2. Do not copy Astryx source files into ORBIT. Prefer the published `@astryxdesign/core` package and preserve its license notices.
3. Do not import StyleX-authored components until the StyleX transform is configured in the Vite build and verified in production output.
4. Keep Tailwind CSS 4 as the existing utility layer unless a tested migration decision explicitly replaces it.
5. Preserve ORBIT's dark visual identity, reduced-motion support, keyboard focus visibility, and responsive layout.
6. Avoid adding Astryx's full monorepo, Storybook, CLI, charts, rich-text, native, or lab workspaces to ORBIT.
7. Never claim integration is complete based only on successful dependency installation or Storybook startup.

## Phased implementation

### Phase A — compatibility and license (this change)

- Record upstream package/build requirements and ORBIT's current frontend stack.
- Establish a dedicated feature branch and reviewable PR.
- Keep the existing application behavior untouched.

### Phase B — minimal build spike

- Pin a compatible `@astryxdesign/core` release and required StyleX tooling only after checking its published manifest and peer dependencies.
- Configure the official StyleX Babel/Vite transform using upstream-supported configuration.
- Import one low-risk component (initial candidate: Button or Badge) on an isolated UI showcase route.
- Verify Vite dev server, production build, CSS extraction, dark theme, keyboard/focus behavior, reduced motion, and browser console.

### Phase C — ORBIT adapter

- Add an ORBIT-owned wrapper layer (for example, `OrbitButton`, `OrbitBadge`, `OrbitCard`) so application screens do not depend directly on upstream component APIs.
- Map ORBIT semantic tokens to Astryx theme tokens without changing existing color meanings.
- Keep existing Tailwind classes and styles during migration; remove duplicates only after visual parity is proven.

### Phase D — incremental screen adoption

- Migrate one reusable primitive at a time.
- Prioritize consistent buttons, badges, cards, fields, dialogs, and navigation.
- Do not rewrite the Command Center or Business workspace in one pass.
- Add component-level tests and at least one responsive browser regression for each migrated pattern.

### Phase E — validation and release

- Run formatting, lint, typecheck, unit tests, production build, and browser E2E.
- Review dependency/license notices and bundle-size impact.
- Obtain CodeRabbit review and resolve actionable findings.
- Merge only after CI is green and the UI regression review passes.

## Acceptance checklist

- [ ] Astryx package version and peer dependencies are pinned and documented.
- [ ] StyleX transform is enabled only for the web app and has a production-build test.
- [ ] A single component works in dev and production without missing styles or hydration/runtime errors.
- [ ] ORBIT dark theme, focus rings, reduced motion, and responsive layouts remain intact.
- [ ] Existing API and Business workflows behave identically.
- [ ] Automated checks and CodeRabbit review are green or all remaining findings are explained.
- [ ] MIT license attribution is preserved.
- [ ] No Astryx Storybook/dev server dependency is required to run ORBIT.

## Upstream references

- [Astryx repository](https://github.com/meta/astryx)
- [Astryx Core package manifest](https://github.com/meta/astryx/blob/main/packages/core/package.json)
- [Astryx Core public exports](https://github.com/meta/astryx/blob/main/packages/core/src/index.ts)
- [Astryx license](https://github.com/meta/astryx/blob/main/LICENSE)
- [ORBIT web app manifest](../apps/web/package.json)
- [ORBIT web app entry point](../apps/web/src/App.tsx)
- [ORBIT web styles](../apps/web/src/styles.css)
