# ORBIT — Commercial Product Roadmap

**Status:** Proposed sequence; gates, not calendar promises.  
**Last reviewed:** 2026-11-08  
**Companion:** [Business Model & Monetization Architecture](BUSINESS_MODEL.md)

This roadmap converts the hybrid business strategy into release gates. It intentionally avoids fixed launch dates until implementation, security and customer-discovery evidence support them.

## 1. Starting point — honest product status

As of 2026-11-08:
- The public \`main\` branch contains the monorepo foundation, ORBIT Core graph and ATLAS repository scanner.
- PR #1 (\`feat/orbit-evidence-engines\`) contains Prompt 5 memory/MCP work and early WITNESS, FLARE, CAPSULE, FLIGHT RECORDER and Change Passport prototypes. It is open and has not been merged.
- Those prototypes have explicit limitations: no persistent CI history, no environment replay, no physical serial capture, no graph-persisted passport / Replay Room, and no completed hosted collaboration product.
- The current product is an engineering build, not a commercially ready release.

Update this section as implementation changes. A feature is marketable only after it is merged, tested, documented, packaged and validated in a user workflow.

## 2. Roadmap overview

| Stage | Product objective | Commercial objective | Exit gate |
|---|---|---|---|
| S0 — Release readiness | Stabilise the local-first foundation and public project hygiene | No monetisation | Licence, name, security and documentation blockers resolved |
| S1 — Community preview | Ship one coherent local evidence workflow | Build developer trust and useful adoption | Fresh-clone user can complete the documented workflow |
| S2 — Design-partner pilot | Test real team workflows with local deployments | Validate pain, value and willingness to pay | 5–10 active pilot teams; workflow and support evidence recorded |
| S3 — Team paid beta | Add optional shared workspaces and synchronisation | First recurring subscription revenue | Paid pilots renew or expand; measured service economics |
| S4 — Enterprise readiness | Add deployment, identity, governance and support controls | Annual enterprise contracts | Security and operational controls pass review |
| S5 — Embedded expansion | Complete firmware/build/device-session linkage | Specialist add-on revenue | Multiple embedded teams use it repeatedly on real projects |

No stage starts merely because the previous stage has a date. Its exit gate must be met.

## 3. S0 — Release readiness

### Product and engineering
- Finish review and merge decisions for the active evidence-engine branch only after required CI and code review checks pass.
- Remove stale status claims from README, build state and roadmap.
- Define and test one supported end-to-end workflow.
- Keep unsupported functions visible as unsupported; do not show decorative or synthetic metrics as real output.
- Run a threat-model review for untrusted repositories, logs, XML reports, file paths and local database files.
- Confirm Windows, macOS and Linux behaviour for every advertised command.
- Publish a reproducible fixture repository and label synthetic telemetry as DEMO.

### Public project hygiene
- Verify the ORBIT name across GitHub, package registries, domains and relevant trademark databases. The Master Plan currently calls ORBIT a working codename.
- Decide the actual project licence and add the corresponding LICENSE file. Apache-2.0 is the current target, not yet a granted licence.
- Add contribution, security-reporting, code-of-conduct and support expectations appropriate to project maturity.
- Review GitHub author-email privacy and public account identity before additional public commits.
- Document dependency licences and third-party notices.

**Exit gate:** A new contributor can clone, install, run tests, execute the supported workflow and understand what is and is not implemented. No unresolved critical security, licence or privacy blocker remains.

## 4. S1 — Community preview

### Minimum coherent product
Prioritise a narrow vertical slice:

1. Scan and index a supported repository.
2. Inspect a real change and its affected code.
3. Ingest actual test and coverage reports.
4. Explain what the evidence supports and what remains unmeasured.
5. Generate and export a deterministic Change Passport.
6. Query local repository context through the read-only interface where implemented.

The local-first workflow should:
- Work without a hosted account or AI key.
- Keep repository source and evidence local by default.
- Explain limitations in every report.
- Provide clear setup, error and recovery guidance.
- Include a realistic demo without presenting synthetic data as real.

### Distribution
- Publish versioned releases with changelog and compatibility matrix.
- Distribute the CLI through a suitable package channel once package ownership and release automation are ready.
- Provide a GitHub Action only after permission scope, fork behaviour and security boundaries are reviewed.
- Publish a walkthrough video and a fixture-backed technical demo.
- Maintain a small number of high-quality starter issues for contributors.

**Exit gate:** Fresh-clone acceptance workflow passes on supported operating systems; external developers can complete it without private assistance; no unsupported feature is represented as finished.

## 5. S2 — Design-partner pilot

Recruit 5–10 teams, ideally including:
- 3–5 product engineering teams using GitHub and CI.
- 2–3 embedded / firmware teams willing to test the evidence-linkage direction.
- 1–2 maintainers or consultancies for varied workflow feedback.

The pilot remains local-first. Do not build a full cloud platform before confirming that teams need shared evidence rather than merely a better local tool.

### Pilot process
- Agree on one measurable workflow per team.
- Record a baseline: review time, test-investigation effort, repeated manual steps and current tooling.
- Install ORBIT on a real repository with explicit approval.
- Observe setup, first useful output, repeated usage and failure cases.
- Conduct a weekly feedback session and maintain a prioritised issue log.
- Ask the actual budget owner about a paid pilot only after value is demonstrated.

### Evidence to collect
- Time from install to first useful Change Passport.
- Number of real changes analysed per week.
- Which missing-evidence findings caused a useful action.
- Where ORBIT duplicated existing tools.
- Setup failures, parser errors and support hours.
- Security / privacy objections and requested deployment boundaries.
- Written willingness to pay and paid-pilot commitments.

**Exit gate:** At least 5 teams complete real workflows; at least 3 budget owners discuss a paid pilot; at least 2 teams make a paid-pilot commitment or equivalent procurement step. If this is not achieved, revisit positioning before adding more features.

## 6. S3 — ORBIT Team paid beta

Only build the hosted collaboration layer after pilot evidence demonstrates a shared-workspace need.

### Product requirements before charging
- Workspace, organisation and member model.
- Authentication, invitation and offboarding.
- Role-based access for shared content.
- Explicit selection of which evidence metadata and artifacts sync.
- Encryption in transit and at rest.
- Retention configuration and predictable quotas.
- Export, account deletion and workspace deletion.
- Audit trail for workspace administration.
- Billing, subscription state, failed-payment handling and cancellation.
- Operational monitoring, backups and incident response.
- Clear status page and support process appropriate to the beta.

### First paid capabilities
- Team workspaces and shared evidence timelines.
- Cross-repository views.
- Shared verification policies.
- PR and CI integrations.
- Opt-in evidence sync.
- Team-level dashboards that explain their underlying events.
- Agreed retention and export.

Do not introduce mandatory source-code upload, hidden telemetry or pay-per-scan billing. Use transparent storage and retention limits.

### Launch gate
- At least 2 paid pilot customers.
- Repeated weekly use by more than one person in each paid workspace.
- Cost per active workspace measured under real usage.
- Working export and deletion paths.
- Support and incident ownership established.
- No critical security issue outstanding.

## 7. S4 — Enterprise readiness

Enterprise work should follow actual buyer requirements rather than a speculative feature checklist.

Potential requirements:
- Customer-controlled / private deployment.
- SAML SSO and SCIM.
- Central role and policy management.
- Audit export and retention controls.
- Private networking and deployment documentation.
- Data-processing agreement and subprocessor register.
- Backups, disaster recovery and incident response.
- Security questionnaire and vulnerability-disclosure process.
- Support ownership, escalation and contractually realistic SLAs.

Security certifications are a separate programme with evidence, scope and independent assessment. Do not claim SOC 2, ISO 27001 or equivalent before certification is complete.

**Exit gate:** At least two qualified enterprise prospects have documented requirements, the controls are implemented and tested, and support commitments can be met without depending on a single developer.

## 8. S5 — Embedded engineering expansion

The embedded direction can become a strong specialist product, but only after the software evidence workflow has real users.

Sequence:
1. Complete read-only serial capture with explicit local approval.
2. Support configured telemetry parsers and robust session recording.
3. Link a recorded session to a user-supplied firmware build ID and commit.
4. Compare sessions across firmware versions with clear provenance.
5. Add useful reset / watchdog / anomaly investigation without inventing diagnoses.
6. Validate with ESP32, STM32 and other boards selected by design partners.
7. Add fleet-level organisation only when users demonstrate a real need.

**Exit gate:** Multiple embedded teams use the workflow repeatedly and can show that commit/build/session linkage reduces investigation effort.

## 9. Commercial metrics and gates

Use a small scorecard. Do not optimise for vanity metrics.

| Area | Metric | Why it matters |
|---|---|---|
| Activation | Time to first useful Change Passport | Shows whether setup and first value are understandable |
| Product usage | Weekly active workspaces and repeat evidence workflows | Distinguishes recurring value from one-off curiosity |
| Evidence quality | Correctness of parsing, provenance and explicit missing-evidence reporting | Trust is the product |
| Retention | 4- and 8-week team retention | Indicates whether the workflow is habitual |
| Conversion | Design-partner-to-paid conversion | Validates willingness to pay |
| Revenue | MRR, ARR, expansion, renewal and churn | Tracks commercial health |
| Economics | Hosting / storage cost per workspace and support hours per account | Shows whether the business can scale |
| Reliability | Setup failure rate, crash rate and unresolved critical defects | Protects user trust |

Initial targets should be treated as pilot hypotheses, not reported achievements. Publish only measured numbers and state sample size, period and method.

## 10. Build / buy boundaries

**Build as ORBIT product IP:** evidence graph semantics, provenance, deterministic Change Passport, cross-engine correlation, embedded build/session linkage and local-first workflow.

**Integrate rather than replace:** GitHub, CI providers, test frameworks, coverage formats, identity providers and customer observability systems.

**Buy / use established services where appropriate:** payment processing, email delivery, hosted authentication, monitoring and cloud infrastructure—after privacy, cost and portability reviews.

Do not build a bespoke billing system or identity provider before the product has paying customers.

## 11. Stop / change rules

Pause expansion and revisit the product when:
- Pilot teams do not use the workflow repeatedly.
- Users cannot identify evidence that changed a review or investigation decision.
- Setup or parser failure blocks the main workflow.
- The hosted layer is requested less often than better local integrations.
- Support burden exceeds the revenue the product can reasonably earn.
- Privacy or security requirements cannot be met by the proposed architecture.

A smaller tool that works and is trusted is better than a broad platform full of incomplete screens.

## 12. Near-term next actions

1. Resolve the current feature PR with review and green CI; do not merge solely to advance the roadmap.
2. Finish one end-to-end workflow and update the public README to match the shipped branch.
3. Complete licence, project-name, security and privacy release prerequisites.
4. Recruit the first 5 design partners and capture baseline metrics.
5. Use pilot evidence to decide whether Team sync, embedded hardware capture or another capability is the next highest-value investment.

The business roadmap is deliberately gated by product truth: **sell only what is implemented, measured and supportable.**
