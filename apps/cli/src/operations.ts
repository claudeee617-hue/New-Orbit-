import { existsSync, lstatSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  EDGE_TYPES,
  NODE_TYPES,
  canonicalJson,
  hashArtifact,
  nodeIdFor,
  type EvidenceStatus,
  type NodeType,
} from '@orbit/core';
import {
  parseGoTestJson,
  parseJestJsonReport,
  parseJunitXml,
  parsePytestJsonReport,
} from '@orbit/atlas';
import { createGraphStore, openDatabase, type GraphStore } from '@orbit/database';
import { loadConfig, OrbitError } from '@orbit/shared';
import type { Command } from 'commander';
import type { CliIo } from './program.js';

const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_PAGE = 1000;

function parsePositive(value: string, label: string, max = 100_000): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw new Error(`${label} must be an integer from 1 to ${max}`);
  }
  return number;
}

async function readBounded(path: string): Promise<string> {
  const content = await readFile(path, 'utf8');
  if (Buffer.byteLength(content, 'utf8') > MAX_REPORT_BYTES) {
    throw new OrbitError('INVALID_INPUT', `${path} exceeds the 2 MiB input limit`);
  }
  return content;
}

function openExisting(dbPath: string, readonly = true) {
  const path = resolve(dbPath);
  if (!existsSync(path)) {
    throw new OrbitError('NOT_FOUND', `No ORBIT database at ${path}. Run ` + '`orbit init`' + ` first`, {
      details: { path },
    });
  }
  try {
    const database = openDatabase({ path, migrate: false, readonly });
    return { database, store: createGraphStore(database) };
  } catch (error) {
    throw new OrbitError('DATABASE_ERROR', `Could not open the ORBIT database at ${path}`, {
      cause: error,
      details: { path },
    });
  }
}

function pickRepository(store: GraphStore, key: string | undefined) {
  const repositories = store.repositories.list();
  if (key) {
    const found = repositories.find((item) => item.key === key || item.id === key);
    if (!found) throw new OrbitError('NOT_FOUND', `Repository ${key} was not found`);
    return found;
  }
  if (repositories.length === 1 && repositories[0]) return repositories[0];
  if (repositories.length === 0) throw new OrbitError('NOT_FOUND', 'No repository is registered. Run orbit scan or orbit init --repo first.');
  throw new OrbitError('INVALID_INPUT', 'Several repositories exist. Supply --repo <key>.');
}

export function runInit(
  dbPath: string,
  repositoryKey?: string,
  displayName?: string,
): { databasePath: string; schemaVersion: number; repository?: { id: string; key: string; displayName: string } } {
  const database = openDatabase({ path: resolve(dbPath) });
  try {
    const store = createGraphStore(database);
    const repository = repositoryKey
      ? store.repositories.register({ key: repositoryKey, ...(displayName ? { displayName } : {}) }).record
      : undefined;
    return {
      databasePath: database.path,
      schemaVersion: database.schemaVersion(),
      ...(repository ? { repository } : {}),
    };
  } finally {
    database.close();
  }
}

export interface DoctorReport {
  ok: boolean;
  database: { path: string; exists: boolean; schemaVersion: number | null };
  repositories: { count: number; keys: string[] };
  integrity: Array<{ repositoryKey: string; ok: boolean; problems: number }>;
  apiAuthentication: {
    configured: boolean;
    source: 'environment' | 'file' | 'missing';
    tokenFile: string;
    privatePermissions: boolean | null;
  };
  warnings: string[];
}

