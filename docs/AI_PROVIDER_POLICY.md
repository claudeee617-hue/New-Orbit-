# ORBIT AI — Provider and Privacy Policy

**Implementation status:** `@orbit/ai` adapters, local API preview/approval endpoints and a Command Center preview/approval panel are implemented on a draft feature branch. The integration is not yet merged or released; E2E and provider smoke tests remain pending.

## Product boundary

ORBIT Core, ATLAS, WITNESS, FLARE, CAPSULE, FLIGHT RECORDER, Change Passport, CLI, local API and MCP remain useful without an AI key or network access. ORBIT AI is an optional analysis layer; it is not the source of truth for repository facts, test outcomes, evidence status or security decisions.

## Implemented provider adapters

- **OpenAI Responses API:** `POST https://api.openai.com/v1/responses`, bearer API key, `store: false`, no tools enabled.
- **Anthropic Messages API:** `POST https://api.anthropic.com/v1/messages`, `x-api-key` and version header.
- **Ollama:** `POST /api/chat`, defaults to `http://127.0.0.1:11434`; remote Ollama requires explicit opt-in and HTTPS.

Official API references:
- OpenAI: https://developers.openai.com/api/reference/overview and https://developers.openai.com/api/docs/guides/migrate-to-responses
- Anthropic: https://platform.claude.com/docs/en/api/overview
- Ollama: https://docs.ollama.com/api/introduction

Provider model names and API versions change. Re-verify them against official documentation before release.

## Required user flow

1. AI is disabled by default.
2. The user explicitly selects a provider, model and task.
3. ORBIT prepares a bounded context bundle from selected evidence items.
4. The application shows the exact context text, evidence IDs, hashes, destination, byte size and redaction count.
5. Secret scanning/redaction runs before the request. The user can inspect and edit the final bundle.
6. The user explicitly approves transmission. The adapter requires the SHA-256 of the exact approved preview; changing the context, provider, model or destination invalidates approval.
7. The provider returns advisory text. The result is not test or correctness evidence.
8. No AI result may mutate graph facts, create PASS states, run shell commands, connect to hardware, write files or apply patches automatically.

## Current package safeguards

- No provider SDK dependency; requests use injected/global fetch.
- Disabled AI and missing approval are rejected before network access.
- Context is capped at 48 KiB; evidence count, prompt size, response bytes, output characters and timeout are bounded.
- Best-effort redaction for common API keys, GitHub tokens, AWS access-key IDs, bearer tokens, private-key blocks and credential assignments.
- The exact preview is SHA-256 bound to the approval.
- Ollama defaults to loopback; remote destinations require a separate explicit flag and HTTPS.
- OpenAI storage is disabled and no tools are sent.
- Provider error messages do not echo response bodies or credentials.
- Responses are marked CITED only when a selected evidence ID appears in the text; otherwise citations are marked missing.
- The adapter never writes to ORBIT's graph or invokes local tools.

## Remaining work before user-facing release

- Integrate with the local API and Command Center, including a context preview/approval screen.
- Keep provider keys server-side and never expose them to browser JavaScript.
- Add cancellation support, token/cost estimates and model capability selection.
- Add tests for timeout, oversized response, malformed JSON, 401/429/5xx, remote destination approval, changed destination, redaction edge cases and prompt injection.
- Verify exact official provider schemas and version headers during release validation.
- Document provider-side retention, regional processing and account-level data settings.
- Add user-visible disclosure and a way to inspect/clear AI notes.
- Add browser E2E tests proving no provider network call occurs before the user approves the exact preview.

## Non-goals

No autonomous coding agent, automatic patch application, automatic PR approval, hidden background AI calls, tool use, shell execution or hardware control.


## Current local API integration

The local API exposes:
- `POST /api/v1/repositories/:key/ai/preview`: builds the exact provider-bound context from selected evidence metadata and optional user-supplied excerpts. This endpoint does not call the provider.
- `POST /api/v1/repositories/:key/ai/analyse`: requires `confirmed: true` and the preview SHA-256, reconstructs the context and sends it only when `ORBIT_AI_ENABLED=true`.

Environment configuration is process-local:
- `ORBIT_AI_ENABLED=false` by default; set to `true` only after choosing an explicit provider.
- `ORBIT_OPENAI_API_KEY` for OpenAI.
- `ANTHROPIC_API_KEY` for Anthropic.
- `ORBIT_OLLAMA_URL` defaults to loopback Ollama.
- `ORBIT_ALLOW_REMOTE_OLLAMA=true` is required for remote Ollama and remote endpoints must use HTTPS.

The current Command Center sends selected evidence metadata only. It does not read repository source files. API excerpts are supported for future use but not exposed as a browser file-reading feature.
