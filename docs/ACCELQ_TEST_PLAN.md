# ORBIT × ACCELQ — Enterprise Regression Test Plan

**Status:** Scenario design ready for tenant authoring. ACCELQ scenario assets have NOT been created in a tenant and no live ACCELQ run has been performed. This document is the source-controlled authoring blueprint.

## 1. Execution architecture

Use the three test layers together:

1. Repository unit/integration tests and the existing Playwright Chromium E2E suite remain the fast, deterministic baseline.
2. ACCELQ executes the business-process and API/UI regression scenarios saved in the ACCELQ project.
3. ACCELQ Local Agent runs the job on an isolated host that can access the target ORBIT environment, its local API and test data.

The GitHub Actions workflow triggers a **saved ACCELQ CI Template Job**. The template must already reference the intended application environment, suite/scenarios, browser profile and Local Agent assignment. Triggering the job does not deploy the current GitHub PR or build ORBIT automatically.

Recommended first pilot:
- Deploy the PR head to a disposable staging environment.
- Seed it with a disposable ORBIT workspace and known repository fixture.
- Configure the ACCELQ Application Environment to that staging URL.
- Configure a dedicated Local Agent that can reach the staging app and API.
- Run the saved ACCELQ CI job manually once in ACCELQ.
- Trigger the same saved job from GitHub Actions only after the manual run is successful.

Never point the suite at a production database or a developer's personal workstation.

## 2. ACCELQ project setup

Create or select an ACCELQ project dedicated to ORBIT regression. Configure the following:

### Application Environments

Create separate environment definitions:
- `ORBIT-DEV` — development smoke only.
- `ORBIT-QA` — primary automated regression target.
- `ORBIT-STAGING` — release-candidate validation.

The first GitHub pilot should use `ORBIT-QA` or another disposable environment, not production. Keep application URLs and non-secret environment selectors in ACCELQ Application Environments / Run Properties. Store passwords and keys as encrypted ACCELQ properties or approved secret references.

### Local Agent

- Install/register a dedicated ACCELQ Local Agent on a stable VM or machine.
- Confirm that the Agent is online in ACCELQ and can reach the selected ORBIT application URL and API host.
- Ensure the Agent browser and driver versions are supported by the tenant.
- Assign the Agent explicitly in the saved CI job.
- Verify the Agent can read only the disposable test fixtures and required test data.
- Confirm outbound connectivity to the ACCELQ service; follow ACCELQ's official Agent network requirements. Do not expose inbound ports just for the Agent.

### Local Agent installation and permissions

For a machine with a desktop UI, ACCELQ's current install wizard flow is:

1. Sign in to ACCELQ and open **Resources → Local Agents**.
2. Choose **Download Agent** and select the installable for the Agent host OS.
3. Run the installer. It checks for a compatible JDK; the wizard can offer Zulu JDK if a supported JDK is not already present. Confirm the exact supported runtime versions against ACCELQ's current Agent requirements before installing.
4. Enter the ACCELQ server URL, the ACCELQ login user ID, and the API key from **Profile → Auth Properties**. Configure an outbound proxy only if the network requires it.
5. Give the Agent a unique, easy-to-recognize name. Install it to a path without spaces.
6. Enable auto-start on system startup for a dedicated CI host, where permitted by local IT policy.
7. Return to **Resources → Local Agents** and confirm that the Agent appears online/available.

For a headless host, ACCELQ also provides a Manual Setup / command-line installer. The manual flow generates an Agent Properties file in ACCELQ; place that file in the extracted Agent folder and start the OS-specific Agent script. Use ACCELQ's current CLI instructions for the installed release.

Choose Agent visibility deliberately:
- **User** scope: simplest pilot, visible only to the configured user.
- **Project** scope: recommended for an ORBIT-dedicated Agent where the operator has the correct project permission. ACCELQ Agent Properties may require the Project Code when this scope is selected.
- **Tenant** scope: only for a shared Agent intentionally available across the tenant.

