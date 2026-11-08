import { nodeIdFor } from '@orbit/core';
import type { GraphStore } from '@orbit/database';
import type { TelemetrySession } from './flight-recorder.js';
import type { TelemetryAnalysis } from './flight-recorder-extended.js';

export interface StoreTelemetrySessionInput {
  repositoryId: string;
  source: string;
  artifactRelativePath: string;
  session: TelemetrySession;
  analysis: TelemetryAnalysis;
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
  isDemo: boolean;
  pointCount: number;
  anomalyCount: number;
}

/** Persist a recording as immutable evidence and graph facts; raw bytes remain in the content-addressed artifact file. */
export function storeTelemetrySession(
  store: GraphStore,
  input: StoreTelemetrySessionInput,
): StoredTelemetrySession {
  const { session } = input;
  if (!/^[0-9a-f]{64}$/i.test(session.rawSha256)) throw new Error('session raw SHA-256 is invalid');
  if (!input.source.trim()) throw new Error('telemetry source is required');
  if (!input.artifactRelativePath || input.artifactRelativePath.startsWith('/') || input.artifactRelativePath.includes('..')) {
    throw new Error('artifact path must be a safe repository-local relative path');
  }
  if (input.commitSha && !/^[0-9a-f]{7,64}$/i.test(input.commitSha)) throw new Error('commit SHA is invalid');
  const timestamp = input.startedAt ?? session.points.find((point) => point.timestamp)?.timestamp ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error('telemetry session timestamp is invalid');

  const sessionKey = `telemetry:${session.rawSha256}`;
  const sessionNodeId = nodeIdFor(input.repositoryId, 'TelemetrySession', sessionKey);
  const deviceKey = input.deviceLabel?.trim() || undefined;
  const deviceNodeId = deviceKey ? nodeIdFor(input.repositoryId, 'HardwareDevice', deviceKey) : undefined;
  const firmwareKey = input.firmwareBuildId?.trim() || undefined;
  const firmwareNodeId = firmwareKey ? nodeIdFor(input.repositoryId, 'Firmware', `build:${firmwareKey}`) : undefined;
  const commitSha = input.commitSha?.toLowerCase();
  const commitNodeId = commitSha ? nodeIdFor(input.repositoryId, 'Commit', commitSha) : undefined;
  const relatedEntityIds = [sessionNodeId, deviceNodeId, firmwareNodeId, commitNodeId]
    .filter((value): value is string => Boolean(value));

  const evidence = store.evidence.append({
    repositoryId: input.repositoryId,
    source: input.source.slice(0, 512),
    sourceType: 'telemetry',
    timestamp,
    ...(commitSha ? { commitSha } : {}),
    contentHash: session.rawSha256,
    status: 'PARTIAL',
    limitations: [
      ...session.limitations,
      ...input.analysis.limitations,
      'Evidence status PARTIAL describes bounded parser output; it is not a judgement that the device passed or failed.',
      ...(input.isDemo ? ['This recording is synthetic demonstration data (DEMO), not a physical device capture.'] : []),
    ].slice(0, 50),
    relatedEntityIds,
  });

  const storedNode = store.nodes.upsert({
    repositoryId: input.repositoryId,
    type: 'TelemetrySession',
    key: sessionKey,
    attrs: {
      schemaVersion: 1,
      rawSha256: session.rawSha256,
      artifactRelativePath: input.artifactRelativePath,
      source: input.source.slice(0, 512),
      format: session.format,
      startedAt: timestamp,
      pointCount: session.points.length,
      metricNames: session.metricNames,
      eventCounts: session.eventCounts,
      watchdogEvents: session.watchdogEvents,
      resetEvents: session.resetEvents,
      anomalies: input.analysis.anomalies.slice(0, 500),
      anomalyCount: input.analysis.anomalies.length,
      metricStats: input.analysis.metricStats,
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
    const device = existing ?? store.nodes.upsert({
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
    const firmware = existing ?? store.nodes.upsert({
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
    const commit = existing ?? store.nodes.upsert({
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
    rawSha256: session.rawSha256,
    isDemo: input.isDemo,
    pointCount: session.points.length,
    anomalyCount: input.analysis.anomalies.length,
  };
}
