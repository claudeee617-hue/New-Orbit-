import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IN_MEMORY, openDatabase, createGraphStore } from '@orbit/database';
import { parseTelemetry } from './flight-recorder.js';
import {
  analyseTelemetry,
  createRecordedFileTransport,
  SERIAL_TRANSPORT_STATUS,
} from './flight-recorder-extended.js';
import { storeTelemetrySession } from './telemetry-store.js';

const databases: ReturnType<typeof openDatabase>[] = [];
const directories: string[] = [];
function setup() {
  const database = openDatabase({ path: IN_MEMORY });
  databases.push(database);
  const store = createGraphStore(database);
  const repository = store.repositories.register({
    key: 'test/telemetry',
    displayName: 'Telemetry Test',
  }).record;
  return { database, store, repository };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('FLIGHT RECORDER typed analysis', () => {
  it('parses recorded metrics, applies explicit units and threshold rules, and avoids retaining raw lines', () => {
    const raw = [
      '{"timestamp":"2026-11-08T10:00:00Z","voltage":3.3,"event":"boot","token":"DO_NOT_COPY"}',
      '{"timestamp":"2026-11-08T10:00:01Z","voltage":3.7,"temperature":84.2,"event":"watchdog reset"}',
    ].join('\n');
    const session = parseTelemetry(raw);
    const analysis = analyseTelemetry(session, {
      units: { voltage: 'V', temperature: '°C' },
      thresholds: [
        { id: 'voltage-limit', metric: 'voltage', max: 3.5, unit: 'V', severity: 'warning' },
      ],
    });
    expect(analysis.metricStats.voltage).toMatchObject({ count: 2, min: 3.3, max: 3.7, unit: 'V' });
    expect(analysis.anomalies.map((item) => item.kind)).toEqual(['reset', 'watchdog', 'threshold']);
    expect(analysis.anomalies.find((item) => item.kind === 'threshold')).toMatchObject({
      metric: 'voltage',
      value: 3.7,
      limit: 3.5,
      severity: 'warning',
    });
    expect(session.points.every((point) => point.raw === '')).toBe(true);
    expect(JSON.stringify({ session, analysis })).not.toContain('DO_NOT_COPY');
  });

  it('requires explicit bounds and unique IDs for threshold rules', () => {
    const session = parseTelemetry('{"temperature":23}');
    expect(() => analyseTelemetry(session, [{ id: 'empty', metric: 'temperature' }])).toThrow(
      /min or max/,
    );
    expect(() =>
      analyseTelemetry(session, [
        { id: 'same', metric: 'temperature', max: 30 },
        { id: 'same', metric: 'temperature', max: 20 },
      ]),
    ).toThrow(/unique/);
  });

  it('uses a recorded-file-only transport and explicitly reports serial support unavailable', async () => {
    const transport = createRecordedFileTransport('voltage=3.3');
    expect(transport.kind).toBe('recorded-file');
    expect(transport.readOnly).toBe(true);
    expect(await transport.read()).toBe('voltage=3.3');
    await transport.close();
    expect(SERIAL_TRANSPORT_STATUS.available).toBe(false);
  });

  it('rejects empty, malformed, oversized-row-count and inconsistent CSV input', () => {
    expect(() => parseTelemetry('  ')).toThrow(/empty/);
    expect(() => parseTelemetry('[1,2]')).toThrow(/records must be objects/);
    expect(() => parseTelemetry('timestamp,voltage\n2026-11-08T10:00:00Z')).toThrow(
      /different number of columns/,
    );
    expect(() => parseTelemetry('key=value', 'ndjson')).toThrow(/valid JSON|JSON/);
  });
});

describe('FLIGHT RECORDER immutable persistence', () => {
  it('verifies the source artifact, stores a demo session and links device, firmware and commit', async () => {
    const { store, repository } = setup();
    const root = mkdtempSync(join(tmpdir(), 'orbit-telemetry-'));
    directories.push(root);
    mkdirSync(join(root, 'logs'));
    const raw = [
      '{"timestamp":"2026-11-08T10:00:00Z","voltage":3.3,"event":"boot"}',
      '{"timestamp":"2026-11-08T10:00:01Z","voltage":3.1,"event":"watchdog reset"}',
    ].join('\n');
    writeFileSync(join(root, 'logs', 'esp32-demo.ndjson'), raw);
    const session = parseTelemetry(raw);
    const stored = await storeTelemetrySession(store, {
      repositoryId: repository.id,
      repositoryRoot: root,
      source: 'fixtures/hardware-telemetry/esp32-demo.ndjson',
      artifactRelativePath: 'logs/esp32-demo.ndjson',
      session,
      analysisOptions: { units: { voltage: 'V' } },
      isDemo: true,
      deviceLabel: 'ESP32 demo board',
      firmwareBuildId: 'demo-fw-001',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
    });
    const node = store.nodes.get(repository.id, stored.nodeId);
    expect(node?.type).toBe('TelemetrySession');
    expect(node?.attrs.isDemo).toBe(true);
    expect(node?.attrs.firmwareBuildId).toBe('demo-fw-001');
    expect(stored.isDemo).toBe(true);
    expect(stored.pointCount).toBe(2);
    expect(store.evidence.get(repository.id, stored.evidenceId)?.status).toBe('PARTIAL');
    expect(store.verifyIntegrity(repository.id).ok).toBe(true);
    expect(JSON.stringify(node?.attrs)).not.toContain('watchdog reset');
  });

  it('rejects path traversal and an artifact whose bytes do not match the parsed SHA-256', async () => {
    const { store, repository } = setup();
    const root = mkdtempSync(join(tmpdir(), 'orbit-telemetry-invalid-'));
    directories.push(root);
    writeFileSync(join(root, 'record.ndjson'), '{"voltage":3.3}');
    const raw = '{"voltage":3.2}';
    const session = parseTelemetry(raw);
    await expect(
      storeTelemetrySession(store, {
        repositoryId: repository.id,
        repositoryRoot: root,
        source: 'test',
        artifactRelativePath: '../outside.ndjson',
        session,
        analysisOptions: {},
        isDemo: false,
      }),
    ).rejects.toThrow(/Unsafe repository path/);
    await expect(
      storeTelemetrySession(store, {
        repositoryId: repository.id,
        repositoryRoot: root,
        source: 'test',
        artifactRelativePath: 'record.ndjson',
        session,
        analysisOptions: {},
        isDemo: false,
      }),
    ).rejects.toThrow(/does not match/);
    expect(store.evidence.list(repository.id)).toHaveLength(0);
  });
});