**Important distinction:** Project Code may be required inside the Local Agent's agent.properties when choosing Project-level Agent visibility. It is *not* a required GitHub Actions secret for ORBIT's direct ACCELQ REST runner. GitHub needs only the five secrets listed in Section 5.

### Saved CI Template Job

Create a saved job such as `ORBIT-QA-REGRESSION`:
- Project: ORBIT.
- Environment: ORBIT-QA (or a disposable QA environment).
- Suite: ORBIT Core Regression.
- Agent: the dedicated ORBIT Local Agent.
- Browser: one supported desktop browser for the first pilot.
- Failure threshold: 0% (any failed test case fails the GitHub job).
- Include the critical smoke scenarios first; expand to full regression after a successful pilot.

The saved CI Template Job ID is the value required as `ACCELQ_JOB_ID`.

## 3. Scenario design

Create the following scenarios in ACCELQ. Prefix scenario IDs exactly as shown so they can be selected, tagged and reported consistently.

### Command Center — core UI

| Scenario ID | Purpose | Main steps | Expected result |
|---|---|---|---|
| ORBIT-CC-01 | Secure connect/disconnect | Open Command Center; enter a valid local API token; connect; inspect authenticated requests; disconnect | Workspace loads; token is sent only as Bearer Authorization; disconnect returns to connect screen |
| ORBIT-CC-02 | Empty workspace | Connect to a disposable empty workspace | Empty-state guidance appears; no fake metrics or sample repository is inserted |
| ORBIT-CC-03 | Repository selection | Connect with two seeded repositories; switch the Repository selector | Graph, evidence, passports and integrity refresh for the selected repository |
| ORBIT-CC-04 | API unavailable | Start UI with API unavailable; attempt connect/reload | Accessible error state appears; no stale workspace is presented as current |
| ORBIT-CC-05 | Rate limited | Use a controlled test client to exceed the configured integrity rate threshold | API returns 429 with Retry-After; UI gives a useful retry message |

### ATLAS — architecture graph

| Scenario ID | Purpose | Main steps | Expected result |
|---|---|---|---|
| ORBIT-ATLAS-01 | Graph overview | Load repository graph; inspect node/edge counts and ledger header | Counts are labelled as returned page data, not complete totals |
| ORBIT-ATLAS-02 | Graph type filtering | Select File, Function, Class and other populated node types | Exact type filter is applied; unsupported type is rejected by API |
| ORBIT-ATLAS-03 | Graph pagination | Seed more than one page of nodes and edges; load subsequent pages | Node and edge offsets advance independently; no duplicate page rows |
| ORBIT-ATLAS-04 | Node inspection | Select a file/symbol node and inspect attributes and connected edges | Selected record and loaded relationships are displayed; missing values remain explicit |
| ORBIT-ATLAS-05 | File impact | Select a seeded file node and choose Analyze impact | Impact endpoint returns affected relationships; nonexistent path is handled safely |

### WITNESS / FLARE — evidence and test reports

| Scenario ID | Purpose | Main steps | Expected result |
|---|---|---|---|
| ORBIT-WIT-01 | Evidence timeline | Seed dated and undated evidence; open Evidence view | Dated evidence is newest-first; undated rows are kept at the end |
| ORBIT-WIT-02 | Evidence pagination | Seed more than one evidence page; load more | Offset advances correctly and records are not duplicated |
| ORBIT-WIT-03 | Evidence integrity | Select evidence with known SHA-256; verify matching and mismatching local files | Match and mismatch are distinct; selected artifact is hashed in browser and is not uploaded |
| ORBIT-FLARE-01 | Test report ingestion | Ingest JUnit, pytest JSON, Jest JSON and Go test JSON reports in isolated fixtures | Valid reports create TestRun nodes and evidence with correct case totals |
| ORBIT-FLARE-02 | Invalid test report | Submit unsupported format, empty content or malformed report | API rejects invalid input with a bounded 4xx response; no partial record is presented as successful |

### PASSPORTS — versioned change records

