# ORBIT — Privacy, Data Protection and Legal Readiness

**Document status:** Product transparency and compliance-readiness specification. **Not legal advice, a legal opinion, or a certification.**  
**Last checked:** 14 November 2026  
**Jurisdiction baseline:** India; international obligations depend on actual user base, establishment and processing.

## 1. Executive position

ORBIT is a local-first engineering application with a separately deployed, limited cloud-workspace control plane. The public dashboard does not make the local engineering API public. The cloud service currently supports authenticated workspace creation and listing; it does not host repository source, graph, evidence, CI ingestion, ATLAS, WITNESS, FLARE, or Change Passport processing.

The product must not claim to be “DPDP compliant” or “GDPR compliant” merely because a privacy page exists. This document records implemented controls, known gaps, and release gates. Qualified counsel must confirm the correct legal entity, roles, applicability, notice wording, retention periods, processor contracts, international transfers, and sector-specific requirements before external customer onboarding.

## 2. India law commencement — as at 14 November 2026

MeitY published the DPDP Act commencement notification G.S.R. 843(E) and the DPDP Rules, 2025 G.S.R. 846(E) on 13 November 2025. Both instruments specify staggered commencement.

| Date | Provisions scheduled / in force |
|---|---|
| 13 November 2025 | Initial Act provisions listed in G.S.R. 843(E), including definitions and institutional/administrative provisions; Rules 1, 2 and 17–21 |
| 13 November 2026 | DPDP Act section 6(9), section 27(1)(d), and DPDP Rule 4 |
| 13 May 2027 | Main tranche: Act sections 3–5, 6(1)–(8), 6(10), 7–17, section 27 except clause (d), sections 28–34, 36 and 37, and Act section 44(2); Rules 3, 5–16, 22 and 23 |

Rule 4 is the Consent Manager rule. ORBIT is not represented as a registered Consent Manager. Its commencement does not by itself turn every software operator into a Consent Manager.

DPDP Act section 44(2), which omits section 43A of the Information Technology Act, 2000, is scheduled for 13 May 2027. Until that date, assess the continued relevance of IT Act section 43A and the SPDI Rules, 2011, particularly if the service collects or processes passwords, financial information, health information, medical records, or other sensitive personal data covered by those Rules.

The precise legal application to ORBIT depends on the identity of the operator, whether it determines purposes and means of processing, customer contracts, data categories, and territorial facts.

## 3. Current product data inventory

This is a source-informed product inventory, not a promise that infrastructure providers retain no operational data.

| Data category | Purpose | Current storage / destination | Control / limitation |
|---|---|---|---|
| Repository paths, symbols, dependencies, commit IDs | Local codebase mapping and change analysis | User-controlled local SQLite workspace and generated reports | No source upload by default; workspace directory is sensitive |
| Test/CI summaries, evidence hashes, environment declarations, recorded telemetry summaries | Engineering evidence and traceability | Local SQLite workspace | Inputs may contain confidential metadata; user controls local files and backups |
| Local API token | Authenticate local dashboard requests | api.token beside local database, or explicitly supplied environment variable | Never commit; restrictive Unix permissions are implemented; Windows ACL verification remains a release check |
| Local dashboard token entry | Authenticate same-origin local API calls | Component memory only | Not saved to browser storage or URL |
| Cloudflare Access subject and email (when supplied) | Authenticate a private cloud-workspace member | Access identity assertion; relevant identity/membership fields in D1 | Account-member-only Access policy; public self-service signup is not enabled |
| Cloud workspace name, key, ID, role, creator and timestamp | Create/list identity-scoped workspaces | Cloudflare D1 database orbit-cloud in APAC | Current cloud data model is limited to workspaces and membership |
| Cloud platform request and authentication metadata | Operate and secure hosted services | Cloudflare infrastructure | Subject to Cloudflare terms, privacy documentation and operational logging |
| Business opportunity/planning entries | Local planning workspace | Browser-local storage | Not encrypted by ORBIT; not cloud-synced |
| Optional AI/provider context | User-requested analysis in supported local configuration | Local API preview/approval path; approved context may be sent to selected provider | Optional; live-provider behaviour has not been independently validated |

### Data not intentionally collected by default

- Raw environment variable values, passwords, API tokens, private keys, cookies, or secret files.
- Full repository archives or source files uploaded to ORBIT cloud.
- Background behavioural analytics, advertising identifiers, or ORBIT telemetry.
- Hardware commands or remote device-control permissions.

Avoid absolute claims about infrastructure-provider logs or browser/platform processing. Describe them separately from application data flows.

## 4. Current technical controls

Implemented in the reviewed repository/deployment:

- Local Fastify API binds to loopback by default and requires a Bearer token for /api/v1 routes; the public health endpoint reports limited service state.
- Local API token handling is designed not to expose the token in responses, logs, URLs or browser storage.
- The Pages cloud-workspace bridge accepts bounded GET/POST operations, checks for the Cloudflare Access JWT assertion, and forwards through the private Worker service binding.
- The Cloud Worker validates the Access JWT (signature, issuer, audience and time claims) and scopes workspace reads to the authenticated identity/membership.
- Bound SQL parameters, server-generated IDs, bounded request bodies, no wildcard CORS, and no public open-signup policy are used in the cloud-workspace foundation.
- Business opportunity state remains browser-local and is not represented as a hosted CRM.
- Security work includes path/symlink protections, bounded parsers, safe XML handling, secret-value avoidance, CodeQL and dependency-audit workflows.

These are implementation claims from repository code and deployment configuration, not an independent audit. See docs/THREAT_MODEL.md, docs/SECURITY_REVIEW.md, and ORBIT_BUILD_STATE.md for limitations.

