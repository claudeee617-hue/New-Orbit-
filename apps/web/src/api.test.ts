import { describe, expect, it, vi } from 'vitest';
import { createOrbitApiClient, OrbitApiError } from './api.js';

const TOKEN = 'orbit-test-token-'.padEnd(48, 'x');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('local ORBIT API client', () => {
  it('sends the bearer token in a header and never in the URL', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ repositories: [] }));
    const client = createOrbitApiClient({ token: TOKEN, fetchImpl });

    await client.listRepositories();

    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/repositories', {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${TOKEN}` },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain(TOKEN);
  });

  it('encodes repository keys and query values', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ repository: {}, impact: {} }));
    const client = createOrbitApiClient({ token: TOKEN, fetchImpl });

    await client.getImpact('local/a project', 'src/a b.ts');

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      '/api/v1/repositories/local%2Fa%20project/reports/impact?file=src%2Fa+b.ts',
    );
  });

  it('rejects malformed tokens before making a request', () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(() => createOrbitApiClient({ token: 'short', fetchImpl })).toThrow(OrbitApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('turns authentication failures into a safe actionable error', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: 'UNAUTHENTICATED', message: 'Sensitive server detail' }, 401),
      );
    const client = createOrbitApiClient({ token: TOKEN, fetchImpl });

    await expect(client.listRepositories()).rejects.toMatchObject({
      name: 'OrbitApiError',
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'The local API token was rejected. Check the api.token file and try again.',
    });
  });

  it('passes abort signals through to fetch', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ repositories: [] }));
    const controller = new AbortController();
    const client = createOrbitApiClient({ token: TOKEN, fetchImpl });

    await client.listRepositories(controller.signal);

    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
  });
});
