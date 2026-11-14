# ORBIT Cloud API foundation

This is a separate, edge-native cloud control plane. It does **not** replace the existing Fastify + SQLite local API. Local-first mode remains the default and continues to own repository scanning, filesystem access, ingestion and the current graph store.

## Current deployment

- Worker: `orbit-cloud-api`
- Endpoint: `https://orbit-cloud-api.ronakanantkijaan.workers.dev`
- Cloudflare Access protects the Worker hostname.
- Access policy: Cloudflare account members only; 24-hour sessions.
- Storage: D1 database `orbit-cloud` in APAC.
- The Worker accepts only the JWT assertion injected by Cloudflare Access. Missing or invalid assertions cannot access workspace routes.

The public endpoint is not an open signup API. Only members of the configured Cloudflare account can authenticate. Do not broaden this policy to Everyone or all email addresses without a deliberate product decision and abuse controls.

## Current scope

- Cloudflare Worker runtime with no Node.js compatibility assumptions.
- Cloudflare Access JWT verification (RS256 signature, issuer, audience, expiry and not-before).
- D1-backed workspace identity and membership boundary.
- Authenticated workspace listing with stable cursor pagination.
- Workspace creation with owner membership in one D1 batch.
- No browser-supplied identity headers are trusted.
- No wildcard CORS and no secrets committed to the repository.

## Provisioning and operations

The D1 database and schema are provisioned. The Worker is deployed and its `workers.dev` endpoint is protected by the Access application. Keep the Access application and its account-member policy in place.

The checked-in Wrangler configuration contains the current Access issuer and audience. If the Access application is recreated, update both values and redeploy. Keep the Worker behind Access; do not disable the `workers.dev` protection.

For future schema changes, add a numbered migration under `migrations/` and apply it to the remote D1 database with Wrangler before deploying code that depends on it. Reconcile the existing manually provisioned schema with Wrangler migration history before relying on automated migration state.

## API

- `GET /health`: minimal liveness response; no account or database metadata.
- `GET /v1/workspaces?limit=50&cursor=...`: lists only workspaces for the authenticated Access subject.
- `POST /v1/workspaces`: creates a workspace and owner membership atomically at the application level.

All SQL uses bound parameters. Every workspace read is scoped by the authenticated identity. Future project, repository, evidence and audit endpoints must join through `workspace_members` before reading or mutating tenant data.

## Product boundary

This is a cloud identity/workspace foundation, not yet a cloud replacement for the full local engineering runtime. The web dashboard still uses the existing local API for repository scanning, evidence, graph and engineering workflows. Those features are not remotely available from this Worker.

The cloud API is intentionally separate: existing local endpoints rely on Node filesystem access, native SQLite and loopback/DNS-rebinding protections. Porting those routes requires explicit storage and capability adapters; forwarding arbitrary cloud requests to the local API is not supported.

## Verification

Run the repository's standard checks after installing the workspace dependencies. The typecheck generates the Wrangler binding declarations locally; the generated file is ignored by Git. For local Worker testing, use Wrangler with a local D1 database and a test Access JWT issuer/audience fixture. Never use the production Access audience or production D1 database in automated tests.
