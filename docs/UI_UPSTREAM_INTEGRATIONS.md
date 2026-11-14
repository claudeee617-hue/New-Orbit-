# Open-source UI integrations

## Integrated component library

### Lucide React
- Upstream: https://github.com/lucide-icons/lucide
- Consumer package: `lucide-react@1.67.0`
- License: ISC, with the named Feather-derived icons under MIT as recorded in the upstream LICENSE.
- ORBIT usage: consistent SVG icon components in the Command Center sidebar for overview, business, repository scan, evidence and Change Passport navigation.
- Rendering is inline SVG; no icon font, remote image request, or CDN is required.

## Dashboard composition reference

### Shadcn Dashboard Free
- Upstream: https://github.com/shadcndashboard/shadcndashboard
- License: MIT.
- Stack: React, Vite, TypeScript, Tailwind CSS 4, Base UI, TanStack Table, Recharts and Lucide.
- ORBIT adoption: visual/interaction patterns only—compact workspace switcher, grouped sidebar navigation, sticky top bar, restrained metric panels, explicit empty states, responsive layout and focus-visible treatment.
- No upstream page, application source file, or component implementation is copied into ORBIT. The dashboard has been adapted to ORBIT's existing React 19/Vite/Tailwind stack and its evidence-first data model.

## ORBIT-specific decisions

- Keep the charcoal/navy engineering palette, cyan highlights and local-first privacy messaging.
- Business Workspace remains its own section; engineering evidence is not mixed with business planning.
- Engine entries are informational labels unless they already have a functioning route. They do not pretend to be active controls.
- Runtime connection state comes from the existing local API health endpoint.
- Dashboard counters continue to come from the authenticated API. No sample repository counts, build status, coverage or evidence records are fabricated.
- The responsive mobile drawer traps Tab/Shift+Tab focus while open, closes on Escape, hides closed navigation from the focus order, and restores focus to its trigger.
- A Chromium regression test exercises the mobile drawer keyboard cycle, Escape dismissal and trigger-focus restoration.
- Existing Command Center, business forms, API calls and local token handling remain in their existing components.

## Verification required

Run from the ORBIT repository root after checkout:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @orbit/web typecheck
pnpm --filter @orbit/web test
pnpm --filter @orbit/web build
```

Then exercise keyboard navigation, collapse/expand, mobile drawer open/close, reduced-motion behavior, Business Workspace and the API disconnected/connected states at desktop, tablet and phone widths.
