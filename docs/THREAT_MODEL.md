# ORBIT — Threat Model

Version: 0.1 · Date: 2026-11-07
ORBIT is not a security certification and does not guarantee correctness of the code it analyses.

## 1. Assets

| Asset | Why it matters |
|---|---|
| Developer source code | Private IP; must not leave the machine by default |
| Evidence store (SQLite) | Integrity of the audit trail |
| Credentials (GitHub token, AI provider keys) | Account compromise |
| Environment variable values | Often secrets |
| Hardware devices | Physical side effects if commanded |
| Developer machine | Target of malicious repo content |
| PR comments / SARIF | Could leak sensitive paths or values |

## 2. Trust boundaries

1. Repository content and PR diffs: **untrusted**.
2. Coverage, test and telemetry files: **untrusted** (may be crafted).
3. Local API/CLI/UI: trusted user, but local network exposure must be controlled.
4. MCP clients: semi-trusted; tools are read-only and bounded.
5. External AI providers: receive only bounded, user-approved context.
6. Serial devices: untrusted data source; commands disabled by default.

## 3. Threats and mitigations (STRIDE-style)

| # | Threat | Mitigation | Test |
|---|---|---|---|
| T1 | Path traversal via file paths in reports/diffs (`../../etc/passwd`, absolute paths, symlinks) | Central path resolver confined to registered roots; reject escapes; do not follow symlinks outside root | Security suite |
| T2 | XML external entity / entity expansion in Cobertura/JUnit | Parser with DTD and external entities disabled; entity-expansion limits | Malicious XML fixtures |
| T3 | Decompression/size bombs, huge reports | File-size, depth, element and line limits with clear errors | Oversized fixtures |
| T4 | Malicious repo runs code during analysis | No automatic execution; replay requires approval and isolation | Unit tests asserting no spawn in analysis paths |
| T5 | GitHub Action abuse via forked PRs / `pull_request_target` | Use `pull_request`; analyse artifacts and diffs only; minimal permissions; never check out and run untrusted code with secrets | Workflow lint test |
| T6 | Secret leakage in reports (env values, tokens in logs) | Store env names only; redaction on ingest and export; secret-pattern scanner | Redaction tests |
| T7 | Tampering with stored evidence | Content hashes plus hash-chained ledger; verify command | Ledger tests |
| T8 | Local API exposed to LAN or via browser CSRF/DNS rebinding | Bind 127.0.0.1; Host/Origin checks; per-session token | API tests |
| T9 | MCP tool misuse or prompt injection through repo text | Read-only tools; bounded output; content marked as data; AI output never auto-applied | MCP tests |
| T10 | AI exfiltrates source to an external provider | Off by default; show exactly what context is sent; per-provider opt-in | Config tests |
| T11 | Serial device sends hostile data (huge lines, control sequences) | Line-length limits, strict parsing, sanitised display | Parser fuzz tests |
| T12 | Unintended device commands | Read-only transport in v1; any write path gated by explicit approval | Transport tests |
| T13 | Credential storage on disk | Prefer OS keychain or env vars; never write tokens into the DB or reports | Config review |
| T14 | Supply-chain risk from dependencies and native modules | Lockfile, audit in CI, minimal dependencies, pin MCP SDK | CI job |
| T15 | Misleading output (false PASS) | Never show PASS without evidence; limitations on every report | Scenario tests |

## 5. Privacy

- No telemetry by default.
- No source upload by default.
- Reports contain paths and line numbers but no secret values.
- Privacy policy and `SECURITY.md` to be published in Prompt 15.

## 6. Residual risks

- Parser bugs may produce incorrect graph edges (mitigated by confidence and source locations).
- Coverage files can be wrong or stale; ORBIT reports what was supplied.
- Dependency vulnerabilities outside our control.

## 7. Responsible disclosure

`SECURITY.md` will describe a private reporting channel and response expectations (Prompt 15).
