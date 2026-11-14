# ORBIT Command Center deployment

The public-facing dashboard is published through Cloudflare Pages. Only the cloud workspace API paths are protected by Cloudflare Access; the main dashboard remains publicly viewable. Pages Functions use a service binding to reach the cloud Worker without browser CORS or client-held credentials.

## Production endpoints

- Dashboard: https://orbit-command-center-bh5.pages.dev
- Cloud API (Access protected): https://orbit-cloud-api.ronakanantkijaan.workers.dev
- Cloudflare Access application: ORBIT Workspace
- Cloud database: D1 `orbit-cloud` (APAC)

## Cloud workspace request path

1. A visitor can open the dashboard without signing in.
2. The Cloud Workspace section calls the same-origin `/api/cloud/v1/workspaces` route.
3. Cloudflare Access protects `/api/cloud/*` and prompts approved Cloudflare account members to sign in. The `/api/cloud/login` route returns the user to the dashboard after authentication.
4. Cloudflare Access injects the signed `Cf-Access-Jwt-Assertion` header into the Pages Function request.
5. `functions/api/cloud/v1/workspaces.ts` bounds request sizes and forwards the assertion over the private `ORBIT_CLOUD_API` service binding.
6. The Worker independently verifies the RS256 signature, issuer, audience, expiry and not-before claims.
7. D1 reads and writes are scoped to the authenticated Access subject and workspace membership.

The Worker hostname is protected at `/v1/*`; the Pages dashboard root remains public. The browser calls only the same-origin Pages route and never receives a service token, API secret or cross-origin Access assertion.

The Access policy currently permits Cloudflare account members only. This is a private cloud-workspace beta, not public self-service signup. Do not change its policy to Everyone or open email signup without an explicit product decision, abuse controls and a tested account onboarding flow.

## Local-first engineering runtime

The existing Fastify + SQLite API remains local-first and is not exposed to the public internet. Repository scanning, source ingestion, ATLAS, graph, evidence, WITNESS, FLARE, Change Passport and AI analysis continue to use the local runtime. The cloud workspace feature currently provides identity-scoped workspace creation and listing; it does not claim to sync local source code or evidence to D1.

Start the local stack from the repository root with `pnpm dev`. The local dashboard API proxy targets `http://127.0.0.1:4317` by default.

## Build and release

- Production branch: `main`
- Build command: `pnpm install --frozen-lockfile && pnpm --filter @orbit/shared build && pnpm --filter @orbit/web build`
- Output directory: `apps/web/dist`
- Pages Functions directory: repository-root `functions/`
- Worker package: `apps/cloud-api`
- Worker deploy command: `pnpm --filter @orbit/cloud-api deploy`

Keep the D1 migration files in sync with remote migration history. The initial schema was provisioned and verified directly; reconcile that remote state with Wrangler's migration ledger before applying subsequent migrations. Before onboarding external users, add rate limiting, backup/restore drills, tenant isolation tests for every new route, audit retention and a documented account recovery process.
