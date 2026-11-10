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
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ repositories: [] }));
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

  it('sends independent graph node and edge offsets', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}));
    const client = createOrbitApiClient({ token: TOKEN, fetchImpl });

    await client.getGraph('repo', { limit: 100, nodeOffset: 200, edgeOffset: 400 });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      '/api/v1/repositories/repo/graph?limit=100&nodeOffset=200&edgeOffset=400',
    );
  });

  it('sends evidence offset in the query string', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ repository: {}, evidence: [], page: {} }));
    const client = createOrbitApiClient({ token: TOKEN, fetchImpl });

    await client.getEvidence('repo', { limit: 100, offset: 200 });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      '/api/v1/repositories/repo/evidence?limit=100&offset=200',
    );
  });

  it('loads passport history using encoded repository and passport identifiers', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ history: [] }));
    const client = createOrbitApiClient({ token: TOKEN, fetchImpl });

    await client.getPassportHistory('repo/a', 'passport 1');

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      '/api/v1/repositories/repo%2Fa/passports/passport%201/history',
    );
  });

  it('compares two passport versions using encoded path identifiers', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ comparison: {} }));
    const client = createOrbitApiClient({ token: TOKEN, fetchImpl });

    await client.comparePassports('repo', 'before/a', 'after b');

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      '/api/v1/repositories/repo/passports/before%2Fa/compare/after%20b',
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

  it('exposes Retry-After seconds for rate-limited API responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'RATE_LIMITED', message: 'Try again shortly' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '17' },
      }),
    );
    const client = createOrbitApiClient({ token: TOKEN, fetchImpl });

    await expect(client.getIntegrity('example')).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 17,
    });
  });

  it('passes abort signals through to fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ repositories: [] }));
    const controller = new AbortController();
    const client = createOrbitApiClient({ token: TOKEN, fetchImpl });

    await client.listRepositories(controller.signal);

    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
  });
});
