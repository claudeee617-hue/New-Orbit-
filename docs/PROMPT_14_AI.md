# Prompt 14 — ORBIT AI local setup

**Status:** Experimental implementation on a draft branch. This is not a published feature.

## 1. Build the workspace

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm dev
```

Start the local API and dashboard using the repository's configured development scripts. The dashboard must connect to the loopback API with the private local API token.

## 2. Configure one provider on the API process

AI analysis is disabled unless `ORBIT_AI_ENABLED=true` is set in the environment of the local API process. Do not place provider keys in the browser, repository files, `.env.example`, CI logs or Git.

OpenAI:

```bash
ORBIT_AI_ENABLED=true
ORBIT_OPENAI_API_KEY=<your-key>
```

Anthropic:

```bash
ORBIT_AI_ENABLED=true
ANTHROPIC_API_KEY=<your-key>
```

Ollama (default loopback endpoint):

```bash
ORBIT_AI_ENABLED=true
ORBIT_OLLAMA_URL=http://127.0.0.1:11434
```

Remote Ollama is blocked by default. Only if you understand and approve the remote data flow, set `ORBIT_ALLOW_REMOTE_OLLAMA=true` and use an HTTPS endpoint.

The local API reads process environment variables. The current main entry point does not load an `.env` file automatically; configure the environment in your terminal, service manager or OS-specific secret manager before starting the API.

## 3. Preview before sending

1. Connect to the local API in the Command Center.
2. Open **AI Analysis**.
3. Choose provider and exact model identifier.
4. Select one or more repository evidence records.
5. Enter a bounded analysis question.
6. Select **Preview exact context**. This calls only the local API; it does not call the external provider.
7. Inspect the destination, evidence IDs, preview text, context size, redaction count and SHA-256.
8. Check the explicit approval box and select **Send approved context to provider**.
9. Review the returned advisory answer and citation status.

Changing the provider, model, question or selected evidence invalidates the preview and requires a new preview and approval.

## 4. What is sent today

The current Command Center sends selected evidence metadata only:
- evidence ID and source label,
- source type and status,
- commit identifier (when available),
- content hash,
- recorded limitations and related entity IDs.

It does not read or upload source files. The API supports optional user-provided excerpts, but the UI does not yet expose excerpt entry. Do not assume the AI has seen source code, full logs or artifacts unless they appear in the exact preview.

## 5. Safety and limitations

- Provider keys are server-side environment variables and are never returned by the API.
- AI is disabled by default.
- Context is capped at 48 KiB; provider response, output and timeout are bounded.
- Common secret patterns are redacted on a best-effort basis; inspect the preview.
- Ollama is loopback-only by default.
- AI responses are advisory, not test evidence, correctness proof or security approval.
- No graph writes, shell execution, file edits, patch application, hardware control or automatic PR approval are available.
- Citation status is a basic selected-evidence-ID check, not proof that every statement is supported.
- No persistent AI note/history UI or delete control exists yet.
- Live provider smoke tests and browser E2E tests are pending.

See [AI_PROVIDER_POLICY.md](AI_PROVIDER_POLICY.md) for the security boundary and remaining acceptance criteria.
