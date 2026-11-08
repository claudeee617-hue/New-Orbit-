
import { describe, expect, it, vi } from 'vitest';
import {
  OrbitAIError,
  prepareAIContext,
  runOrbitAnalysis,
  type EvidenceContextItem,
} from './provider.js';

const evidence: EvidenceContextItem[] = [
  {
    id: 'ev-coverage-1',
    source: 'coverage/lcov.info',
    sha256: 'a'.repeat(64),
    content: 'Changed line 14 is uncovered. api_token=sk-abcdefghijklmnopqrstuvwxyz123456',
  },
];

function approved(provider: 'openai' | 'anthropic' | 'ollama' = 'openai') {
  const context = prepareAIContext({
    provider,
    model: 'test-model',
    prompt: 'Explain the measured coverage gap.',
    evidence,
  });
  return {
    context,
    options: {
      enabled: true,
      userApproved: true,
      approvedContextSha256: context.sha256,
      provider,
      model: 'test-model',
    } as const,
  };
}

describe('ORBIT AI privacy and approval boundary', () => {
  it('makes no request while AI is disabled', async () => {
    const { context, options } = approved();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      runOrbitAnalysis({ ...options, enabled: false, fetchImpl }, context),
    ).rejects.toMatchObject({ code: 'AI_DISABLED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires explicit user approval and the exact preview hash', async () => {
    const { context, options } = approved();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      runOrbitAnalysis({ ...options, userApproved: false, fetchImpl }, context),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    await expect(
      runOrbitAnalysis({ ...options, approvedContextSha256: '0'.repeat(64), fetchImpl }, context),
    ).rejects.toMatchObject({ code: 'CONTEXT_MISMATCH' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('redacts common credential patterns before creating the preview', () => {
    const { context } = approved();
    expect(context.text).toContain('[REDACTED]');
    expect(context.text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(context.redactions).toBe(1);
  });

  it('binds approval to the destination as well as the context text', async () => {
    const { context, options } = approved();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      runOrbitAnalysis(
        { ...options, apiKey: 'test-secret', fetchImpl },
        { ...context, destination: 'https://attacker.example/collect' },
      ),
    ).rejects.toMatchObject({ code: 'CONTEXT_MISMATCH' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks remote Ollama destinations unless separately approved', () => {
    expect(() =>
      prepareAIContext({
        provider: 'ollama',
        model: 'local-model',
        prompt: 'Review this evidence.',
        evidence: [],
        baseUrl: 'https://remote.example',
      }),
    ).toThrow(OrbitAIError);
  });

  it('uses OpenAI Responses with storage disabled and no tools', async () => {
    const { context, options } = approved();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ output_text: 'The measured gap is in [ev-coverage-1].' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await runOrbitAnalysis(
      { ...options, apiKey: 'test-secret', fetchImpl },
      context,
    );
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init?.headers).toMatchObject({ authorization: '***' });
    const payload = JSON.parse(String(init?.body));
    expect(payload.store).toBe(false);
    expect(payload.tools).toBeUndefined();
    expect(result.citationStatus).toBe('CITED');
    expect(JSON.stringify(result)).not.toContain('test-secret');
  });

  it('parses Anthropic Messages text blocks', async () => {
    const { context, options } = approved('anthropic');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'Review based on [ev-coverage-1].' }],
        }),
        { status: 200 },
      ),
    );
    const result = await runOrbitAnalysis(
      { ...options, apiKey: 'anthropic-test-key', fetchImpl },
      context,
    );
    expect(result.provider).toBe('anthropic');
    expect(result.citationStatus).toBe('CITED');
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      'anthropic-version': '2026-10-21',
    });
  });

  it('uses only local Ollama by default', async () => {
    const { context, options } = approved('ollama');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: { content: 'Review based on [ev-coverage-1].' } }), {
          status: 200,
        }),
      );
    const result = await runOrbitAnalysis({ ...options, fetchImpl }, context);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://127.0.0.1:11434/api/chat');
    expect(result.provider).toBe('ollama');
  });
});
##[group]Run pnpm run check
pnpm run check
shell: /usr/bin/bash -e {0}
env:
  PNPM_HOME: /home/runner/setup-pnpm/node_modules/.bin
