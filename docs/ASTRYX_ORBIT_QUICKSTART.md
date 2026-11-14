# Astryx consumer integration guide for ORBIT

This guide is the implementation recipe for the ORBIT web app. It deliberately uses Astryx's **prebuilt distribution**: ORBIT does not need a StyleX compiler plugin unless ORBIT starts authoring StyleX styles or swizzling Astryx components.

## Verified compatibility

- ORBIT uses React and React DOM 19.3.1.
- Astryx Core 0.7.16 requires React and React DOM >=19.0.0 and has a peer dependency on `@stylexjs/stylex ^0.19.0`.
- Astryx ships precompiled ESM and CSS. Importing its prebuilt CSS does not require compiling Astryx source in ORBIT.
- Astryx Neutral theme 0.7.16 requires Core 0.7.16 and React >=19.

Upstream references:
- [Core README and Quick Start](https://github.com/meta/astryx/blob/main/packages/core/README.md)
- [Core package manifest](https://github.com/meta/astryx/blob/main/packages/core/package.json)
- [Neutral theme manifest](https://github.com/meta/astryx/blob/main/packages/themes/neutral/package.json)
- [Astryx styling overview](https://astryx.atmeta.com/docs/styling-overview)

## 1. Add dependencies

From the ORBIT repository root:

```powershell
pnpm --filter @orbit/web add @astryxdesign/core@0.7.16 @astryxdesign/theme-neutral@0.7.16 @stylexjs/stylex@^0.19.0
```

This updates `apps/web/package.json` and the root `pnpm-lock.yaml` together. Keep Core and theme versions aligned.

## 2. Configure the CSS cascade

Replace the single `@import 'tailwindcss';` in `apps/web/src/styles.css` with the documented Tailwind v4 layer order and imports below. Keep ORBIT's existing `@theme`, body styles, and reduced-motion rules after these imports.

```css
@layer reset, theme, base, astryx-base, astryx-theme, components, utilities;

@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/preflight.css' layer(base);
@import '@astryxdesign/core/reset.css';
@import '@astryxdesign/core/astryx.css';
@import '@astryxdesign/theme-neutral/theme.css';
@import '@astryxdesign/core/tailwind-theme.css';
@import 'tailwindcss/utilities.css' layer(utilities);
```

The layer order is important: Astryx component styles must remain below ORBIT's Tailwind utilities. Do not import Astryx CSS from a component file; import it once from the global stylesheet.

## 3. Add the theme provider

Astryx's published Neutral theme uses the `/built` entry for prebuilt consumers. Wrap the existing app in `Theme` from the web entry point. Keep ORBIT's own application components and styles unchanged.

In `apps/web/src/main.tsx`, add:

```tsx
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
```

Then wrap `<App />`:

```tsx
<StrictMode>
  <Theme theme={neutralTheme} mode="dark">
    <App />
  </Theme>
</StrictMode>
```

Neutral references Figtree but does not bundle it. ORBIT may keep its existing system font stack initially; load Figtree only if the design review explicitly chooses that typography.

## 4. Add a small isolated component showcase

Start with one non-critical component (Badge) rather than replacing the Command Center. Example:

```tsx
import { Badge } from '@astryxdesign/core/Badge';

export function AstryxIntegrationProbe() {
  return <Badge variant="cyan" label="Astryx ready" />;
}
```

Mount it only in a temporary showcase area on the Overview screen. Remove the probe after visual verification or retain it as a dedicated design-system preview route.

## 5. Keep ORBIT's visual identity

Use the Neutral theme as the initial base, then override semantic tokens in ORBIT's own CSS. Do not target generated StyleX atomic class names. Keep ORBIT's existing semantic classes (`bg-panel`, `text-cyan`, `border-edge`) and use stable Astryx component classes only when a deliberate component-level override is required.

## 6. Required verification

Run from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @orbit/web typecheck
pnpm --filter @orbit/web test
pnpm --filter @orbit/web build
```

Then verify at desktop, tablet, and mobile widths:
- no missing Astryx CSS or runtime StyleX errors;
- keyboard focus is visible and controls remain keyboard-operable;
- reduced-motion preference is respected;
- dark mode and ORBIT token contrast remain acceptable;
- existing Overview, API health, Business module, and Business Operations workflows are unchanged.

Only after these checks pass should Astryx components be adopted in production screens.

## Important

The recipe above is based on Astryx's prebuilt consumer distribution. Do **not** add `@astryxdesign/build`, `@stylexjs/rollup-plugin`, or a Babel StyleX transform for this first integration. Those are for compiling ORBIT-authored StyleX or swizzled Astryx source, not for consuming the published prebuilt components.
