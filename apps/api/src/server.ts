import { timingSafeEqual } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import Fastify from 'fastify';
import {
  hashArtifact,
  nodeIdFor,
  type EvidenceStatus,
  type NodeType,
  canonicalJson,
} from '@orbit/core';
import {
  analyseTelemetry,
  exportAtlas,
  getPassportHistory,
  impactMap,
  parseGoTestJson,
  parseJestJsonReport,
  parseJunitXml,
  parsePytestJsonReport,
  recordChangePassport,
  scanRepository,
  parseTelemetry,
  type PassportRecordInput,
} from '@orbit/atlas';
import { createGraphStore, openDatabase, type GraphStore, type OrbitDatabase } from '@orbit/database';
import {
  ORBIT_VERSION,
  OrbitError,
  type HealthResponse,
  type Logger,
} from '@orbit/shared';
import { getOrCreateApiToken } from './session-token.js';

export const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '[::1]'];
const MAX_INGEST_BYTES = 2 * 1024 * 1024;
const MAX_GRAPH_LIMIT = 1000;

export interface BuildServerOptions {
  database: OrbitDatabase;
  logger: Logger;
  /** Host names (without port) accepted in the Host header. Defaults to loopback names. */
  allowedHosts?: readonly string[];
  /** API session token. Authenticated routes are disabled when no token is supplied (tests only). */
  apiToken?: string;
  /** Database file used to place the generated token beside the workspace. */
  databasePath?: string;
  /** Optional test override. Production uses the generated or configured local API token. */
  env?: Record<string, string | undefined>;
}

/** Strip the port from a Host header value, keeping IPv6 brackets. */
function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']');
    return end === -1 ? hostHeader : hostHeader.slice(0, end + 1);
  }
  const colon = hostHeader.lastIndexOf(':');
  return colon === -1 ? hostHeader : hostHeader.slice(0, colon);
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown, what: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OrbitError('INVALID_INPUT', `${what} must be a JSON object`);
  }
  return value as JsonRecord;
}