## 5. Rights, requests and deletion — outstanding

The reviewed production release does **not** yet provide a complete self-service workflow for a cloud identity holder to access, correct, export, withdraw consent for, or erase cloud identity/workspace personal data. It also has no verified public privacy/grievance contact configured. Local SQLite workspace files remain under the local operator's control, but deleting a browser profile or local row is not verified deletion from all backups, reports, provider systems, or cloud records.

Before accepting external customer personal data, implement and test:
1. Verified controller/Data Fiduciary identity and prominent privacy/grievance contact.
2. Request intake that authenticates the requester without collecting excessive additional data.
3. Access/export, correction, consent withdrawal where applicable, erasure subject to lawful retention, and grievance tracking.
4. Retention/deletion schedule for D1 rows, Access identity references, logs, backups, local workspaces and exported artifacts.
5. Deletion propagation and proof across backups/processor systems, with lawful hold and security-log exceptions documented.
6. A response timeline and escalation process aligned with the law actually in force at request time.

**Operator action required:** insert a real, monitored business/privacy contact only after it is selected and verified. Do not invent an email address, postal address, legal entity, DPO or Grievance Officer.

## 6. DPDP Rules readiness backlog

Prepare the following for the main provisions scheduled for 13 May 2027. Do not present them as already complete:

- Standalone plain-language notice that itemises personal-data categories, each purpose, and means to withdraw consent and exercise rights.
- Consent capture and versioned evidence where consent is the legal basis; separate optional processing from service-essential processing.
- Data-principal request and grievance workflow, including a published contact person and response process.
- Reasonable security safeguards: encryption/obfuscation where appropriate, access control, access logging and review, backups, incident investigation, processor contractual controls, and documented technical/organisational measures.
- Personal data breach procedure and message templates; test statutory reporting paths and current timelines against the rules in force at incident time.
- Retention and erasure schedule; do not treat local-first as a substitute for lifecycle management.
- Processor/subprocessor register, data-processing terms, access governance, and international transfer review.
- Assessment of child-user processing, age-related duties and whether the product should prohibit under-18 accounts.
- Applicability review for Significant Data Fiduciary classification and sector-specific laws.

## 7. Other potentially applicable requirements

- **IT Act section 43A and SPDI Rules, 2011:** assess until the scheduled omission of section 43A takes effect; applicability depends on the entity, data type and processing arrangement.
- **CERT-In Directions (2022):** assess whether the operator/service and incident type fall within scope; where applicable, operationalise incident reporting and log-retention requirements. Confirm scope and current procedures with counsel/security staff.
- **GDPR / UK GDPR / other foreign privacy laws:** applicability is fact-specific (territorial scope, establishment, targeting, monitoring, data roles). Do not add “GDPR compliant” claims without a separate assessment.
- **Consumer, e-commerce, cybersecurity, employment, education, financial or health-sector obligations:** review if the product later collects related regulated data or is sold into those markets.

## 8. Processor and service-provider review

Maintain a live subprocessor table before public launch. At minimum, assess:

| Provider / service | Current role in ORBIT | Review required |
|---|---|---|
| Cloudflare Pages / Workers / D1 / Access | Hosts public dashboard, private cloud API, identity gate and D1 workspace metadata | Terms, privacy/security documentation, data region, logs, retention, subprocessors, incident process, transfer mechanism and DPA |
| GitHub | Source hosting, CI and repository integration | OAuth/app permissions, repository metadata access, logs, retention, breach notices and DPA |
| Optional AI provider | Only where a user configures and approves an external provider flow | Model endpoint, exact context, retention/training policy, geography, DPA and user approval |
| Other connectors | Only once enabled by an operator | Purpose, data categories, permissions, contract, retention and deletion |

Do not assume a provider is a processor for every use case; document roles per actual contract and feature.

## 9. Incident response and security operations

Keep a written incident playbook with detection, triage, evidence preservation, containment, credential rotation, recovery, post-incident review, affected-person assessment, a named incident owner, provider notifications, and statutory reporting decisions verified against current rules. Test backup restoration and tenant separation.

Do not place personal data, tokens or raw customer source into public GitHub issues or public CI artifacts.

## 10. Release gates

ORBIT remains a private/pre-release beta until the operator completes:

- [ ] Verify operating legal entity, controller/Data Fiduciary role and actual business address.
- [ ] Select and publish a monitored privacy/grievance contact.
- [ ] Confirm privacy notice and Terms with India-qualified counsel.
- [ ] Implement, test and document rights requests, consent withdrawal and deletion.
- [ ] Approve and publish retention schedules and processor/subprocessor terms.
- [ ] Complete Cloudflare data-location/logging/backup review and DPA check.
- [ ] Complete an independent security review and remediate high/critical findings.
- [ ] Verify breach response and applicable CERT-In / DPDP reporting operations.
- [ ] Review child-user handling, SPDI exposure and international-law scope.
- [ ] Verify the public dashboard does not suggest local-only features are cloud available.

## 11. Primary sources

1. DPDP Act, 2023 — MeitY: https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf
2. DPDP Rules, 2025 — Gazette / MeitY: https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf
3. Commencement notification G.S.R. 843(E), 13 November 2025: https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf
4. MeitY DPDP Rules and enforcement-timeline portal: https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa
5. IT (SPDI) Rules, 2011 — India Code transcription: https://indiacode.ecourtsindia.com/rules/the-information-technology-reasonable-security-practices-and-a1af21b5/

## 12. Change control

Review this document when operator changes legal entity, data categories, analytics, identity provider, hosting region, AI provider, retention, public signup, integrations, or user geography. Re-check the Gazette, MeitY, CERT-In and relevant regulator sources before changing compliance status.
