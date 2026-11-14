# ORBIT Command Center deployment

The public-facing dashboard is published through Cloudflare Pages. Cloud routes are protected by a shared Cloudflare Access application and use a Pages service binding to reach the cloud Worker without browser CORS or client-held credentials.

## Production endpoints

- Dashboard: https://orbit-command-center-bh5.pages.dev
- Cloud API (Access protected): https://orbit-cloud-api.ronakanantkijaan.workers.dev
- Cloudflare Access application: ORBIT Workspace
- Cloud database: D1 `orbit-cloud` (APAC)

## Cloud workspace request path

1. A user opens the Pages dashboard and authenticates through Cloudflare Access.
2. Cloudflare Access injects the signed `Cf-Access-Jwt-Assertion` header into the Pages Function request.
3. `functions/api/cloud/v1/workspaces.ts` validates that assertion is present and forwards it over the `ORBIT_CLOUD_API` service binding.
4. The Worker independently verifies the RS256 signature, issuer, audience, expiry and not-before claims.
5. D1 reads and writes are scoped to the authenticated Access subject and workspace membership.

The browser calls only the same-origin `/api/cloud/v1/workspaces` endpoint. It never receives a service token, API secret or cross-origin Access assertion. The Pages service binding is configured on the production environment. The Pages project watches `functions/**` for deployments.

The Access application currently permits Cloudflare account members only. This is a private deployment, not public self-service signup. Do not change its policy to Everyone or open email signup without an explicit product decision, abuse controls and a tested account onboarding flow.

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
