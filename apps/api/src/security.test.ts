import { connect } from 'node:net';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { IN_MEMORY, openDatabase, type OrbitDatabase } from '@orbit/database';
import { createLogger } from '@orbit/shared';
import { buildServer } from './server.js';

/**
 * SEC-01 abuse-case regressions for the local API: DNS rebinding (Host), cross-site requests
 * (Origin / CORS / CSRF), content-type confusion and secret leakage in logs.
 * Threat model and findings: docs/SECURITY_REVIEW.md.
 */
const TOKEN = 'orbit-sec-token-'.padEnd(48, 'y');
const bearer = { authorization: `Bearer ${TOKEN}` };
const GOOD_HOST = '127.0.0.1:4317';

const databases: OrbitDatabase[] = [];
const servers: Array<ReturnType<typeof buildServer>> = [];
let logged = '';

function setup(allowedHosts?: readonly string[]): ReturnType<typeof buildServer> {
  const database = openDatabase({ path: IN_MEMORY });
  databases.push(database);
  logged = '';
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      logged += chunk.toString('utf8');
      cb();
    },
  });
  const logger = createLogger({ name: 'sec', level: 'debug', destination: sink });
  const server = buildServer({
    database,
    logger,
    apiToken: TOKEN,
    ...(allowedHosts ? { allowedHosts } : {}),
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close().catch(() => undefined);
  for (const d of databases.splice(0)) if (d.isHealthy()) d.close();
});

