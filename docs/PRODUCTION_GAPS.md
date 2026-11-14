# ORBIT — Production Functionality Audit

**Audit date:** 14 November 2026  
**Scope:** Reviewed main source and Cloudflare Pages/Worker/D1 configuration. This is a source/configuration audit, not a full end-to-end test.

## Confirmed live topology

- Public dashboard: https://orbit-command-center-bh5.pages.dev
- Cloudflare Pages project: orbit-command-center
- Latest verified production deployment: 47faefa4, commit 31655cbcc8163f547b228c0e17cb7e89b9e861fc; build and deploy stages succeeded on 14 November 2026.
- Private Cloudflare Worker: orbit-cloud-api
- Access application: ORBIT Workspace; policy restricted to Cloudflare account members.
- D1 database: orbit-cloud, APAC.
- Cloud API scope: identity-scoped workspace creation/listing only.

## Confirmed functionality boundary

| Feature | Public Pages deployment | Local app/runtime | Notes |
|---|---|---|---|
| Static shell and responsive navigation | Available | Available | Pages deployment is live |
| Business planning | Available in browser | Available | Browser-local state; not cloud-synced |
| Cloud workspace list/create | Access-protected | Not applicable | Worker/D1 path is deployed |
| Local API health | Not connected by checked-in production Pages routing | Available through local proxy | /api/health is configured in Vite dev server only |
| Repository listing/scan | Not cloud-backed | Available | Requires local ORBIT runtime |
| ATLAS and architecture reports | Not cloud-backed | Available | Local repository and database required |
| Engineering graph/evidence/integrity | Not cloud-backed | Available | Local API token required |
| WITNESS/FLARE/CAPSULE/Flight Recorder | Not cloud-backed | Available | Uses stored local evidence and supplied files |
| Change Passport/Replay Room | Not cloud-backed | Available to extent implemented | UI/backend gaps remain in build-state notes |
| MCP and optional AI | Not cloud-backed | Local/configuration dependent | Live external AI-provider results are not claimed |

## Confirmed root causes of hosted “not working” experience

1. apps/web/vite.config.ts defines a development-server proxy from /api to 127.0.0.1:4317. This proxy does not run in a static Cloudflare Pages deployment.
2. apps/web/src/health.ts calls same-origin /api/health, but production Pages Functions currently implement only the cloud login route and /api/cloud/v1/workspaces.
3. apps/web/src/api.ts calls local engineering routes under /api/v1; the cloud Worker does not implement these routes and does not contain the local SQLite/ATLAS runtime.
4. The sidebar's engine rows in App.tsx are informational elements. Actual workbenches are nested within Command Center rather than independent routes.

The correct remedy is **not** to publish the local Fastify API, SQLite file, repository scanner or bearer token to the internet. Keep the local stack loopback-bound. Offer an explicit Local Engineering mode that connects to the user's own local runtime; keep the cloud workspace mode separate until there is a properly designed, authenticated cloud-engineering service with tenant isolation, storage, access controls, backups and audit logging.

## 3D and privacy workstream

- Add a lightweight, data-driven 3D graph mode in the existing graph panel.
- Preserve the 2D graph/table, accessible node selection and reduced-motion preference.
- Add a privacy/transparency centre that distinguishes local data from cloud identity/workspace data.
- Add law-readiness specifications with India DPDP staged commencement dates and the still-relevant SPDI assessment.
- Do not claim legal compliance or create false contact/rights-request routes.

## Follow-up release work

- Add a supported local-runtime connection and diagnostics guide for hosted users.
- Add a cloud API capability/status catalogue so the UI only advertises available cloud endpoints.
- Evaluate a secure cloud-engineering architecture separately; do not proxy the local API.
- Add end-to-end browser tests for a disconnected hosted local runtime, Access cloud workspace login, 3D graph interaction, privacy navigation, responsive layout and reduced motion.
- Keep public-launch and privacy-contact/legal sign-off as separate release gates.


## Validation note

The temporary formatting repair workflow used during this PR was removed after it completed successfully. No temporary formatter workflow remains in the repository.
