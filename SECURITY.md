# Security Policy

ORBIT is local-first engineering tooling. It is not a security certification and does not guarantee that analysed code is safe or correct.

## Supported versions

Security fixes are currently developed against the default branch, `main`. Until tagged releases exist, there is no formal backport policy for older revisions.

## Reporting a vulnerability

Please do not open a public issue for an exploitable vulnerability.

Use GitHub's **Private vulnerability reporting** feature for this repository if it is enabled. If it is unavailable, contact the repository maintainers privately through GitHub before sharing technical details publicly. Do not include live credentials, private keys, customer source code or personal data in a report.

Please include:
- A concise description and impact.
- Affected commit, tag or component.
- Reproduction steps using a harmless test fixture.
- Any known prerequisites and mitigations.
- Whether the issue requires local user interaction.

We will acknowledge reports when practical, validate the issue, coordinate a fix and agree on disclosure timing. No response-time SLA is promised until a maintained release process exists.

## Security boundaries

- Treat repository source, diffs, test reports, coverage files and telemetry as untrusted input.
- Do not automatically execute analysed repository code.
- Keep the local API bound to loopback. Do not expose it to a LAN or public network.
- Keep `.orbit/api.token`, API keys and credentials out of Git, logs, reports and issue comments.
- MCP tools are intended to be read-only and bounded.
- AI providers are optional. Do not send source or evidence to an external provider unless the user explicitly configures and approves that data flow.
- Recorded device telemetry is data input; it is not a device-control channel.

## Scope

Potentially in scope: path traversal, arbitrary code execution, authentication bypass, secret disclosure, repository isolation failure, evidence/ledger integrity bypass, unsafe parser behavior, dependency/supply-chain issues and unintended hardware commands.

Out of scope: unsupported configurations, vulnerabilities requiring a deliberately exposed local API, or claims that ORBIT missed a bug in the repository it analysed—unless the report demonstrates a vulnerability in ORBIT itself.
