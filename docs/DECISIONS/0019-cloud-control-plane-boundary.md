# ADR-0019: Establish a separate Cloudflare cloud control plane

- **Status:** Accepted for foundation implementation; production rollout remains gated.
- **Date:** 2026-11-14
- **Decision owners:** ORBIT maintainers

## Context

ORBIT's existing API is a Node.js Fastify service backed by `better-sqlite3`. It deliberately binds to loopback by default, uses local filesystem capabilities, and owns repository scanning and graph ingestion. A Cloudflare Worker cannot safely host that service by simply changing its listen address or deploying the existing bundle: the runtime and storage contracts differ.

## Decision

Create a separate edge-native Worker under `apps/cloud-api` for cloud identity and workspace control-plane operations. Use Cloudflare Access JWTs for authentication and D1 for tenant membership metadata. Keep the existing local API and SQLite graph store intact.

The initial cloud surface is limited to health, authenticated workspace listing and workspace creation. It does not claim to synchronize local graph data or expose existing engineering endpoints.

## Security invariants

1. Identity is derived only from a cryptographically verified Cloudflare Access JWT.
2. Verify RS256 signature, exact issuer, configured audience, expiry and not-before.
3. Every tenant-owned query must be scoped through the authenticated identity's membership.
4. Use bound SQL parameters and server-generated IDs.
5. Do not trust client-provided roles, email addresses or subject IDs.
6. No wildcard CORS or anonymous tenant endpoints.
7. Keep secrets and production identifiers out of source control.

## Consequences

- Cloud authentication and tenant boundaries can be validated independently of local repository access.
- The local product remains usable without Cloudflare credentials or network access.
- Full cloud parity requires follow-up work: durable graph storage, repository import/sync, evidence and audit APIs, authorization policy, rate limiting, backups, and integration tests.
- Production deployment requires a real D1 database and a configured Cloudflare Access application. Placeholder settings must never be deployed.

## Rollout gates

- Unit and integration tests cover JWT invalidity, expiry, audience mismatch, and cross-tenant isolation.
- Cloudflare Access is configured for the production hostname.
- D1 migrations and backup/restore are verified.
- Security review and CI pass before production traffic is enabled.
