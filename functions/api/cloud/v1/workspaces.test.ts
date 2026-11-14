import { describe, expect, it, vi } from 'vitest';
import { onRequest } from './workspaces.js';

function request(path = '/api/cloud/v1/workspaces', init: RequestInit = {}) {
  return new Request('https://orbit-command-center.pages.dev' + path, init);
}

describe('Pages cloud workspace bridge', () => {
  it('requires the Access assertion before calling the cloud service', async () => {
    const fetch = vi.fn();
    const response = await onRequest({
      request: request(),
      env: { ORBIT_CLOUD_API: { fetch } },
    });

    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('forwards the Access assertion and bounded query through the service binding', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ workspaces: [], nextCursor: null }));
    const response = await onRequest({
      request: request('/api/cloud/v1/workspaces?limit=50', {
        headers: { 'Cf-Access-Jwt-Assertion': 'signed-access-assertion' },
      }),
      env: { ORBIT_CLOUD_API: { fetch } },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaces: [], nextCursor: null });
    const forwarded = fetch.mock.calls[0]?.[0] as Request;
    expect(forwarded.url).toBe('https://orbit-cloud-api.internal/v1/workspaces?limit=50');
    expect(forwarded.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed-access-assertion');
    expect(forwarded.headers.get('origin')).toBeNull();
  });

  it('forwards only JSON workspace creation bodies', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ workspace: { id: 'w1' } }, { status: 201 }));
    const response = await onRequest({
      request: request('/api/cloud/v1/workspaces', {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': 'signed-access-assertion',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Research Lab' }),
      }),
      env: { ORBIT_CLOUD_API: { fetch } },
    });

    expect(response.status).toBe(201);
    const forwarded = fetch.mock.calls[0]?.[0] as Request;
    expect(forwarded.method).toBe('POST');
    expect(forwarded.headers.get('content-type')).toBe('application/json');
    expect(await forwarded.json()).toEqual({ name: 'Research Lab' });
  });

  it('rejects unsupported methods, paths and oversized payloads', async () => {
    const fetch = vi.fn();
    const env = { ORBIT_CLOUD_API: { fetch } };
    const assertion = { 'Cf-Access-Jwt-Assertion': 'signed-access-assertion' };

    const wrongPath = await onRequest({
      request: request('/api/cloud/v1/other', { headers: assertion }),
      env,
    });
    const wrongMethod = await onRequest({
      request: request('/api/cloud/v1/workspaces', { method: 'DELETE', headers: assertion }),
      env,
    });
    const oversized = await onRequest({
      request: request('/api/cloud/v1/workspaces', {
        method: 'POST',
        headers: { ...assertion, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x'.repeat(5000) }),
      }),
      env,
    });

    expect(wrongPath.status).toBe(404);
    expect(wrongMethod.status).toBe(405);
    expect(oversized.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
});
