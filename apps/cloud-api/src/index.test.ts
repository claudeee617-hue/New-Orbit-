import { describe, expect, it } from 'vitest';
import worker from './index.js';

const env = {
  ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com',
  ACCESS_AUD: 'test-audience',
  DB: {
    prepare() {
      throw new Error('Database should not be reached by these tests');
    },
  },
} as never;

describe('ORBIT cloud API boundary', () => {
  it('exposes only a minimal liveness response without authentication', async () => {
    const response = await worker.fetch(new Request('https://orbit.test/health'), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: 'orbit-cloud-api',
      status: 'ok',
      version: '0.1.0',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects protected workspace access without a Cloudflare Access assertion', async () => {
    const response = await worker.fetch(new Request('https://orbit.test/v1/workspaces'), env);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'UNAUTHENTICATED' });
  });

  it('does not enable browser preflight or wildcard CORS', async () => {
    const response = await worker.fetch(
      new Request('https://orbit.test/v1/workspaces', { method: 'OPTIONS' }),
      env,
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