| Scenario ID | Purpose | Main steps | Expected result |
|---|---|---|---|
| ORBIT-PASS-01 | Passport list | Seed multiple Change Passport versions; open Change Passports | Stored passport records and versions are listed |
| ORBIT-PASS-02 | Passport history | Select a passport; load version history | Correct version sequence is returned and displayed |
| ORBIT-PASS-03 | Passport comparison | Select before/after versions and compare | Comparison shows the correct two versions and differences |
| ORBIT-PASS-04 | Invalid passport ID | Request a missing passport/history/compare target | API/UI shows a safe not-found or validation error; no misleading comparison |

### CAPSULE / FLIGHT RECORDER — environment and telemetry evidence

| Scenario ID | Purpose | Main steps | Expected result |
|---|---|---|---|
| ORBIT-CAP-01 | Environment snapshot | Ingest an allowed runtime/toolchain/package snapshot | Environment node and evidence are created; evidence remains PARTIAL with its observational limitation |
| ORBIT-CAP-02 | Reject credential-like metadata | Attempt to include token/password/API-key-style keys in environment metadata | API rejects the payload; secret-like values do not appear in persisted output |
| ORBIT-FLIGHT-01 | Recorded telemetry | Ingest a small synthetic telemetry fixture | Telemetry session and analysis summary appear; evidence is explicitly observational/PARTIAL |
| ORBIT-FLIGHT-02 | Malformed telemetry | Submit malformed JSON/CSV/NDJSON or unsupported format | API returns validation error; no successful telemetry session is shown |

### Smart Locator / self-healing validation

Self-healing is a controlled locator-recovery capability, not proof that an assertion or business flow is correct. ACCELQ's Playback settings expose **Enable Self-Healing** for Smart Locator elements. Formal execution may recover Smart Locator elements when self-healing is enabled; availability and behavior can depend on the tenant's Autopilot/plan configuration.

Create these additional scenarios:
- `ORBIT-LOC-01` — Smart Locator baseline: identify key Command Center controls by stable semantic intent; run playback and formal execution with the original UI unchanged.
- `ORBIT-LOC-02` — Controlled locator drift: in a disposable UI fixture, change a non-semantic DOM attribute while preserving the same intended control and accessible name; enable self-healing and confirm the intended element is recovered.
- `ORBIT-LOC-03` — Ambiguous match safety: create two similar controls in a disposable fixture and verify the healed locator does not silently target the wrong action. Assert the business outcome, not merely that the click completed.
- `ORBIT-LOC-04` — Self-healing disabled control: run the same controlled drift with self-healing disabled and record the expected locator failure, then re-enable the setting and compare outcomes.

For each healing event, inspect the selected element and update/review the locator intentionally. A healed locator must never cause ORBIT tests to accept a wrong repository, wrong passport version, unintended destructive action or incorrect API token control.

### Security / API boundaries

| Scenario ID | Purpose | Main steps | Expected result |
|---|---|---|---|
| ORBIT-SEC-01 | Missing authentication | Call an authenticated API route without Bearer token | HTTP 401; no repository data leaks |
| ORBIT-SEC-02 | Invalid authentication | Call with an invalid token | HTTP 401; no partial data leaks |
| ORBIT-SEC-03 | Host protection | Send a request with a disallowed Host header | HTTP 403; request is rejected |
| ORBIT-SEC-04 | Input bounds | Send oversized pagination, invalid node types, malformed SHA or unsupported sourceType | HTTP 400; request is rejected without process crash |
| ORBIT-SEC-05 | Token handling | Connect, reload, disconnect, inspect browser storage and URL | Token is not in localStorage, sessionStorage, cookies, URL, query string or console output |
| ORBIT-SEC-06 | Ingestion sanitization | Submit credential-like field names or oversized ingestion payloads | Payload is rejected; credentials do not reach persisted evidence or reports |

### Accessibility / responsive UI

| Scenario ID | Purpose | Main steps | Expected result |
|---|---|---|---|
| ORBIT-A11Y-01 | Keyboard navigation | Traverse connect form, dashboard navigation, graph controls and workbench tabs with keyboard only | Logical focus order, visible focus, all controls operable, no keyboard trap |
| ORBIT-A11Y-02 | Dynamic status | Trigger loading, empty, error, 429 and success states | Status/error is announced through the appropriate accessible role |
| ORBIT-A11Y-03 | Reflow/zoom | Test mobile, tablet, desktop and 200% zoom | Primary workflows remain usable without clipped actions or unintended horizontal overflow |

