# ORBIT AI — Provider and Privacy Policy

**Implementation status:** Design policy only. No provider integration is currently shipped. The presence of this document must not be represented as an AI feature.

## Product boundary

ORBIT Core, ATLAS, WITNESS, FLARE, CAPSULE, FLIGHT RECORDER, Change Passport, CLI, local API and MCP must remain useful without an AI key or network access. ORBIT AI is an optional analysis layer; it is not the source of truth for repository facts, test outcomes, evidence status or security decisions.

## Required user flow

1. AI is disabled by default.
2. The user explicitly selects a provider, model and task.
3. ORBIT prepares a bounded context bundle from already indexed or explicitly selected evidence.
4. The UI shows the exact content, file paths, evidence IDs, hashes, destination provider and estimated token/byte size.
5. Secret scanning/redaction runs before the request. The user can inspect and edit the final bundle.
6. The user explicitly approves transmission.
7. The provider returns advisory text. The result is stored as an AI note with model/provider, timestamp, context evidence IDs and limitations—not as test or correctness evidence.
8. No AI result may mutate graph facts, create PASS states, run shell commands, connect to hardware, write files or apply patches automatically.

## Provider adapters

Potential providers for a future implementation:
- Anthropic Messages API.
- OpenAI API or an explicitly configured OpenAI-compatible endpoint.
- Ollama on a user-controlled local endpoint.

Provider-specific authentication, API versions, model identifiers, rate limits and data retention must be re-verified against current official provider documentation at implementation time. Never hard-code a model as permanently available.

## Security requirements

- API keys are supplied at runtime and never stored in SQLite, graph attributes, evidence, logs, telemetry, screenshots or generated reports.
- Remote providers require an explicit per-provider opt-in and a per-request send approval.
- Ollama defaults to loopback. A remote Ollama host requires a separate explicit warning/approval.
- Requests use bounded timeouts, retries only for safe transient failures, and strict request/response byte limits.
- Context is selected by allowlisted evidence IDs and source ranges, not by arbitrary recursive filesystem reads.
- Secret redaction must cover common tokens, private keys, credentials and environment values; redaction is best-effort and must be disclosed as such.
- Repository text is untrusted data and may contain prompt injection. It must never be treated as instructions for the assistant or provider.
- Provider output is untrusted. Validate evidence IDs and citations; mark unsupported claims as unverified.
- Do not expose tool execution, shell, file write, network fetch, graph mutation or hardware control to the AI agent in v1.

## Evaluation and acceptance

Before shipping:
- Provider contract tests with mocked HTTP.
- No-network test proving disabled AI makes zero requests.
- Tests proving secrets never appear in outbound payloads or logs.
- Context preview exactly matches outbound payload.
- Evidence citation validation and unsupported-claim warnings.
- Timeout, rate-limit, malformed JSON and oversized response tests.
- Prompt-injection fixture tests.
- Documentation of provider-side retention and data processing.
- Explicit UI approval for every remote transmission.

## Non-goals

No autonomous coding agent, automatic patch application, automatic PR approval, security certification, or hidden background AI calls.