export function runDoctor(
  dbPath: string,
  env: Record<string, string | undefined> = process.env,
): DoctorReport {
  const path = resolve(dbPath);
  const tokenFile = join(dirname(path), 'api.token');
  const tokenFromEnvironment = env['ORBIT_API_TOKEN'];
  const tokenFileExists = existsSync(tokenFile);
  let privatePermissions: boolean | null = null;
  if (tokenFileExists) {
    try {
      const stat = lstatSync(tokenFile);
      privatePermissions = process.platform === 'win32'
        ? stat.isFile() && !stat.isSymbolicLink()
        : stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o600;
    } catch {
      privatePermissions = false;
    }
  }
  const tokenSource = tokenFromEnvironment
    ? 'environment'
    : tokenFileExists
      ? 'file'
      : 'missing';
  const warnings: string[] = [];
  if (tokenSource === 'missing') warnings.push('Start the local API once to create its private session token, or set ORBIT_API_TOKEN.');
  if (tokenFromEnvironment && !/^[A-Za-z0-9_-]{40,128}$/.test(tokenFromEnvironment)) {
    warnings.push('ORBIT_API_TOKEN is not in the required 40–128 character URL-safe format.');
  }
  if (tokenFileExists && privatePermissions === false) {
    warnings.push('The API token file must be a regular file with private 0600 permissions (on Unix).');
  }
  if (!existsSync(path)) {
    warnings.push('Workspace database has not been initialised yet. Run orbit init.');
    return {
      ok: false,
      database: { path, exists: false, schemaVersion: null },
      repositories: { count: 0, keys: [] },
      integrity: [],
      apiAuthentication: {
        configured: tokenSource !== 'missing',
        source: tokenSource,
        tokenFile,
        privatePermissions,
      },
      warnings,
    };
  }

  const { database, store } = openExisting(path, true);
  try {
    const repositories = store.repositories.list();
    const integrity = repositories.map((repository) => {
      const result = store.verifyIntegrity(repository.id);
      return { repositoryKey: repository.key, ok: result.ok, problems: result.problems.length };
    });
    if (integrity.some((item) => !item.ok)) warnings.push('One or more repository evidence ledgers failed integrity verification.');
    const ok = warnings.length === 0 && integrity.every((item) => item.ok);
    return {
      ok,
      database: { path, exists: true, schemaVersion: database.schemaVersion() },
      repositories: { count: repositories.length, keys: repositories.map((item) => item.key).sort() },
      integrity,
      apiAuthentication: {
        configured: tokenSource !== 'missing',
        source: tokenSource,
        tokenFile,
        privatePermissions,
      },
      warnings,
    };
  } finally {
    database.close();
  }
}

export function runGraphSummary(dbPath: string, repositoryKey?: string) {
  const { database, store } = openExisting(dbPath);
  try {
    const repository = pickRepository(store, repositoryKey);
    const nodes: Record<string, number> = {};
    for (const type of NODE_TYPES) {
      const items = store.nodes.find(repository.id, { type, limit: 10_000 });
      if (items.length) nodes[type] = items.length;
    }
    const edges: Record<string, number> = {};
    for (const type of EDGE_TYPES) {
      const items = store.edges.list(repository.id, { types: [type], limit: 10_000 });
      if (items.length) edges[type] = items.length;
    }
    const head = store.ledger.head(repository.id);
    const integrity = store.verifyIntegrity(repository.id);
    return {
      repository: { id: repository.id, key: repository.key, displayName: repository.displayName },
      nodes,
      edges,
      ledger: { entries: head?.seq ?? 0, headHash: head?.hash ?? null },
      integrity: { ok: integrity.ok, checked: integrity.ledgerEntriesChecked, problems: integrity.problems.length },
    };
  } finally {
    database.close();
  }
}

export function runGraphNodes(
  dbPath: string,
  repositoryKey: string | undefined,
  type: NodeType | undefined,
  limit: number,
  offset: number,
) {
  const { database, store } = openExisting(dbPath);
  try {
    const repository = pickRepository(store, repositoryKey);
    const nodes = store.nodes.find(repository.id, {
      ...(type ? { type } : {}),
      limit: Math.min(limit, MAX_PAGE),
      offset,
    });
    return { repository: repository.key, nodes, page: { limit: Math.min(limit, MAX_PAGE), offset, hasMore: nodes.length === Math.min(limit, MAX_PAGE) } };
  } finally {
    database.close();
  }
}

function ingestionRepository(store: GraphStore, key: string | undefined) {
  return pickRepository(store, key);
}

export async function ingestCiReport(
  dbPath: string,
  repositoryKey: string | undefined,
  input: unknown,
) {
  const body = input as Record<string, unknown>;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OrbitError('INVALID_INPUT', 'CI report must be a JSON object');
  if (typeof body.status !== 'string' || body.status.length > 32) throw new OrbitError('INVALID_INPUT', 'CI report status is required');
  const statusText = body.status.toLowerCase();
  const status: EvidenceStatus = ['success', 'pass', 'passed'].includes(statusText)
    ? 'PASS'
    : ['failure', 'fail', 'failed'].includes(statusText)
      ? 'FAIL'
      : 'PARTIAL';
  const commitSha = typeof body.commitSha === 'string' ? body.commitSha : undefined;
  if (commitSha && !/^[0-9a-f]{7,64}$/i.test(commitSha)) throw new OrbitError('INVALID_INPUT', 'commitSha is invalid');
  const payload = {
    status: statusText,
    source: typeof body.source === 'string' ? body.source.slice(0, 512) : 'cli:ci-ingest',
    ...(commitSha ? { commitSha: commitSha.toLowerCase() } : {}),
    ...(typeof body.runId === 'string' ? { runId: body.runId.slice(0, 256) } : {}),
    ...(typeof body.workflow === 'string' ? { workflow: body.workflow.slice(0, 256) } : {}),
    ...(typeof body.branch === 'string' ? { branch: body.branch.slice(0, 256) } : {}),
    ...(body.summary !== undefined ? { summary: body.summary } : {}),
  };
  const encoded = canonicalJson(payload);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_REPORT_BYTES) throw new OrbitError('INVALID_INPUT', 'CI report exceeds the 2 MiB limit');
  const hash = hashArtifact(encoded);
  const key = `ci:${commitSha?.toLowerCase() ?? hash}`;
  const database = openDatabase({ path: resolve(dbPath), migrate: false });
  try {
    const store = createGraphStore(database);
    const repository = ingestionRepository(store, repositoryKey);
    const nodeId = nodeIdFor(repository.id, 'CIWorkflow', key);
    const evidence = store.evidence.append({
      repositoryId: repository.id,
      source: payload.source,
      sourceType: 'ci',
      ...(commitSha ? { commitSha } : {}),
      contentHash: hash,
      status,
      limitations: status === 'PARTIAL' ? ['The supplied CI state is not a recognised pass/fail value.'] : [],
      relatedEntityIds: [nodeId],
    }).record;
    const node = store.nodes.upsert({
      repositoryId: repository.id,
      type: 'CIWorkflow',
      key,
      attrs: { producer: 'orbit-cli', schemaVersion: 1, ...payload, status },
      sourceEvidenceId: evidence.id,
      ...(commitSha ? { validFromCommit: commitSha } : {}),
    });
    return { evidence, node: node.record };
  } finally {
    database.close();
  }
}