Automated ACCELQ accessibility checks, if licensed, supplement but do not replace manual keyboard, screen-reader and WCAG 2.2 AA review.

## 4. Test data and fixtures

Use a disposable test database and deterministic fixture with:
- One empty repository workspace.
- One small repository with a handful of files/functions/classes.
- One larger fixture with more than 100 nodes, edges, evidence records and passports to force pagination.
- Evidence records with valid, invalid and absent SHA-256 values.
- A valid Change Passport version chain with at least two versions.
- A JUnit/pytest/Jest/Go test report fixture with known pass/fail/skip counts.
- Valid environment metadata with no credential-like property names.
- Synthetic telemetry data only; no real device logs or personal data.

Reset the disposable fixture between destructive setup runs. Do not rely on state left by a prior scenario.

## 5. GitHub Actions setup

Create these repository Actions secrets:

- `ACCELQ_APP_URL` — HTTPS root URL of the ACCELQ tenant server, not a project path.
- `ACCELQ_USER_ID` — ACCELQ account user ID/email corresponding to the API key.
- `ACCELQ_API_KEY` — API key from the same user's ACCELQ profile/auth properties.
- `ACCELQ_TENANT_CODE` — tenant code from Profile → Auth Properties.
- `ACCELQ_JOB_ID` — saved CI Template Job ID for ORBIT-QA-REGRESSION.

Optional repository variable:
- `ACCELQ_RUN_PROPERTIES_JSON` — JSON object of non-secret run properties (for example a documented Application Environment selector). Never put credentials in this value.

After the saved job has completed successfully from ACCELQ itself and the Agent is online, set repository variable:
- `ACCELQ_ENABLED` = `true`

The workflow runs the Node 22 runner's unit tests even before the vendor account is configured. The actual vendor job stays skipped until `ACCELQ_ENABLED=true` and the required secrets are present. Fork-originated pull requests never receive ACCELQ credentials.

## 6. First pilot acceptance criteria

The first pilot is a PASS only if:
1. The runner unit tests pass.
2. All six required secrets are present and configuration validation succeeds.
3. ACCELQ accepts the trigger request and returns at least one valid runtime PID.
4. The configured Local Agent picks up the job within the timeout.
5. The status endpoint reaches COMPLETED.
6. ACCELQ reports a non-zero total test count.
7. Failed and not-run test counts are both zero for the smoke suite.
8. GitHub Actions produces a summary with runtime PID and ACCELQ report link.
9. Credentials are absent from logs and the report.
10. The tested application environment and tested ORBIT commit are recorded separately and accurately.

A skipped job, no credentials, no Agent pickup, zero test cases, unknown status, or unverified environment is NOT RUN / BLOCKED / FAIL as applicable—not PASS.

## 7. Official vendor references

- Trigger external CI job: https://support.accelq.com/hc/en-us/articles/360021077312-REST-API-end-point-to-trigger-test-execution-externally
- Track external run status: https://support.accelq.com/hc/en-us/articles/360029298792-Tracking-status-of-a-test-job-with-external-REST-API
- ACCELQ Local Agent requirements: https://support.accelq.com/hc/en-us/articles/360027240691-Hardware-and-software-config-requirements-for-ACCELQ-Agent
- Local Agent behind firewall: https://support.accelq.com/hc/en-us/articles/360019691372-Securely-execute-tests-behind-firewall-using-Local-Agent
- Smart Locator / Locator-Free: https://support.accelq.com/hc/en-us/articles/48792897764877-Locator-Free-and-Smart-Locator
- Playback and self-healing: https://support.accelq.com/hc/en-us/articles/48792885705741-Playback-and-Validation
- Run properties and environments: https://support.accelq.com/hc/en-us/articles/38191464769165-Managing-API-Test-Environments-and-Configurations-in-ACCELQ
