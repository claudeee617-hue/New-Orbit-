import { createHash } from 'node:crypto';
import type { TelemetrySession } from './flight-recorder.js';

export type TelemetrySeverity = 'info' | 'warning' | 'error';

export interface TelemetryThresholdRule {
  id: string;
  metric: string;
  min?: number;
  max?: number;
  unit?: string;
  severity?: TelemetrySeverity;
  label?: string;
}

export interface TelemetryAnalysisOptions {
  /** Explicit source-defined units. ORBIT never guesses a unit from a metric name. */
  units?: Readonly<Record<string, string>>;
  thresholds?: readonly TelemetryThresholdRule[];
}

export interface TypedTelemetryMetric {
  pointIndex: number;
  timestamp: string | null;
  name: string;
  value: number;
  unit: string | null;
}

export interface TelemetryAnomaly {
  id: string;
  ruleId: string;
  kind: 'watchdog' | 'reset' | 'threshold';
  severity: TelemetrySeverity;
  pointIndex: number;
  timestamp: string | null;
  metric?: string;
  value?: number;
  limit?: number;
  message: string;
}

export interface TelemetryAnalysis {
  schemaVersion: 1;
  metrics: TypedTelemetryMetric[];
  anomalies: TelemetryAnomaly[];
  metricStats: Record<string, { count: number; min: number; max: number; mean: number; unit: string | null }>;
  eventCounts: Record<string, number>;
  limitations: string[];
}

function stableId(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

/** Apply optional source-defined units and explicit threshold rules to a parsed recording. */
export function analyseTelemetry(
  session: TelemetrySession,
  options: TelemetryAnalysisOptions = {},
): TelemetryAnalysis {
  const rules = [...(options.thresholds ?? [])];
  const ruleIds = new Set<string>();
  for (const rule of rules) {
    if (!rule.id.trim() || ruleIds.has(rule.id)) throw new Error('telemetry threshold rule IDs must be non-empty and unique');
    ruleIds.add(rule.id);
    if (!rule.metric.trim()) throw new Error(`threshold ${rule.id} requires a metric name`);
    if (rule.min !== undefined && !Number.isFinite(rule.min)) throw new Error(`threshold ${rule.id} min must be finite`);
    if (rule.max !== undefined && !Number.isFinite(rule.max)) throw new Error(`threshold ${rule.id} max must be finite`);
    if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
      throw new Error(`threshold ${rule.id} min must not exceed max`);
    }
  }

  const metrics: TypedTelemetryMetric[] = [];
  const anomalies: TelemetryAnomaly[] = [];
  const values = new Map<string, number[]>();
  const eventCounts: Record<string, number> = { ...session.eventCounts };

  session.points.forEach((point, pointIndex) => {
    const event = point.event?.toLowerCase() ?? '';
    if (event.includes('watchdog') || event.includes('wdt')) {
      const ruleId = 'event.watchdog';
      anomalies.push({
        id: stableId([session.rawSha256, ruleId, pointIndex, point.event]),
        ruleId,
        kind: 'watchdog',
        severity: 'error',
        pointIndex,
        timestamp: point.timestamp,
        message: `Watchdog-related event observed: ${point.event}`,
      });
    } else if (event.includes('reset') || event.includes('reboot')) {
      const ruleId = 'event.reset';
      anomalies.push({
        id: stableId([session.rawSha256, ruleId, pointIndex, point.event]),
        ruleId,
        kind: 'reset',
        severity: 'warning',
        pointIndex,
        timestamp: point.timestamp,
        message: `Reset-related event observed: ${point.event}`,
      });
    }

    for (const [name, value] of Object.entries(point.metrics)) {
      metrics.push({
        pointIndex,
        timestamp: point.timestamp,
        name,
        value,
        unit: options.units?.[name] ?? null,
      });
      const series = values.get(name) ?? [];
      series.push(value);
      values.set(name, series);

      for (const rule of rules) {
        if (rule.metric !== name) continue;
        const below = rule.min !== undefined && value < rule.min;
        const above = rule.max !== undefined && value > rule.max;
        if (!below && !above) continue;
        const limit = below ? rule.min : rule.max;
        const comparator = below ? 'below' : 'above';
        const ruleId = `threshold.${rule.id}`;
        anomalies.push({
          id: stableId([session.rawSha256, ruleId, pointIndex, name, value, limit]),
          ruleId,
          kind: 'threshold',
          severity: rule.severity ?? 'warning',
          pointIndex,
          timestamp: point.timestamp,
          metric: name,
          value,
          ...(limit !== undefined ? { limit } : {}),
          message: rule.label?.slice(0, 200) ??
            `${name}=${value}${options.units?.[name] ? ` ${options.units[name]}` : ''} is ${comparator} configured limit ${limit}`,
        });
      }
    }
  });

  const metricStats: TelemetryAnalysis['metricStats'] = {};
  for (const [name, series] of [...values.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sum = series.reduce((total, value) => total + value, 0);
    metricStats[name] = {
      count: series.length,
      min: Math.min(...series),
      max: Math.max(...series),
      mean: sum / series.length,
      unit: options.units?.[name] ?? null,
    };
  }

  return {
    schemaVersion: 1,
    metrics,
    anomalies: anomalies.sort((a, b) => a.pointIndex - b.pointIndex || a.ruleId.localeCompare(b.ruleId)),
    metricStats,
    eventCounts: Object.fromEntries(Object.entries(eventCounts).sort(([a], [b]) => a.localeCompare(b))),
    limitations: [
      'Watchdog and reset detection is keyword-based; confirm event meanings against the firmware log specification.',
      'Threshold findings are produced only from caller-supplied rules and units; no universal device limits are inferred.',
      'Recorded telemetry is observational evidence and does not prove firmware correctness or causation.',
    ],
  };
}

export interface TelemetryTransport {
  readonly kind: 'recorded-file';
  readonly readOnly: true;
  read(): Promise<string>;
  close(): Promise<void>;
}

/** In-memory transport adapter for a file that the CLI or caller has already read safely. */
export function createRecordedFileTransport(content: string): TelemetryTransport {
  return {
    kind: 'recorded-file',
    readOnly: true,
    async read() { return content; },
    async close() { /* no external resource is held */ },
  };
}

export const SERIAL_TRANSPORT_STATUS = {
  available: false,
  reason: 'No USB serial adapter is shipped in this build. Use recorded-file replay; physical device access requires a separately reviewed, explicitly approved adapter.',
} as const;
