import { connect } from 'node:net';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createGraphStore, IN_MEMORY, openDatabase, type OrbitDatabase } from '@orbit/database';
import { ORBIT_VERSION, createLogger, type HealthResponse } from '@orbit/shared';
import { buildServer } from './server.js';

const databases: OrbitDatabase[] = [];
const servers: Array<ReturnType<typeof buildServer>> = [];
const API_TOKEN = 'orbit-test-token-'.padEnd(48, 'x');

function setup(env: Record<string, string | undefined> = {}): {
  database: OrbitDatabase;
  server: ReturnType<typeof buildServer>;
  repositoryId: string;
} {
  const database = openDatabase({ path: IN_MEMORY });
  databases.push(database);
  const store = createGraphStore(database);
  const repository = store.repositories.register({ key: 'example', displayName: 'Example' }).record;
  const sink = new Writable({ write: (_chunk, _enc, cb) => cb() });
  const logger = createLogger({ name: 'test', level: 'silent', destination: sink });
  const server = buildServer({ database, logger, apiToken: API_TOKEN, env });
  servers.push(server);
  return { database, server, repositoryId: repository.id };
}

const auth = { authorization: 'Bearer ' + API_TOKEN };

afterEach(async () => {
  for (const server of servers.splice(0)) {
    try {
      await server.close();
    } catch {
      // Some inject-only tests never start a listening socket.
    }
  }
  for (const database of databases.splice(0)) {
    if (database.isHealthy()) database.close();
  }
});

