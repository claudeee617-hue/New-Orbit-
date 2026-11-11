import { OrbitError } from '@orbit/shared';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { nodeIdFor } from '@orbit/core';
import type { GraphStore } from '@orbit/database';
import { normalizeRepoPath } from './verification.js';
import type { TelemetrySession } from './flight-recorder.js';
import { analyseTelemetry, type TelemetryAnalysisOptions } from './flight-recorder-extended.js';
import { parseTelemetry } from './flight-recorder.js';

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const MAX_STORED_ANOMALIES = 30;
const MAX_STORED_METRICS = 100;

export interface StoreTelemetrySessionInput {
  repositoryId: string;
  /** Absolute root of the selected local repository. The artifact is verified to remain under it. */
  repositoryRoot: string;
  source: string;
  /** Existing repository-relative file containing the exact raw recording that was parsed. */
  artifactRelativePath: string;
  session: TelemetrySession;
  analysisOptions?: TelemetryAnalysisOptions;
  isDemo: boolean;
  deviceLabel?: string;
  firmwareBuildId?: string;
  commitSha?: string;
  startedAt?: string;
}

export interface StoredTelemetrySession {
  nodeId: string;
  evidenceId: string;
  rawSha256: string;
  artifactRelativePath: string;
  isDemo: boolean;
  pointCount: number;
  anomalyCount: number;
}

/**
 * Persist a recording as immutable evidence and graph facts.
 * Before writing, re-read the repo-local artifact and verify it matches the parser's raw SHA-256.
 * Raw telemetry is not copied into SQLite; only its hash, path and bounded analysis are stored.
 */
