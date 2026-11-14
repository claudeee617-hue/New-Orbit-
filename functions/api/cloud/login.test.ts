import { describe, expect, it } from 'vitest';
import { onRequest } from './login.js';

describe('Cloudflare Access login return route', () => {
  it('returns the authenticated user to the public dashboard', async () => {
    const response = onRequest({
      request: new Request('https://orbit-command-center-bh5.pages.dev/api/cloud/login'),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://orbit-command-center-bh5.pages.dev/');
  });

  it('rejects non-GET methods', async () => {
    const response = onRequest({
      request: new Request('https://orbit-command-center-bh5.pages.dev/api/cloud/login', {
        method: 'POST',
      }),
    });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });
});
