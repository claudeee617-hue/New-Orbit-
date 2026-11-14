import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';

const issuer = 'https://orbit-test.cloudflareaccess.com';
const audience = 'orbit-test-audience';
const encoder = new TextEncoder();
let privateKey: CryptoKey;
let publicJwk: JsonWebKey & { kid: string; alg: string; use: string };

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  let encoded = btoa(binary).replaceAll('+', '-').replaceAll('/', '_');
  while (encoded.endsWith('=')) encoded = encoded.slice(0, -1);
  return encoded;
}

async function createToken(
  options: { aud?: string; exp?: number; nbf?: number; kid?: string; signingKey?: CryptoKey } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: options.kid ?? 'orbit-test-key', typ: 'JWT' };
  const claims = {
    sub: 'orbit-test-user',
    iss: issuer,
    aud: options.aud ?? audience,
    exp: options.exp ?? now + 300,
    nbf: options.nbf ?? now - 1,
    email: 'test@example.invalid',
    email_verified: true,
  };
  const signingInput = base64Url(JSON.stringify(header)) + '.' + base64Url(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    options.signingKey ?? privateKey,
    encoder.encode(signingInput),
  );
  return signingInput + '.' + base64Url(new Uint8Array(signature));
}

function authenticatedEnv(database: unknown) {
  return {
    ACCESS_TEAM_DOMAIN: issuer,
    ACCESS_AUD: audience,
    DB: database,
  } as never;
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicJwk = {
    ...(await crypto.subtle.exportKey('jwk', pair.publicKey)),
    kid: 'orbit-test-key',
    alg: 'RS256',
    use: 'sig',
  };
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const unauthenticatedEnv = authenticatedEnv({
  prepare() {
    throw new Error('Database should not be reached by these tests');
  },
});

describe('ORBIT cloud API boundary', () => {
  it('exposes only a minimal liveness response without authentication', async () => {
    const response = await worker.fetch(
      new Request('https://orbit.test/health'),
      unauthenticatedEnv,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: 'orbit-cloud-api',
      status: 'ok',
      version: '0.1.0',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects protected workspace access without a Cloudflare Access assertion', async () => {
    const response = await worker.fetch(
      new Request('https://orbit.test/v1/workspaces'),
      unauthenticatedEnv,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'UNAUTHENTICATED' });
  });

  it('verifies the Access signature and scopes workspace reads to the signed subject', async () => {
    const rows = [
      {
        id: 'workspace-1',
        name: 'Engineering',
        workspaceKey: 'engineering',
        role: 'owner',
        createdAt: '2026-11-14T00:00:00.000Z',
      },
    ];
    const all = vi.fn().mockResolvedValue({ results: rows, success: true });
    const statement = { bind: vi.fn().mockReturnValue({ all }) };
    const prepare = vi.fn().mockReturnValue(statement);
    const env = authenticatedEnv({ prepare, batch: vi.fn() });
    const token = await createToken();

    const response = await worker.fetch(
      new Request('https://orbit.test/v1/workspaces', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaces: rows });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(statement.bind).toHaveBeenCalledWith('orbit-test-user');
  });

  it('rejects a tampered Access signature', async () => {
    const token = await createToken();
    const [header, claims, signature] = token.split('.');
    const replacement = signature![0] === 'A' ? 'B' : 'A';
    const tampered = header + '.' + claims + '.' + replacement + signature!.slice(1);
    const prepare = vi.fn();
    const env = authenticatedEnv({ prepare, batch: vi.fn() });

    const response = await worker.fetch(
      new Request('https://orbit.test/v1/workspaces', {
        headers: { 'Cf-Access-Jwt-Assertion': tampered },
      }),
      env,
    );

    expect(response.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects an audience mismatch and expired Access tokens', async () => {
    const prepare = vi.fn();
    const env = authenticatedEnv({ prepare, batch: vi.fn() });
    const wrongAudience = await createToken({ aud: 'another-application' });
    const expired = await createToken({ exp: Math.floor(Date.now() / 1000) - 1 });

    const audienceResponse = await worker.fetch(
      new Request('https://orbit.test/v1/workspaces', {
        headers: { 'Cf-Access-Jwt-Assertion': wrongAudience },
      }),
      env,
    );
    const expiredResponse = await worker.fetch(
      new Request('https://orbit.test/v1/workspaces', {
        headers: { 'Cf-Access-Jwt-Assertion': expired },
      }),
      env,
    );

    expect(audienceResponse.status).toBe(401);
    expect(expiredResponse.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('creates a workspace and owner membership in one D1 batch', async () => {
    const statement = { bind: vi.fn().mockReturnThis() };
    const prepare = vi.fn().mockReturnValue(statement);
    const batch = vi.fn().mockResolvedValue([]);
    const env = authenticatedEnv({ prepare, batch });
    const token = await createToken();

    const response = await worker.fetch(
      new Request('https://orbit.test/v1/workspaces', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Cf-Access-Jwt-Assertion': token,
        },
        body: JSON.stringify({ name: 'Research Lab' }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      workspace: { name: 'Research Lab', workspaceKey: 'research-lab', role: 'owner' },
    });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('returns a server error when workspace persistence fails unexpectedly', async () => {
    const statement = { bind: vi.fn().mockReturnThis() };
    const prepare = vi.fn().mockReturnValue(statement);
    const batch = vi.fn().mockRejectedValue(new Error('D1 unavailable'));
    const token = await createToken();
    const response = await worker.fetch(
      new Request('https://orbit.test/v1/workspaces', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Cf-Access-Jwt-Assertion': token,
        },
        body: JSON.stringify({ name: 'Research Lab' }),
      }),
      authenticatedEnv({ prepare, batch }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'INTERNAL_ERROR' });
  });

  it('refreshes Access signing keys when a rotated key id is first observed', async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const rotatedJwk = {
      ...(await crypto.subtle.exportKey('jwk', pair.publicKey)),
      kid: 'orbit-rotated-key',
      alg: 'RS256',
      use: 'sig',
    };
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ keys: [rotatedJwk] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const token = await createToken({
      kid: 'orbit-rotated-key',
      signingKey: pair.privateKey,
    });
    const rows = vi.fn().mockResolvedValue({ results: [], success: true });
    const prepare = vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ all: rows }) });
    const env = authenticatedEnv({ prepare, batch: vi.fn() });

    const response = await worker.fetch(
      new Request('https://orbit.test/v1/workspaces', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects future not-before claims', async () => {
    const prepare = vi.fn();
    const token = await createToken({ nbf: Math.floor(Date.now() / 1000) + 60 });
    const response = await worker.fetch(
      new Request('https://orbit.test/v1/workspaces', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      authenticatedEnv({ prepare, batch: vi.fn() }),
    );

    expect(response.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects non-JSON workspace requests and oversized request bodies', async () => {
    const token = await createToken();
    const env = authenticatedEnv({ prepare: vi.fn(), batch: vi.fn() });
    const unsupported = await worker.fetch(
      new Request('https://orbit.test/v1/workspaces', {
        method: 'POST',
        headers: { 'Cf-Access-Jwt-Assertion': token },
        body: 'name=Research',
      }),
      env,
    );
    const oversized = await worker.fetch(
      new Request('https://orbit.test/v1/workspaces', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Cf-Access-Jwt-Assertion': token,
        },
        body: JSON.stringify({ name: 'x'.repeat(5000) }),
      }),
      env,
    );

    expect(unsupported.status).toBe(415);
    expect(oversized.status).toBe(413);
  });

  it('does not enable browser preflight or wildcard CORS', async () => {
    const response = await worker.fetch(
      new Request('https://orbit.test/v1/workspaces', { method: 'OPTIONS' }),
      unauthenticatedEnv,
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