describe('GET /health', () => {
  it('reports ok with the version and a migrated database without requiring a token', async () => {
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

describe('authenticated local API', () => {
  it('rejects missing or incorrect ***', async () => {
    const { server } = setup();
    const missing = await server.inject({
      method: 'GET',
      url: '/api/v1/repositories',
      headers: { host: 'localhost' },
    });
    const incorrect = await server.inject({
      method: 'GET',
      url: '/api/v1/repositories',
      headers: { host: 'localhost', authorization: '***' },
    });
    expect(missing.statusCode).toBe(401);
    expect(incorrect.statusCode).toBe(401);
    expect(missing.json()).toMatchObject({ error: 'UNAUTHENTICATED' });
  });

  it('previews selected evidence for AI without sending a provider request', async () => {
    const { server } = setup({ ORBIT_AI_ENABLED: 'false' });
    const ingested = await server.inject({
      method: 'POST',
      url: '/api/v1/repositories/example/ingest/ci',
      headers: { host: 'localhost', ...auth },
      payload: {
        status: 'failure',
        source: 'github-actions:build',
        commitSha: 'b'.repeat(40),
        runId: 'ai-preview-run',
        workflow: 'CI',
      },
    });
    const evidenceId = ingested.json<{ evidence: { id: string } }>().evidence.id;
    const preview = await server.inject({
      method: 'POST',
      url: '/api/v1/repositories/example/ai/preview',
      headers: { host: 'localhost', ...auth },
      payload: {
        provider: 'ollama',
        model: 'test-model',
        prompt: 'Summarise the selected CI evidence.',
        evidenceIds: [evidenceId],
      },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      preview: {
        provider: 'ollama',
        destination: 'http://127.0.0.1:11434/api/chat',
        evidenceIds: [evidenceId],
      },
    });
    expect(preview.json<{ preview: { text: string } }>().preview.text).toContain(evidenceId);
    expect(preview.json<{ notice: string }>().notice).toContain('No provider request was sent');
  });

  it('requires confirmation and keeps AI disabled unless explicitly enabled by the local operator', async () => {
    const { server } = setup({ ORBIT_AI_ENABLED: 'false' });
    const ingested = await server.inject({
      method: 'POST',
      url: '/api/v1/repositories/example/ingest/ci',
      headers: { host: 'localhost', ...auth },
      payload: {
        status: 'failure',
        source: 'github-actions:build',
        commitSha: 'c'.repeat(40),
        runId: 'ai-disabled-run',
        workflow: 'CI',
      },
    });
    const evidenceId = ingested.json<{ evidence: { id: string } }>().evidence.id;
    const body = {
      provider: 'ollama',
      model: 'test-model',
      prompt: 'Summarise the selected CI evidence.',
      evidenceIds: [evidenceId],
    };
    const preview = await server.inject({
      method: 'POST',
      url: '/api/v1/repositories/example/ai/preview',
      headers: { host: 'localhost', ...auth },
      payload: body,
    });
    const sha = preview.json<{ preview: { sha256: string } }>().preview.sha256;
    const unconfirmed = await server.inject({
      method: 'POST',
      url: '/api/v1/repositories/example/ai/analyse',
      headers: { host: 'localhost', ...auth },
      payload: { ...body, approvedContextSha256: sha, confirmed: false },
    });
    expect(unconfirmed.statusCode).toBe(403);
    expect(unconfirmed.json()).toMatchObject({ error: 'APPROVAL_REQUIRED' });
    const disabled = await server.inject({
      method: 'POST',
      url: '/api/v1/repositories/example/ai/analyse',
      headers: { host: 'localhost', ...auth },
      payload: { ...body, approvedContextSha256: sha, confirmed: true },
    });
    expect(disabled.statusCode).toBe(403);
    expect(disabled.json()).toMatchObject({ error: 'AI_DISABLED' });
  });

  it('returns a read-only hash-chain integrity report for a repository', async () => {
    const { server } = setup();
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/repositories/example/integrity',
      headers: { host: 'localhost', ...auth },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      repository: { key: 'example' },
      integrity: { ok: true, problems: [] },
    });
  });

  it('returns a read-only hash-chain integrity report for a repository', async () => {
    const { server } = setup();
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/repositories/example/integrity',
      headers: { host: 'localhost', ...auth },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      repository: { key: 'example' },
      integrity: { ok: true, problems: [] },
    });
  });

  it('lists registered repositories and never returns the token value', async () => {
    const { server } = setup();
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/repositories',
      headers: { host: 'localhost', ...auth },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      repositories: [{ key: 'example', displayName: 'Example' }],
    });
    const session = await server.inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { host: 'localhost', ...auth },
    });
    expect(session.statusCode).toBe(200);
    expect(session.body).not.toContain(API_TOKEN);
    expect(session.json()).toMatchObject({ authenticated: true, tokenSource: 'environment' });
  });

  it('stores CI evidence and returns the same evidence through the repository endpoint', async () => {
    const { server } = setup();
    const commitSha = 'a'.repeat(40);
    const ingested = await server.inject({
      method: 'POST',
      url: '/api/v1/repositories/example/ingest/ci',
      headers: { host: 'localhost', ...auth },
      payload: {
        status: 'failure',
        source: 'github-actions:build',
        commitSha,
        runId: 'run-123',
        workflow: 'CI',
      },
    });
    expect(ingested.statusCode).toBe(200);
    const payload = ingested.json<{
      evidence: { id: string; status: string };
      node: { type: string };
    }>();
    expect(payload.evidence.status).toBe('FAIL');
    expect(payload.node.type).toBe('CIWorkflow');

    const evidence = await server.inject({
      method: 'GET',
      url: '/api/v1/repositories/example/evidence?commitSha=' + commitSha,
      headers: { host: 'localhost', ...auth },
    });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json<{ evidence: Array<{ id: string }> }>().evidence).toHaveLength(1);
    expect(evidence.json<{ evidence: Array<{ id: string }> }>().evidence[0]?.id).toBe(
      payload.evidence.id,
    );
  });

  it('parses and records JUnit test reports without storing the raw report as graph attributes', async () => {
    const { server } = setup();
    const report =
      '<testsuite name="unit"><testcase classname="api" name="ok"/><testcase classname="api" name="bad"><failure message="boom"/></testcase></testsuite>';
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/repositories/example/ingest/test-report',
      headers: { host: 'localhost', ...auth },
      payload: { format: 'junit', content: report, source: 'ci:junit' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      summary: { total: 2, passed: 1, failed: 1, skipped: 0 },
      evidence: { status: 'FAIL', sourceType: 'test-report' },
      node: { type: 'TestRun' },
    });
    expect(JSON.stringify(response.json())).not.toContain('boom');
  });

  it('records environment declarations as partial evidence, not proof of the runner image', async () => {
    const { server } = setup();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/repositories/example/ingest/environment',
      headers: { host: 'localhost', ...auth },
      payload: { snapshot: { runtimes: { node: '>=22' }, packageManager: 'pnpm' } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      evidence: { status: 'PARTIAL', sourceType: 'environment' },
      node: { type: 'Environment' },
    });
  });

  it('rejects arbitrary environment fields that could carry secrets', async () => {
    const { server } = setup();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/repositories/example/ingest/environment',
      headers: { host: 'localhost', ...auth },
      payload: { snapshot: { runtimes: { node: '>=22' }, apiToken: 'must-not-be-stored' } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('must-not-be-stored');
  });

  it('stores only explicitly allowed CI summary fields', async () => {
    const { server, repositoryId } = setup();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/repositories/example/ingest/ci',
      headers: { host: 'localhost', ...auth },
      payload: {
        status: 'success',
        summary: { passed: 10, failed: 0, apiToken: 'must-not-be-stored' },
      },
    });
    expect(response.statusCode).toBe(400);
    const store = createGraphStore(databases[databases.length - 1]!);
    const ciNodes = store.nodes.find(repositoryId, { type: 'CIWorkflow', limit: 10 });
    expect(ciNodes).toHaveLength(0);
  });

  it('parses recorded telemetry and marks its evidence as observational', async () => {
    const { server } = setup();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/repositories/example/ingest/telemetry',
      headers: { host: 'localhost', ...auth },
      payload: {
        format: 'ndjson',
        content: '{"timestamp":"2026-11-08T10:00:00Z","voltage":3.3,"event":"boot"}',
        demo: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      evidence: { status: 'PARTIAL', sourceType: 'telemetry' },
      node: { type: 'TelemetrySession' },
      summary: { demo: true, metricNames: ['voltage'] },
    });
  });

  it('rejects malformed CI status and invalid pagination rather than accepting arbitrary input', async () => {
    const { server } = setup();
    const badCi = await server.inject({
      method: 'POST',
      url: '/api/v1/repositories/example/ingest/ci',
      headers: { host: 'localhost', ...auth },
      payload: { status: { nested: 'invalid' } },
    });
    const badGraph = await server.inject({
      method: 'GET',
      url: '/api/v1/repositories/example/graph?limit=1000000',
      headers: { host: 'localhost', ...auth },
    });
    expect(badCi.statusCode).toBe(400);
    expect(badGraph.statusCode).toBe(400);
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
    const server = buildServer({
      database,
      logger,
      allowedHosts: ['orbit.internal'],
      apiToken: API_TOKEN,
    });
    servers.push(server);
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