function text(value: unknown, what: string, max = 512): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new OrbitError('INVALID_INPUT', `${what} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function optionalText(value: unknown, what: string, max = 256): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, what, max);
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number, what: string): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new OrbitError('INVALID_INPUT', `${what} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function hashablePayload(value: unknown): string {
  const encoded = canonicalJson(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_INGEST_BYTES) {
    throw new OrbitError('INVALID_INPUT', 'Ingestion payload exceeds the 2 MiB limit');
  }
  return encoded;
}

function httpStatus(error: unknown): number {
  if (error instanceof OrbitError) {
    if (error.code === 'NOT_FOUND') return 404;
    if (error.code === 'INVALID_INPUT' || error.code === 'CONFIG_INVALID') return 400;
    if (error.code === 'DATABASE_ERROR') return 503;
  }
  return 500;
}

function repositoryByKey(store: GraphStore, key: string) {
  const repository = store.repositories.list().find((item) => item.key === key || item.id === key);
  if (!repository) {
    throw new OrbitError('NOT_FOUND', `Repository ${key} was not found`, {
      details: { repositoryKey: key },
    });
  }
  return repository;
}

function authenticate(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function appendEvidence(
  store: GraphStore,
  input: {
    repositoryId: string;
    source: string;
    sourceType: 'ci' | 'test-report' | 'environment' | 'telemetry';
    content: string;
    status: EvidenceStatus;
    commitSha?: string;
    limitation?: string;
    relatedEntityIds?: string[];
  },
) {
  return store.evidence.append({
    repositoryId: input.repositoryId,
    source: input.source,
    sourceType: input.sourceType,
    ...(input.commitSha ? { commitSha: input.commitSha } : {}),
    contentHash: hashArtifact(input.content),
    status: input.status,
    limitations: input.limitation ? [input.limitation] : [],
    relatedEntityIds: input.relatedEntityIds ?? [],
  }).record;
}

export function buildServer(options: BuildServerOptions) {
  const allowed = new Set(
    (options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS).map((h) => h.toLowerCase()),
  );
  const tokenInfo = options.apiToken
    ? { token: options.apiToken, filePath: null, source: 'environment' as const }
    : options.databasePath
      ? getOrCreateApiToken(options.databasePath, options.env)
      : null;
  const apiToken = tokenInfo?.token;
  const server = Fastify({ loggerInstance: options.logger, bodyLimit: MAX_INGEST_BYTES + 64 * 1024 });

  // DNS-rebinding defence: only explicitly allowed loopback Host names are accepted by default.
  server.addHook('onRequest', async (request, reply) => {
    if (!allowed.has(hostnameOf(request.headers.host).toLowerCase())) {
      return reply.code(403).send({ error: 'FORBIDDEN_HOST', message: 'Host header not allowed' });
    }
    if (request.url.startsWith('/api/v1/')) {
      if (!apiToken || !authenticate(request.headers.authorization, apiToken)) {
        return reply.code(401).send({
          error: 'UNAUTHENTICATED',
          message: 'Provide the local ORBIT session token using Authorization: Bearer <token>',
        });
      }
    }
    return undefined;
  });

  server.setErrorHandler((error, _request, reply) => {
    const status = httpStatus(error);
    const code = error instanceof OrbitError ? error.code : 'INTERNAL';
    const message = status >= 500 ? 'The ORBIT API could not complete the request' : error.message;
    if (status >= 500) options.logger.error({ code }, 'API request failed');
    return reply.code(status).send({ error: code, message });
  });

  server.get('/health', async (_request, reply): Promise<HealthResponse> => {
    const healthy = options.database.isHealthy();
    const body: HealthResponse = {
      status: healthy ? 'ok' : 'degraded',
      service: 'orbit-api',
      version: ORBIT_VERSION,
      database: {
        connected: healthy,
        schemaVersion: healthy ? options.database.schemaVersion() : null,
      },
    };
    if (!healthy) reply.code(503);
    return body;
  });

  const store = createGraphStore(options.database);
  const dbPath = options.databasePath ?? options.database.path;

  server.get('/api/v1/session', async () => ({
    authenticated: true,
    tokenSource: tokenInfo?.source ?? 'in-memory-test',
    tokenFile: tokenInfo?.filePath ?? null,
    note: 'The token value is never returned by the API.',
  }));

  server.get('/api/v1/repositories', async () => ({
    repositories: store.repositories.list(),
  }));

  server.post('/api/v1/repositories/scan', async (request, reply) => {
    const body = record(request.body, 'body');
    const requestedRoot = text(body.rootPath, 'rootPath', 4096);
    let rootPath: string;
    try {
      rootPath = await realpath(resolve(requestedRoot));
      const info = await stat(rootPath);
      if (!info.isDirectory()) throw new Error('not a directory');
    } catch {
      throw new OrbitError('INVALID_INPUT', 'rootPath must identify an existing local directory');
    }
    const repositoryKey = optionalText(body.repositoryKey, 'repositoryKey', 1024)
      ?? `local/${basename(rootPath)}`;
    const maxFiles = boundedInteger(body.maxFiles, 20_000, 1, 100_000, 'maxFiles');
    const maxCommits = boundedInteger(body.maxCommits, 500, 1, 10_000, 'maxCommits');
    const result = await scanRepository({
      rootPath,
      store,
      repositoryKey,
      cacheDir: resolve(dirname(dbPath), 'cache'),
      config: { maxFiles, maxCommits, skipGit: body.skipGit === true, skipCalls: body.skipCalls === true },
    });
    reply.code(200);
    return { result };
  });

  server.get<{ Params: { key: string } }>('/api/v1/repositories/:key', async (request) => {
    const repository = repositoryByKey(store, request.params.key);
    return { repository };
  });

  server.get<{ Params: { key: string }; Querystring: { limit?: string; offset?: string; type?: string } }>(
    '/api/v1/repositories/:key/graph',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const limit = boundedInteger(request.query.limit, 100, 1, MAX_GRAPH_LIMIT, 'limit');
      const offset = boundedInteger(request.query.offset, 0, 0, 1_000_000, 'offset');
      const type = optionalText(request.query.type, 'type', 64) as NodeType | undefined;
      const validTypes: readonly string[] = [
        'Repository', 'File', 'Symbol', 'Function', 'Class', 'Module', 'Dependency', 'Commit',
        'PullRequest', 'Issue', 'Decision', 'Documentation', 'Test', 'TestRun', 'CIWorkflow',
        'Environment', 'Build', 'Artifact', 'Firmware', 'HardwareDevice', 'TelemetrySession',
        'Finding', 'ChangePassport',
      ];
      if (type && !validTypes.includes(type)) throw new OrbitError('INVALID_INPUT', 'type is not a supported graph node type');
      const nodes = store.nodes.find(repository.id, { ...(type ? { type } : {}), limit, offset });
      const edges = store.edges.list(repository.id, { limit, offset });
      const ledgerHead = store.ledger.head(repository.id);
      return {
        repository,
        nodes,
        edges,
        page: { limit, offset, hasMoreNodes: nodes.length === limit, hasMoreEdges: edges.length === limit },
        ledger: { entries: ledgerHead?.seq ?? 0, headHash: ledgerHead?.hash ?? null },
      };
    },
  );

  server.get<{ Params: { key: string }; Querystring: { limit?: string; commitSha?: string; sourceType?: string } }>(
    '/api/v1/repositories/:key/evidence',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const limit = boundedInteger(request.query.limit, 100, 1, 1000, 'limit');
      const commitSha = optionalText(request.query.commitSha, 'commitSha', 64);
      if (commitSha && !/^[0-9a-f]{7,64}$/i.test(commitSha)) throw new OrbitError('INVALID_INPUT', 'commitSha is invalid');
      const sourceType = optionalText(request.query.sourceType, 'sourceType', 32);
      const allowedTypes = ['git', 'coverage', 'test-report', 'ci', 'environment', 'build', 'telemetry', 'parser', 'manual', 'ai-note'];
      if (sourceType && !allowedTypes.includes(sourceType)) throw new OrbitError('INVALID_INPUT', 'sourceType is invalid');
      const evidence = store.evidence.list(repository.id, {
        limit,
        ...(commitSha ? { commitSha } : {}),
        ...(sourceType ? { sourceType: sourceType as 'ci' | 'test-report' | 'environment' | 'telemetry' } : {}),
      });
      return { repository, evidence, returned: evidence.length, limit };
    },
  );

  server.get<{ Params: { key: string }; Querystring: { limit?: string; offset?: string } }>(
    '/api/v1/repositories/:key/passports',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const limit = boundedInteger(request.query.limit, 100, 1, MAX_GRAPH_LIMIT, 'limit');
      const offset = boundedInteger(request.query.offset, 0, 0, 1_000_000, 'offset');
      const passports = store.nodes.find(repository.id, { type: 'ChangePassport', limit, offset })
        .filter((item) => item.attrs['producer'] === 'orbit-passport');
      return { repository, passports, page: { limit, offset, hasMore: passports.length === limit } };
    },
  );

  server.get<{ Params: { key: string; id: string } }>(
    '/api/v1/repositories/:key/passports/:id/history',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      return { repository, history: getPassportHistory(store, repository.id, request.params.id) };
    },
  );

  server.get<{ Params: { key: string }; Querystring: { file?: string } }>(
    '/api/v1/repositories/:key/reports/impact',
    async (request) => {
      const repository = repositoryByKey(store, request.params.key);
      const file = text(request.query.file, 'file', 4096);
      return { repository, impact: impactMap(store, repository.id, file) };
    },
  );

  server.get<{ Params: { key: string } }>('/api/v1/repositories/:key/reports/atlas', async (request) => {
    const repository = repositoryByKey(store, request.params.key);
    return { repository, report: exportAtlas(store, repository.id) };
  });

  server.post<{ Params: { key: string } }>('/api/v1/repositories/:key/ingest/ci', async (request) => {
    const repository = repositoryByKey(store, request.params.key);
    const body = record(request.body, 'body');
    const status = text(body.status, 'status', 32).toLowerCase();
    const source = optionalText(body.source, 'source', 512) ?? 'api:ci-ingest';
    const commitSha = optionalText(body.commitSha, 'commitSha', 64);
    if (commitSha && !/^[0-9a-f]{7,64}$/i.test(commitSha)) throw new OrbitError('INVALID_INPUT', 'commitSha is invalid');
    const resultValue = ['success', 'passed', 'pass'].includes(status) ? 'PASS'
      : ['failure', 'failed', 'fail'].includes(status) ? 'FAIL' : 'PARTIAL';
    const payload = {
      status,
      source,
      ...(commitSha ? { commitSha: commitSha.toLowerCase() } : {}),
      ...(body.runId !== undefined ? { runId: text(body.runId, 'runId', 256) } : {}),
      ...(body.workflow !== undefined ? { workflow: text(body.workflow, 'workflow', 256) } : {}),
      ...(body.branch !== undefined ? { branch: text(body.branch, 'branch', 256) } : {}),
      ...(body.summary !== undefined ? { summary: record(body.summary, 'summary') } : {}),
    };
    const encoded = hashablePayload(payload);
    const contentHash = hashArtifact(encoded);
    const key = `ci:${commitSha?.toLowerCase() ?? contentHash}`;
    const nodeId = nodeIdFor(repository.id, 'CIWorkflow', key);
    const evidence = appendEvidence(store, {
      repositoryId: repository.id,
      source,
      sourceType: 'ci',
      content: encoded,
      status: resultValue,
      ...(commitSha ? { commitSha } : {}),
      ...(resultValue === 'PARTIAL' ? { limitation: 'The supplied CI status is not a recognised pass or failure state.' } : {}),
      relatedEntityIds: [nodeId],
    });
    const node = store.nodes.upsert({
      repositoryId: repository.id,
      type: 'CIWorkflow',
      key,
      attrs: { producer: 'orbit-api', schemaVersion: 1, ...payload, status: resultValue },
      sourceEvidenceId: evidence.id,
      ...(commitSha ? { validFromCommit: commitSha } : {}),
    });
    return { evidence, node: node.record };
  });

  server.post<{ Params: { key: string } }>('/api/v1/repositories/:key/ingest/test-report', async (request) => {
    const repository = repositoryByKey(store, request.params.key);
    const body = record(request.body, 'body');
    const format = text(body.format, 'format', 32);
    const content = text(body.content, 'content', MAX_INGEST_BYTES);
    const commitSha = optionalText(body.commitSha, 'commitSha', 64);
    if (commitSha && !/^[0-9a-f]{7,64}$/i.test(commitSha)) throw new OrbitError('INVALID_INPUT', 'commitSha is invalid');
    let cases;
    if (format === 'junit') cases = parseJunitXml(content);
    else if (format === 'pytest-json') cases = parsePytestJsonReport(content);
    else if (format === 'jest-json') cases = parseJestJsonReport(content);
    else if (format === 'go-json') cases = parseGoTestJson(content);
    else throw new OrbitError('INVALID_INPUT', 'format must be junit, pytest-json, jest-json or go-json');
    const summary = {
      format,
      total: cases.length,
      passed: cases.filter((item) => item.outcome === 'passed').length,
      failed: cases.filter((item) => item.outcome === 'failed').length,
      skipped: cases.filter((item) => item.outcome === 'skipped').length,
    };
    const status: EvidenceStatus = summary.failed > 0 ? 'FAIL' : 'PASS';
    const contentHash = hashArtifact(content);
    const key = `test-report:${contentHash}`;
    const nodeId = nodeIdFor(repository.id, 'TestRun', key);
    const evidence = appendEvidence(store, {
      repositoryId: repository.id,
      source: optionalText(body.source, 'source', 512) ?? `api:test-report:${format}`,
      sourceType: 'test-report',
      content,
      status,
      ...(commitSha ? { commitSha } : {}),
      relatedEntityIds: [nodeId],
    });
    const node = store.nodes.upsert({
      repositoryId: repository.id,
      type: 'TestRun',
      key,
      attrs: { producer: 'orbit-api', schemaVersion: 1, ...summary, ...(commitSha ? { commitSha } : {}) },
      sourceEvidenceId: evidence.id,
      ...(commitSha ? { validFromCommit: commitSha } : {}),
    });
    return { evidence, node: node.record, summary };
  });

  server.post<{ Params: { key: string } }>('/api/v1/repositories/:key/ingest/environment', async (request) => {
    const repository = repositoryByKey(store, request.params.key);
    const body = record(request.body, 'body');
    const snapshot = record(body.snapshot, 'snapshot');
    const encoded = hashablePayload(snapshot);
    const contentHash = hashArtifact(encoded);
    const key = `environment:${contentHash}`;
    const nodeId = nodeIdFor(repository.id, 'Environment', key);
    const evidence = appendEvidence(store, {
      repositoryId: repository.id,
      source: optionalText(body.source, 'source', 512) ?? 'api:environment-ingest',
      sourceType: 'environment',
      content: encoded,
      status: 'PARTIAL',
      limitation: 'This is a supplied environment description, not a measurement of the actual runner or installed filesystem.',
      relatedEntityIds: [nodeId],
    });
    const node = store.nodes.upsert({
      repositoryId: repository.id,
      type: 'Environment',
      key,
      attrs: { producer: 'orbit-api', schemaVersion: 1, snapshotHash: contentHash, snapshot },
      sourceEvidenceId: evidence.id,
    });
    return { evidence, node: node.record };
  });

  server.post<{ Params: { key: string } }>('/api/v1/repositories/:key/ingest/telemetry', async (request) => {
    const repository = repositoryByKey(store, request.params.key);
    const body = record(request.body, 'body');
    const content = text(body.content, 'content', MAX_INGEST_BYTES);
    const format = body.format as 'json' | 'ndjson' | 'csv' | 'key-value' | undefined;
    if (format !== undefined && !['json', 'ndjson', 'csv', 'key-value'].includes(format)) {
      throw new OrbitError('INVALID_INPUT', 'format must be json, ndjson, csv or key-value');
    }
    const session = parseTelemetry(content, format);
    const analysis = analyseTelemetry(session, { units: (body.units ?? {}) as Record<string, string> });
    const contentHash = hashArtifact(content);
    const key = `telemetry:${contentHash}`;
    const nodeId = nodeIdFor(repository.id, 'TelemetrySession', key);
    const commitSha = optionalText(body.commitSha, 'commitSha', 64);
    if (commitSha && !/^[0-9a-f]{7,64}$/i.test(commitSha)) throw new OrbitError('INVALID_INPUT', 'commitSha is invalid');
    const summary = {
      format: session.format,
      rawSha256: session.rawSha256,
      records: session.points.length,
      metricNames: session.metricNames,
      watchdogEvents: session.watchdogEvents,
      resetEvents: session.resetEvents,
      analysis: { metricNames: Object.keys(analysis.metricStats), anomalies: analysis.anomalies.length, eventCounts: analysis.eventCounts },
      ...(body.demo === true ? { demo: true } : {}),
    };
    const evidence = appendEvidence(store, {
      repositoryId: repository.id,
      source: optionalText(body.source, 'source', 512) ?? 'api:telemetry-ingest',
      sourceType: 'telemetry',
      content,
      status: 'PARTIAL',
      ...(commitSha ? { commitSha } : {}),
      limitation: 'Recorded telemetry is observational evidence and does not prove correctness or imply a physical serial connection.',
      relatedEntityIds: [nodeId],
    });
    const node = store.nodes.upsert({
      repositoryId: repository.id,
      type: 'TelemetrySession',
      key,
      attrs: {
        producer: 'orbit-api',
        schemaVersion: 1,
        ...summary,
        deviceLabel: optionalText(body.deviceLabel, 'deviceLabel', 128) ?? null,
        firmwareBuildId: optionalText(body.firmwareBuildId, 'firmwareBuildId', 128) ?? null,
      },
      sourceEvidenceId: evidence.id,
      ...(commitSha ? { validFromCommit: commitSha } : {}),
    });
    return { evidence, node: node.record, summary };
  });

  server.post<{ Params: { key: string } }>('/api/v1/repositories/:key/passports', async (request) => {
    const repository = repositoryByKey(store, request.params.key);
    const body = record(request.body, 'body');
    const input = {
      ...body,
      repositoryId: repository.id,
      repository: repository.key,
    } as unknown as PassportRecordInput;
    const result = recordChangePassport(store, input);
    return { result };
  });

  server.get<{ Params: { key: string; id: string } }>('/api/v1/repositories/:key/evidence/:id', async (request) => {
    const repository = repositoryByKey(store, request.params.key);
    const evidence = store.evidence.get(repository.id, request.params.id);
    if (!evidence) throw new OrbitError('NOT_FOUND', 'Evidence was not found in this repository');
    return { evidence };
  });

  server.get<{ Params: { key: string; id: string } }>('/api/v1/repositories/:key/nodes/:id', async (request) => {
    const repository = repositoryByKey(store, request.params.key);
    const node = store.nodes.get(repository.id, request.params.id);
    if (!node) throw new OrbitError('NOT_FOUND', 'Graph node was not found in this repository');
    return { node, evidence: store.evidence.forEntity(repository.id, node.id) };
  });

  server.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: 'NOT_FOUND', message: 'Route not found' });
  });

  return server;
}