export async function storeTelemetrySession(
  store: GraphStore,
  input: StoreTelemetrySessionInput,
): Promise<StoredTelemetrySession> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new OrbitError('INVALID_INPUT', 'telemetry persistence input must be an object');
  }
  const { session } = input;
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw new OrbitError('INVALID_INPUT', 'telemetry session is required');
  }
  if (!/^[0-9a-f]{64}$/i.test(session.rawSha256))
    throw new OrbitError('INVALID_INPUT', 'session raw SHA-256 is invalid');
  if (typeof input.repositoryId !== 'string' || !input.repositoryId.trim()) {
    throw new OrbitError('INVALID_INPUT', 'repositoryId is required');
  }
  if (typeof input.repositoryRoot !== 'string' || !input.repositoryRoot.trim()) {
    throw new OrbitError('INVALID_INPUT', 'repository root is required');
  }
  if (typeof input.source !== 'string' || !input.source.trim() || input.source.length > 2048) {
    throw new OrbitError(
      'INVALID_INPUT',
      'telemetry source must be a non-empty string up to 2048 characters',
    );
  }
  if (typeof input.artifactRelativePath !== 'string') {
    throw new OrbitError('INVALID_INPUT', 'telemetry artifact path must be a string');
  }
  if (typeof input.isDemo !== 'boolean')
    throw new OrbitError('INVALID_INPUT', 'isDemo must be boolean');
  if (
    input.deviceLabel !== undefined &&
    (typeof input.deviceLabel !== 'string' || input.deviceLabel.length > 512)
  ) {
    throw new OrbitError('INVALID_INPUT', 'device label must be a string up to 512 characters');
  }
  if (
    input.firmwareBuildId !== undefined &&
    (typeof input.firmwareBuildId !== 'string' || input.firmwareBuildId.length > 512)
  ) {
    throw new OrbitError(
      'INVALID_INPUT',
      'firmware build ID must be a string up to 512 characters',
    );
  }
  if (input.commitSha !== undefined && typeof input.commitSha !== 'string') {
    throw new OrbitError('INVALID_INPUT', 'commit SHA must be a string');
  }
  if (input.startedAt !== undefined && typeof input.startedAt !== 'string') {
    throw new OrbitError('INVALID_INPUT', 'startedAt must be a string');
  }
  if (!store.repositories.get(input.repositoryId))
    throw new OrbitError('INVALID_INPUT', 'repository is not registered');
  const relativeArtifact = normalizeRepoPath(input.artifactRelativePath);
  const root = await realpath(resolve(input.repositoryRoot));
  const filePath = await realpath(resolve(root, relativeArtifact));
  const relativeActual = relative(root, filePath);
  if (
    !relativeActual ||
    relativeActual === '..' ||
    relativeActual.startsWith(`..${sep}`) ||
    relativeActual.startsWith(sep)
  ) {
    throw new OrbitError(
      'INVALID_INPUT',
      'telemetry artifact resolves outside the selected repository',
    );
  }
  if (!(await lstat(filePath)).isFile())
    throw new OrbitError('INVALID_INPUT', 'telemetry artifact must be a regular file');
  const raw = await readFile(filePath);
  if (raw.byteLength > MAX_ARTIFACT_BYTES)
    throw new OrbitError('INVALID_INPUT', 'telemetry artifact exceeds the 10 MiB limit');
  const actualHash = createHash('sha256').update(raw).digest('hex');
  if (actualHash !== session.rawSha256.toLowerCase()) {
    throw new OrbitError(
      'INVALID_INPUT',
      'telemetry artifact SHA-256 does not match the parsed session',
    );
  }
  const verifiedSession = parseTelemetry(raw.toString('utf8'), session.format);
  if (verifiedSession.rawSha256 !== actualHash) {
    throw new OrbitError(
      'INVALID_INPUT',
      'telemetry artifact could not be reproduced by the recorded-file parser',
    );
  }
  const analysis = analyseTelemetry(verifiedSession, input.analysisOptions);
  if (input.commitSha && !/^[0-9a-f]{7,64}$/i.test(input.commitSha))
    throw new OrbitError('INVALID_INPUT', 'commit SHA is invalid');
  const timestamp =
    input.startedAt ??
    verifiedSession.points.find((point) => point.timestamp)?.timestamp ??
    new Date().toISOString();
  const timestampDate = new Date(timestamp);
  if (!Number.isFinite(timestampDate.getTime()))
    throw new OrbitError('INVALID_INPUT', 'telemetry session timestamp is invalid');
  const canonicalTimestamp = timestampDate.toISOString();

  const sessionKey = `telemetry:${verifiedSession.rawSha256}`;
  const sessionNodeId = nodeIdFor(input.repositoryId, 'TelemetrySession', sessionKey);
  const deviceKey = input.deviceLabel?.trim().slice(0, 128) || undefined;
  const deviceNodeId = deviceKey
    ? nodeIdFor(input.repositoryId, 'HardwareDevice', deviceKey)
    : undefined;
  const firmwareKey = input.firmwareBuildId?.trim().slice(0, 128) || undefined;
  const firmwareNodeId = firmwareKey
    ? nodeIdFor(input.repositoryId, 'Firmware', `build:${firmwareKey}`)
    : undefined;
  const commitSha = input.commitSha?.toLowerCase();
  const commitNodeId = commitSha ? nodeIdFor(input.repositoryId, 'Commit', commitSha) : undefined;
  const relatedEntityIds = [sessionNodeId, deviceNodeId, firmwareNodeId, commitNodeId].filter(
    (value): value is string => Boolean(value),
  );

  return store.transaction(() => {
    const evidence = store.evidence.append({
      repositoryId: input.repositoryId,
      source: input.source.slice(0, 512),
      sourceType: 'telemetry',
      timestamp: canonicalTimestamp,
      ...(commitSha ? { commitSha } : {}),
      contentHash: verifiedSession.rawSha256,
      status: 'PARTIAL',
      limitations: [
        ...verifiedSession.limitations,
        ...analysis.limitations,
        'Evidence status PARTIAL describes bounded parser output; it is not a judgement that the device passed or failed.',
        ...(input.isDemo
          ? [
              'This recording is synthetic demonstration data (DEMO), not a physical device capture.',
            ]
          : []),
      ]
        .slice(0, 50)
        .map((item) => item.slice(0, 1000)),
      relatedEntityIds,
    });

    const storedNode = store.nodes.upsert({
      repositoryId: input.repositoryId,
      type: 'TelemetrySession',
      key: sessionKey,
      attrs: {
        schemaVersion: 1,
        rawSha256: verifiedSession.rawSha256,
        artifactRelativePath: relativeActual.split(sep).join('/'),
        source: input.source.slice(0, 512),
        format: verifiedSession.format,
        startedAt: canonicalTimestamp,
        pointCount: verifiedSession.points.length,
        metricNames: verifiedSession.metricNames.slice(0, MAX_STORED_METRICS),
        eventCounts: verifiedSession.eventCounts,
        watchdogEvents: verifiedSession.watchdogEvents,
        resetEvents: verifiedSession.resetEvents,
        anomalies: analysis.anomalies.slice(0, MAX_STORED_ANOMALIES).map((item) => ({
          id: item.id,
          ruleId: item.ruleId,
          kind: item.kind,
          severity: item.severity,
          pointIndex: item.pointIndex,
          timestamp: item.timestamp,
          message: item.message.slice(0, 300),
        })),
        anomalyCount: analysis.anomalies.length,
        metricStats: Object.fromEntries(
          Object.entries(analysis.metricStats).slice(0, MAX_STORED_METRICS),
        ),
        isDemo: input.isDemo,
        deviceLabel: deviceKey ?? null,
        firmwareBuildId: firmwareKey ?? null,
        commitSha: commitSha ?? null,
      },
      sourceEvidenceId: evidence.record.id,
      ...(commitSha ? { validFromCommit: commitSha } : {}),
    });

    if (deviceKey && deviceNodeId) {
      const existing = store.nodes.get(input.repositoryId, deviceNodeId);
      const device =
        existing ??
        store.nodes.upsert({
          repositoryId: input.repositoryId,
          type: 'HardwareDevice',
          key: deviceKey,
          attrs: { label: deviceKey, source: 'telemetry-session-metadata' },
          sourceEvidenceId: evidence.record.id,
        }).record;
      store.edges.upsert({
        repositoryId: input.repositoryId,
        type: 'OBSERVED_ON',
        fromId: storedNode.record.id,
        toId: device.id,
        attrs: { isDemo: input.isDemo },
        sourceEvidenceId: evidence.record.id,
      });
    }

    if (firmwareKey && firmwareNodeId) {
      const existing = store.nodes.get(input.repositoryId, firmwareNodeId);
      const firmware =
        existing ??
        store.nodes.upsert({
          repositoryId: input.repositoryId,
          type: 'Firmware',
          key: `build:${firmwareKey}`,
          attrs: { buildId: firmwareKey, source: 'telemetry-session-linkage' },
          sourceEvidenceId: evidence.record.id,
        }).record;
      store.edges.upsert({
        repositoryId: input.repositoryId,
        type: 'OBSERVED_ON',
        fromId: storedNode.record.id,
        toId: firmware.id,
        attrs: { firmwareBuildId: firmwareKey, isDemo: input.isDemo },
        sourceEvidenceId: evidence.record.id,
      });
    }

    if (commitSha && commitNodeId) {
      const existing = store.nodes.get(input.repositoryId, commitNodeId);
      const commit =
        existing ??
        store.nodes.upsert({
          repositoryId: input.repositoryId,
          type: 'Commit',
          key: commitSha,
          attrs: { sha: commitSha, source: 'telemetry-session-linkage' },
          sourceEvidenceId: evidence.record.id,
          validFromCommit: commitSha,
        }).record;
      store.edges.upsert({
        repositoryId: input.repositoryId,
        type: 'VERIFIED_BY',
        fromId: commit.id,
        toId: storedNode.record.id,
        attrs: { evidenceId: evidence.record.id, isDemo: input.isDemo },
        sourceEvidenceId: evidence.record.id,
        ...(commitSha ? { validFromCommit: commitSha } : {}),
      });
    }

    return {
      nodeId: storedNode.record.id,
      evidenceId: evidence.record.id,
      rawSha256: verifiedSession.rawSha256,
      artifactRelativePath: relativeActual.split(sep).join('/'),
      isDemo: input.isDemo,
      pointCount: verifiedSession.points.length,
      anomalyCount: analysis.anomalies.length,
    };
  });
}
