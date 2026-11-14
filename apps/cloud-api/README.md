# ORBIT Cloud API foundation

This is a separate, edge-native cloud control plane. It does **not** replace the existing Fastify + SQLite local API. Local-first mode remains the default and continues to own repository scanning, filesystem access, ingestion and the current graph store.

## Current scope

- Cloudflare Worker runtime with no Node.js compatibility assumptions.
- Cloudflare Access JWT verification (RS256 signature, issuer, audience, expiry and not-before).
- D1-backed workspace identity and membership boundary.
- Authenticated workspace listing and workspace creation.
- No browser-supplied identity headers are trusted. The Worker accepts only the JWT assertion injected by Cloudflare Access.
- No wildcard CORS, no public data routes, no secrets committed to the repository.

## Provisioning

1. The dedicated `orbit-cloud` D1 database is provisioned in APAC with read replication disabled.
2. The database ID is configured in `wrangler.jsonc`. Keep `workers_dev` disabled and attach the Worker only to the hostname protected by Cloudflare Access.
3. Configure a Cloudflare Access self-hosted application for the eventual API hostname. Set its team issuer and application audience in Worker vars.
4. Apply migrations with `wrangler d1 migrations apply orbit-cloud --remote`.
5. Deploy from this directory with `wrangler deploy`.
6. Put the API behind the Cloudflare Access application before exposing it to users.

Do not deploy with the placeholder values. Protected routes return 401 when the Access assertion is missing or invalid. A missing or invalid Worker configuration fails closed with a generic 500 response.

## API

- `GET /health`: minimal liveness response; contains no account or database metadata.
- `GET /v1/workspaces`: lists only workspaces for the authenticated Access subject.
- `POST /v1/workspaces`: creates a workspace and owner membership atomically at the application level.

All SQL uses bound parameters. Every workspace read is scoped by the authenticated identity. Future project, repository, evidence and audit endpoints must join through `workspace_members` before reading or mutating tenant data.

## Security and product boundary

Cloudflare Access is the authentication provider for this foundation. This first version accepts human identity tokens with a non-empty `sub`; service-token identities are intentionally rejected. It is not a custom password system and does not create user accounts or handle billing. The Access application must enforce the desired login policy. Do not add a route that accepts an email, user ID, workspace ID or role as proof of identity.

The cloud API is intentionally a separate package: existing local endpoints rely on Node filesystem access, native SQLite and loopback/DNS-rebinding protections. Porting those routes requires explicit storage and capability adapters; forwarding arbitrary cloud requests to the local API is not supported.

## Verification

Run the repository's standard checks after installing the workspace dependencies. The typecheck generates the Wrangler binding declarations locally; the generated file is ignored by Git. For local Worker testing, use Wrangler with a local D1 database and a test Access JWT issuer/audience fixture. Never use a production Access audience or production D1 database in automated tests.