describe('Host header (DNS rebinding)', () => {
  const accepted = [
    '127.0.0.1',
    '127.0.0.1:4317',
    'localhost:5173',
    'LOCALHOST',
    '[::1]',
    '[::1]:4317',
  ];
  for (const host of accepted) {
    it(`accepts ${host}`, async () => {
      const r = await setup().inject({ method: 'GET', url: '/health', headers: { host } });
      expect(r.statusCode).toBe(200);
    });
  }

  const rejected = [
    'evil.example',
    'localhost.evil.example',
    '127.0.0.1.evil.example',
    'evil.example:4317',
    '127.0.0.1@evil.example',
    '127.0.0.1:4317@evil.example',
    '[::1]evil.example',
    '[::1]:4317/evil',
    '127.0.0.1:99999',
    '127.0.0.1:abc',
    '127.0.0.1:',
    'localhost.',
    '0.0.0.0',
    '127.0.0.2',
    'localhost, evil.example',
    'localhost evil',
  ];
  for (const host of rejected) {
    it(`rejects ${JSON.stringify(host)}`, async () => {
      const r = await setup().inject({ method: 'GET', url: '/health', headers: { host } });
      expect(r.statusCode).toBe(403);
      expect(r.json<{ error: string }>().error).toBe('FORBIDDEN_HOST');
    });
  }

  it('also rejects a bad Host on authenticated routes even with a valid token', async () => {
    const r = await setup().inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { host: 'evil.example', ...bearer },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('missing Host header', () => {
  it('is rejected over a real socket (HTTP/1.0-style request without Host)', async () => {
    const server = setup();
    await server.listen({ host: '127.0.0.1', port: 0 });
    const port = (server.server.address() as { port: number }).port;
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1');
      let data = '';
      socket.on('data', (c) => (data += c.toString('utf8')));
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
      socket.write('GET /health HTTP/1.1\r\nConnection: close\r\n\r\n');
    });
    expect(response).toMatch(/^HTTP\/1\.1 (403|400)/);
    expect(response).not.toContain('"status":"ok"');
  });
});

describe('Origin header (cross-site requests)', () => {
  const allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://[::1]:5173'];
  for (const origin of allowedOrigins) {
    it(`allows local origin ${origin}`, async () => {
      const r = await setup().inject({
        method: 'GET',
        url: '/api/v1/session',
        headers: { host: GOOD_HOST, origin, ...bearer },
      });
      expect(r.statusCode).toBe(200);
    });
  }

  const deniedOrigins = [
    'https://evil.example',
    'http://evil.example:5173',
    'http://localhost.evil.example',
    'http://127.0.0.1.evil.example',
    'null',
    'file://',
    'chrome-extension://abcdef',
    'http://user@localhost:5173',
    'http://localhost:5173/path',
    'http://localhost:5173?x=1',
    'not a url',
    '',
  ];
  for (const origin of deniedOrigins) {
    it(`denies origin ${JSON.stringify(origin)} even with a valid token`, async () => {
      const r = await setup().inject({
        method: 'GET',
        url: '/api/v1/session',
        headers: { host: GOOD_HOST, origin, ...bearer },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json<{ error: string }>().error).toBe('FORBIDDEN_ORIGIN');
    });
  }

  it('applies the Origin rule to public routes too', async () => {
    const r = await setup().inject({
      method: 'GET',
      url: '/health',
      headers: { host: GOOD_HOST, origin: 'https://evil.example' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('does not require an Origin (CLI, curl and the same-origin dev proxy send none)', async () => {
    const r = await setup().inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { host: GOOD_HOST, ...bearer },
    });
    expect(r.statusCode).toBe(200);
  });
});

describe('CORS and CSRF properties', () => {
  it('never emits CORS allow headers, so browsers block cross-origin reads', async () => {
    const server = setup();
    for (const [method, url] of [
      ['GET', '/health'],
      ['GET', '/api/v1/session'],
      ['OPTIONS', '/api/v1/session'],
    ] as const) {
      const r = await server.inject({ method, url, headers: { host: GOOD_HOST, ...bearer } });
      const keys = Object.keys(r.headers).filter((k) => k.startsWith('access-control-'));
      expect(keys, `${method} ${url}`).toEqual([]);
    }
  });

  it('answers a cross-site preflight without allowing it', async () => {
    const r = await setup().inject({
      method: 'OPTIONS',
      url: '/api/v1/repositories',
      headers: {
        host: GOOD_HOST,
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(r.statusCode).toBe(403);
  });

  it('ignores ambient credentials: cookies and Basic auth never authenticate', async () => {
    const server = setup();
    for (const headers of [
      { cookie: `token=${TOKEN}`, host: GOOD_HOST },
      { authorization: `Basic ${Buffer.from(`x:${TOKEN}`).toString('base64')}`, host: GOOD_HOST },
      { authorization: TOKEN, host: GOOD_HOST },
      { authorization: `bearer ${TOKEN}`, host: GOOD_HOST },
      { authorization: `Bearer ${TOKEN} `, host: GOOD_HOST },
      { authorization: `Bearer ${TOKEN.slice(0, -1)}`, host: GOOD_HOST },
      { authorization: `Bearer ${TOKEN}x`, host: GOOD_HOST },
    ]) {
      const r = await server.inject({ method: 'GET', url: '/api/v1/session', headers });
      expect(r.statusCode, JSON.stringify(headers)).toBe(401);
    }
  });

  it('refuses form, multipart and text/plain bodies (the only types a cross-site form can send)', async () => {
    const server = setup();
    for (const contentType of [
      'application/x-www-form-urlencoded',
      'text/plain',
      'multipart/form-data; boundary=x',
    ]) {
      const r = await server.inject({
        method: 'POST',
        url: '/api/v1/repositories/scan',
        headers: { host: GOOD_HOST, 'content-type': contentType, ...bearer },
        payload: 'key=example',
      });
      expect([400, 415], `${contentType} -> ${String(r.statusCode)}`).toContain(r.statusCode);
    }
  });

  it('does not accept the token in the query string', async () => {
    const r = await setup().inject({
      method: 'GET',
      url: `/api/v1/session?token=${TOKEN}`,
      headers: { host: GOOD_HOST },
    });
    expect(r.statusCode).toBe(401);
  });
});

describe('secret handling', () => {
  it('never writes the token or Authorization header to logs, including on failures', async () => {
    const server = setup();
    await server.inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { host: GOOD_HOST, ...bearer },
    });
    await server.inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { host: GOOD_HOST, authorization: 'Bearer wrong-token-value' },
    });
    await server.inject({
      method: 'POST',
      url: '/api/v1/repositories',
      headers: { host: GOOD_HOST, 'content-type': 'application/json', ...bearer },
      payload: '{bad',
    });
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain('wrong-token-value');
  });

  it('error bodies for auth failures do not echo the supplied credential', async () => {
    const r = await setup().inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { host: GOOD_HOST, authorization: 'Bearer secret-attempt-123' },
    });
    expect(r.body).not.toContain('secret-attempt-123');
  });
});

describe('configured non-loopback hosts', () => {
  it('accepts only the explicitly allowed extra host and still rejects others', async () => {
    const server = setup(['127.0.0.1', 'localhost', '[::1]', 'orbit.lan']);
    const ok = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { host: 'orbit.lan:4317' },
    });
    const bad = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { host: 'other.lan:4317' },
    });
    expect(ok.statusCode).toBe(200);
    expect(bad.statusCode).toBe(403);
    const origin = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { host: 'orbit.lan', origin: 'http://orbit.lan:5173' },
    });
    expect(origin.statusCode).toBe(200);
  });
});