export async function ingestTestReport(
  dbPath: string,
  repositoryKey: string | undefined,
  path: string,
  format: string,
) {
  if (!['junit', 'pytest-json', 'jest-json', 'go-json'].includes(format)) {
    throw new OrbitError('INVALID_INPUT', 'format must be junit, pytest-json, jest-json or go-json');
  }
  const content = await readBounded(path);
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
  const hash = hashArtifact(content);
  const key = `test-report:${hash}`;
  const database = openDatabase({ path: resolve(dbPath), migrate: false });
  try {
    const store = createGraphStore(database);
    const repository = ingestionRepository(store, repositoryKey);
    const nodeId = nodeIdFor(repository.id, 'TestRun', key);
    const evidence = store.evidence.append({
      repositoryId: repository.id,
      source: `cli:test-report:${format}`,
      sourceType: 'test-report',
      contentHash: hash,
      status,
      limitations: [],
      relatedEntityIds: [nodeId],
    }).record;
    const node = store.nodes.upsert({
      repositoryId: repository.id,
      type: 'TestRun',
      key,
      attrs: { producer: 'orbit-cli', schemaVersion: 1, ...summary },
      sourceEvidenceId: evidence.id,
    });
    return { evidence, node: node.record, summary };
  } finally {
    database.close();
  }
}

export function runTestHistory(dbPath: string, repositoryKey: string | undefined, limit: number, offset: number) {
  const { database, store } = openExisting(dbPath);
  try {
    const repository = pickRepository(store, repositoryKey);
    const rows = store.nodes.find(repository.id, { type: 'TestRun', limit: Math.min(limit, MAX_PAGE), offset });
    const runs = rows.filter((item) => item.attrs['producer'] === 'orbit-cli' || item.attrs['producer'] === 'orbit-api');
    return { repository: repository.key, runs, page: { limit: Math.min(limit, MAX_PAGE), offset, hasMore: rows.length === Math.min(limit, MAX_PAGE) } };
  } finally {
    database.close();
  }
}

