# ORBIT — Product Requirements Document

Version: 0.1 (planning) · Date: 2026-11-07

## 1. Problem

Software changes are increasingly drafted by AI agents, yet reviewers still lack a reliable way to answer simple questions about a change:

- What did it actually touch, and what depends on it?
- Why was the old code written that way?
- Which tests ran, which lines did they cover, and are those tests reliable?
- Can I reproduce the environment it was built and tested in?
- For embedded work: what did the real device do?

Today the answers are scattered across the diff, CI logs, coverage files, issue threads, ad-hoc notes and serial terminals. Reviewers and AI agents reconstruct them by hand, or skip them.

Industry signals from the idea research (reported by the idea source, not independently re-verified here): a growing share of PRs start as AI drafts, most developers verify AI output locally, and few fully trust it. The direction is "verification infrastructure", not another code generator.

## 2. Vision

One code change → five engineering engines → one evidence-backed conclusion.

## 3. Target users

| Persona | Need |
|---|---|
| Application developer | Know what a change affects and whether it is verified before pushing |
| Open-source maintainer | Review PRs quickly with trustworthy evidence; spot flaky tests |
| DevOps / CI engineer | Understand CI failures over time; reproduce environments |
| AI-agent developer | Give agents grounded, bounded, evidence-linked context via MCP |
| Embedded / IoT engineer | Tie firmware builds and commits to recorded device sessions |
| Student / researcher | Inspect a repository's structure and history locally |

## 4. Goals

G1. Build a Living Engineering Graph connecting code, history, tests, CI, environments, builds, hardware and findings.
G2. Generate deterministic, evidence-linked Change Passports.
G3. Provide PR verification via CLI and a GitHub Action with no accounts or keys.
G4. Provide read-only MCP tools so agents can query ORBIT.
G5. Provide a Command Center UI where every control works and every metric is backed by data.
G6. Support embedded telemetry capture and replay as a distinguishing capability.

## 5. Non-goals

- Not an AI code generator or generic AI code reviewer.
- Not a cloud-only SaaS; no required hosted backend.
- Not a security certification or proof of correctness.
- No device control in v1 (read-only telemetry only).
- No automatic execution of untrusted repository code.
- No guarantee of stars, adoption or hackathon outcomes.

## 6. Functional requirements

### Core
- FR-C1 Store nodes, edges and evidence in SQLite with temporal metadata and provenance.
- FR-C2 Evidence records are append-only, SHA-256 hashed, and carry limitations.
- FR-C3 Deterministic output for identical input.
- FR-C4 Repository isolation between registered repos.

### ATLAS
- FR-A1 Scan repositories, detect languages, frameworks, dependencies, entry points, test files.
- FR-A2 Extract symbols, imports and (where supported) calls using real parsers; record source location and parser confidence.
- FR-A3 Architecture and dependency graphs, circular dependency detection, complexity hotspots.
- FR-A4 Incremental re-indexing with cache invalidation; monorepo and large-repo support.
- FR-A5 Persistent memory (decisions, constraints, fixes) with source references, staleness and conflict detection. AI summaries are never authoritative.
- FR-A6 Read-only MCP server exposing the tools listed in ROADMAP.

### WITNESS
- FR-W1 Base/head diff analysis; added/modified/deleted lines; changed-symbol mapping.
- FR-W2 Changed-line coverage from LCOV and Cobertura; regression vs. base.
- FR-W3 Statuses: PASS, FAIL, PARTIAL, NOT_MEASURED, INCOMPLETE. Missing coverage is never shown as 0% without explanation.
- FR-W4 Deterministic findings with stable IDs, severity, location, evidence, suggested action.
- FR-W5 Output Markdown, JSON, SARIF 2.1.0.

### FLARE
- FR-F1 Ingest JUnit XML, pytest, Jest, Go test JSON reports into a historical store.
- FR-F2 Flip detection, Wilson-interval flakiness estimates, duration trends, failure clusters.
- FR-F3 Distinguish confirmed recurring failures from low-sample suspicions.
- FR-F4 Never alter or suppress tests.

### CAPSULE
- FR-E1 Detect package managers, lockfiles, runtimes, toolchains, build/test commands, env variable **names**.
- FR-E2 Environment fingerprint, manifest, comparison, reproduction guide.
- FR-E3 Replay only with explicit approval, isolation where practical, captured stdout/stderr/exit status, new evidence record.

### FLIGHT RECORDER
- FR-H1 Read-only capture from USB serial and replay from CSV/JSON/NDJSON/key-value logs.
- FR-H2 Configurable parser; recognise voltage, current, temperature, memory, boot/reset/watchdog events, custom metrics.
- FR-H3 Session recording, playback, filtering, anomaly highlighting, CSV/JSON export.
- FR-H4 Link a session to a user-chosen device identity, firmware build ID and commit SHA when supplied.
- FR-H5 Synthetic demo mode, visibly labelled DEMO.

### Change Passport / Replay Room
- FR-P1 Immutable, versioned passport with commit, base, diff hash, impact refs, evidence, findings, missing verification, environment, build and hardware refs.
- FR-P2 Never claim hardware verification without a matching device session.
- FR-P3 Rule-based evidence completeness assessment; no single "confidence %".
- FR-P4 Same evidence ⇒ same passport.
- FR-P5 Replay Room: open passports, browse timeline, compare reports and fingerprints, generate a reproduction plan.

### Interfaces
- FR-I1 Local API (Fastify) and CLI (`orbit …`) with JSON mode and meaningful exit codes.
- FR-I2 GitHub Action: PR analysis, single updatable comment, annotations, SARIF, least privilege, fork-safe, no `pull_request_target` code execution.
- FR-I3 Command Center web UI (dark-first, responsive, working controls, empty/error/loading/disconnected states).
- FR-I4 Optional AI layer (Claude, OpenAI-compatible, Ollama) with specialist roles, bounded context, citations, human approval for any modification.

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Privacy | No telemetry by default; no source code leaves the machine by default |
| Security | Input validation, size limits, path-traversal defence, safe XML, secret redaction |
| Reliability | Deterministic results; failing tests block phase completion |
| Portability | Windows, macOS, Linux; Node.js current LTS |
| Performance | Measured with reproducible benchmarks; no invented claims |
| Extensibility | Parsers, CI adapters, hardware transports and MCP tools are pluggable |
| Honesty | Every report states limitations; unsupported features are listed, not implied |

## 8. Success measures (planning-level)

- A fresh clone installs and runs the demo with the documented commands.
- The acceptance workflow in ROADMAP passes end to end on the fixture repository.
- Every dashboard metric traces to stored data or a DEMO-labelled fixture.
- Security regression suite passes.

Adoption metrics (stars, downloads) are explicitly **not** engineering targets and are never fabricated.
