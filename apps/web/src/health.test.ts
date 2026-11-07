import { describe, expect, it } from 'vitest';
import { loadHealth } from './health.js';

function jsonResponse(body: unknown, status = 200): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )) as typeof fetch;
}

const okBody = {
  status: 'ok',
  service: 'orbit-api',
  version: '0.0.1',
  database: { connected: true, schemaVersion: 1 },
};

describe('loadHealth', () => {
  it('returns connected for a healthy API', async () => {
    const state = await loadHealth(jsonResponse(okBody));
    expect(state.kind).toBe('connected');
  });

  it('returns degraded when the API reports a database problem', async () => {
    const degraded = {
      ...okBody,
      status: 'degraded',
      database: { connected: false, schemaVersion: null },
    };
    const state = await loadHealth(jsonResponse(degraded, 503));
    expect(state.kind).toBe('degraded');
  });

  it('returns disconnected when the request fails', async () => {
    const failing = (() => Promise.reject(new TypeError('network down'))) as typeof fetch;
    const state = await loadHealth(failing);
    expect(state).toEqual({ kind: 'disconnected', reason: 'The ORBIT API could not be reached.' });
  });

  it('returns disconnected for non-JSON bodies', async () => {
    const html = (() =>
      Promise.resolve(new Response('<html></html>', { status: 502 }))) as typeof fetch;
    const state = await loadHealth(html);
    expect(state.kind).toBe('disconnected');
    expect(state.kind === 'disconnected' && state.reason).toContain('502');
  });

  it('rejects JSON that does not look like an ORBIT health response', async () => {
    const state = await loadHealth(jsonResponse({ hello: 'world' }));
    expect(state.kind).toBe('disconnected');
  });

  it('requests the same-origin /api/health path', async () => {
    let requested = '';
    const spy = ((input: RequestInfo | URL) => {
      requested = String(input);
      return Promise.resolve(new Response(JSON.stringify(okBody), { status: 200 }));
    }) as typeof fetch;
    await loadHealth(spy);
    expect(requested).toBe('/api/health');
  });
});