export function attachOperationsCommands(program: Command, io: CliIo): void {
  program
    .command('init')
    .description('create the local workspace database and optionally register a repository key')
    .option('--db <path>', 'database path (default: ORBIT_DB_PATH or .orbit/orbit.db)')
    .option('--repo <key>', 'optional repository key to register')
    .option('--name <display-name>', 'optional repository display name')
    .action((options: { db?: string; repo?: string; name?: string }) => {
      const config = loadConfig(io.env);
      const result = runInit(options.db ?? config.dbPath, options.repo, options.name);
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    });

  program
    .command('doctor')
    .description('check workspace database, repository ledgers and local API session-token setup')
    .option('--db <path>', 'database path')
    .option('--json', 'print machine-readable JSON')
    .action((options: { db?: string; json?: boolean }) => {
      const config = loadConfig(io.env);
      const report = runDoctor(options.db ?? config.dbPath, io.env);
      if (options.json) io.stdout(`${JSON.stringify(report, null, 2)}\n`);
      else {
        const lines = [
          `ORBIT doctor: ${report.ok ? 'OK' : 'ATTENTION REQUIRED'}`,
          `Database: ${report.database.exists ? `ready (schema ${report.database.schemaVersion})` : 'not initialised'} — ${report.database.path}`,
          `Repositories: ${report.repositories.count}${report.repositories.keys.length ? ` (${report.repositories.keys.join(', ')})` : ''}`,
          `API authentication: ${report.apiAuthentication.configured ? report.apiAuthentication.source : 'not configured'}`,
          ...report.integrity.map((item) => `Ledger ${item.repositoryKey}: ${item.ok ? 'OK' : `FAILED (${item.problems} problems)`}`),
          ...report.warnings.map((warning) => `Warning: ${warning}`),
        ];
        io.stdout(`${lines.join('\n')}\n`);
      }
    });

  const graph = program.command('graph').description('inspect the stored engineering graph');
  graph
    .command('summary')
    .description('show repository graph counts and evidence-ledger integrity')
    .option('--db <path>')
    .option('--repo <key>')
    .option('--json', 'print JSON')
    .action((options: { db?: string; repo?: string; json?: boolean }) => {
      const config = loadConfig(io.env);
      const result = runGraphSummary(options.db ?? config.dbPath, options.repo);
      if (options.json) io.stdout(`${JSON.stringify(result, null, 2)}\n`);
      else {
        const lines = [
          `Repository: ${result.repository.key}`,
          'Nodes:',
          ...Object.entries(result.nodes).map(([type, count]) => `  ${type}: ${count}`),
          'Edges:',
          ...Object.entries(result.edges).map(([type, count]) => `  ${type}: ${count}`),
          `Ledger: ${result.ledger.entries} entries — ${result.integrity.ok ? 'integrity OK' : `integrity failed (${result.integrity.problems} problems)`}`,
        ];
        io.stdout(`${lines.join('\n')}\n`);
      }
    });
  graph
    .command('nodes')
    .description('list current graph nodes')
    .option('--db <path>')
    .option('--repo <key>')
    .option('--type <type>')
    .option('--limit <n>', 'maximum nodes', '100')
    .option('--offset <n>', 'pagination offset', '0')
    .option('--json', 'print JSON')
    .action((options: { db?: string; repo?: string; type?: string; limit: string; offset: string; json?: boolean }) => {
      const config = loadConfig(io.env);
      const type = options.type as NodeType | undefined;
      if (type && !NODE_TYPES.includes(type)) throw new Error(`--type must be one of: ${NODE_TYPES.join(', ')}`);
      const limit = parsePositive(options.limit, '--limit', MAX_PAGE);
      const offset = Number(options.offset);
      if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error('--offset must be from 0 to 1000000');
      const result = runGraphNodes(options.db ?? config.dbPath, options.repo, type, limit, offset);
      io.stdout(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${result.nodes.map((item) => `${item.type} ${item.key} [${item.id}]`).join('\n')}\n`);
    });

  const ci = program.command('ci').description('ingest and inspect CI evidence');
  ci
    .command('ingest <json-file>')
    .description('append a CI result from a JSON file to the workspace evidence graph')
    .requiredOption('--repo <key>', 'registered repository key')
    .option('--db <path>')
    .action(async (file: string, options: { db?: string; repo: string }) => {
      const config = loadConfig(io.env);
      const parsed = JSON.parse(await readBounded(file)) as unknown;
      const result = await ingestCiReport(options.db ?? config.dbPath, options.repo, parsed);
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    });

  const tests = program.command('tests').description('ingest and inspect test-report evidence');
  tests
    .command('ingest <report-file>')
    .description('parse JUnit, pytest, Jest or Go JSON and append a test-run record')
    .requiredOption('--repo <key>', 'registered repository key')
    .requiredOption('--format <format>', 'junit, pytest-json, jest-json or go-json')
    .option('--db <path>')
    .action(async (file: string, options: { db?: string; repo: string; format: string }) => {
      const config = loadConfig(io.env);
      const result = await ingestTestReport(options.db ?? config.dbPath, options.repo, file, options.format);
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    });
  tests
    .command('history')
    .description('list ingested test-report runs (historical flakiness still requires multiple runs)')
    .option('--db <path>')
    .option('--repo <key>')
    .option('--limit <n>', 'maximum runs', '100')
    .option('--offset <n>', 'pagination offset', '0')
    .option('--json', 'print JSON')
    .action((options: { db?: string; repo?: string; limit: string; offset: string; json?: boolean }) => {
      const config = loadConfig(io.env);
      const limit = parsePositive(options.limit, '--limit', MAX_PAGE);
      const offset = Number(options.offset);
      if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error('--offset must be from 0 to 1000000');
      const result = runTestHistory(options.db ?? config.dbPath, options.repo, limit, offset);
      io.stdout(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${result.runs.map((item) => `${item.key} — ${String(item.attrs['passed'] ?? 0)} passed / ${String(item.attrs['failed'] ?? 0)} failed`).join('\n')}\n`);
    });
}
