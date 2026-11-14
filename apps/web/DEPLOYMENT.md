# ORBIT Command Center deployment

The dashboard is published as a static Cloudflare Pages frontend. The current UI still expects the local ORBIT API at `/api/health` and local-first API routes; this Pages deployment does not make the local API public or provide cloud-backed workspace data.

- Build: `pnpm install --frozen-lockfile && pnpm --filter @orbit/web build`
- Output: `apps/web/dist`
- Production branch: `main`
- Public frontend: `https://orbit-command-center-bh5.pages.dev`

API-backed actions require the local ORBIT runtime until the separately authenticated Cloud API is deployed behind Cloudflare Access on a configured hostname. Do not configure public API fallbacks or place API tokens in frontend environment variables.

Cloudflare Pages watches `apps/web/**` on `main`; this documentation update intentionally requests the first hosted build after Git integration setup.
