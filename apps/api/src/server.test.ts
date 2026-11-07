import { connect } from 'node:net';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { IN_MEMORY, openDatabase, type OrbitDatabase } from '@orbit/database';
import { ORBIT_VERSION, createLogger, type HealthResponse } from '@orbit/shared';
import { buildServer } from './server.js';

const databases: OrbitDatabase[] = [];

function setup(): { database: OrbitDatabase; server: ReturnType<typeof buildServer> } {
  const database = openDatabase({ path: IN_MEMORY });
  databases.push(database);
  const sink = new Writable({ write: (_chunk, _enc, cb) => cb() });
  const logger = createLogger({ name: 'test', level: 'silent', destination: sink });
  return { database, server: buildServer({ database, logger }) };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('GET /health', () => {
  it('reports ok with the version and a migrated database', async () => {
    const { server } = setup();
    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { host: '127.0.0.1:4317' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<HealthResponse>();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('orbit-api');
    expect(body.version).toBe(ORBIT_VERSION);
    expect(body.database.connected).toBe(true);
    expect(body.database.schemaVersion).toBeGreaterThanOrEqual(1);
  });

  it('reports degraded with 503 when the database is closed', async () => {
    const { server, database } = setup();
    database.close();
    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { host: 'localhost:4317' },
    });
    expect(response.statusCode).toBe(503);
    const body = response.json<HealthResponse>();
    expect(body.status).toBe('degraded');
    expect(body.database).toEqual({ connected: false, schemaVersion: null });
  });
});

describe('host protection', () => {
  it.each(['127.0.0.1:4317', 'localhost', '[::1]:4317', 'LOCALHOST:80'])(
    'accepts Host %s',
    async (host) => {
      const { server } = setup();
      const response = await server.inject({ method: 'GET', url: '/health', headers: { host } });
      expect(response.statusCode).toBe(200);
    },
  );

  it.each(['evil.example.com', 'evil.example.com:4317', '127.0.0.1.evil.com'])(
    'rejects Host "%s" (DNS rebinding defence)',
    async (host) => {
      const { server } = setup();
      const response = await server.inject({ method: 'GET', url: '/health', headers: { host } });
      expect(response.statusCode).toBe(403);
    },
  );

  // server.inject() substitutes a default Host when given an empty one, so a missing Host header
  // is tested over a real socket with an HTTP/1.0 request that carries no Host at all.
  it('rejects a request with no Host header over a real socket', async () => {
    const { server } = setup();
    await server.listen({ host: '127.0.0.1', port: 0 });
    try {
      const address = server.server.address();
      if (address === null || typeof address === 'string')
        throw new Error('expected a TCP address');
      const raw = await new Promise<string>((resolve, reject) => {
        const socket = connect({ host: '127.0.0.1', port: address.port }, () => {
          socket.write('GET /health HTTP/1.0\r\n\r\n');
        });
        let received = '';
        socket.on('data', (chunk: Buffer) => (received += chunk.toString()));
        socket.on('end', () => resolve(received));
        socket.on('error', reject);
      });
      expect(raw.split('\r\n')[0]).toContain('403');
    } finally {
      await server.close();
    }
  });

  it('accepts an extra host only when explicitly configured', async () => {
    const database = openDatabase({ path: IN_MEMORY });
    databases.push(database);
    const sink = new Writable({ write: (_chunk, _enc, cb) => cb() });
    const logger = createLogger({ name: 'test', level: 'silent', destination: sink });
    const server = buildServer({ database, logger, allowedHosts: ['orbit.internal'] });
    const ok = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { host: 'orbit.internal:4317' },
    });
    const denied = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { host: 'localhost' },
    });
    expect(ok.statusCode).toBe(200);
    expect(denied.statusCode).toBe(403);
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404', async () => {
    const { server } = setup();
    const response = await server.inject({
      method: 'GET',
      url: '/nope',
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'NOT_FOUND', message: 'Route not found' });
  });
});
