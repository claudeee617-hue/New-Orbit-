import { createHash } from 'node:crypto';
import type { TelemetrySession } from './flight-recorder.js';

const MAX_THRESHOLD_RULES = 200;
const MAX_METRIC_SAMPLES = 250_000;
const MAX_ANALYSIS_ANOMALIES = 100_000;

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
  metricStats: Record<
    string,
    { count: number; min: number; max: number; mean: number; unit: string | null }
  >;
  eventCounts: Record<string, number>;
  limitations: string[];
}


function normalizeEventForAnalysis(value: string | null): string | null {
  if (!value) return null;
  const event = value.toLowerCase();
  const hasWatchdog = event.includes('watchdog') || event.includes('wdt');
  const hasReset = event.includes('reset') || event.includes('reboot');
  if (hasWatchdog && hasReset) return 'watchdog_reset';
  if (hasWatchdog) return 'watchdog';
  if (hasReset) return 'reset';
  if (event.includes('boot')) return 'boot';
  if (event.includes('panic')) return 'panic';
  if (event.includes('brownout')) return 'brownout';
  if (event.includes('fault') || event.includes('exception') || event.includes('assert')) return 'fault';
  if (event.includes('crash')) return 'crash';
  if (event.includes('disconnect')) return 'disconnected';
  if (event.includes('connect')) return 'connected';
  if (event.includes('start')) return 'start';
  if (event.includes('stop')) return 'stop';
  return 'other';
}
function stableId(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

/** Apply optional source-defined units and explicit threshold rules to a parsed recording. */
export function analyseTelemetry(
  session: TelemetrySession,
  options: TelemetryAnalysisOptions = {},
): TelemetryAnalysis {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw new Error('telemetry session must be an object');
  }
  if (!/^[0-9a-f]{64}$/i.test(session.rawSha256)) {
    throw new Error('telemetry session SHA-256 is invalid');
  }
  if (!['json', 'ndjson', 'csv', 'key-value'].includes(session.format)) {
    throw new Error('telemetry session format is invalid');
  }
  if (!Array.isArray(session.points) || session.points.length === 0 || session.points.length > 100_000) {
    throw new Error('telemetry session must contain between 1 and 100000 points');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('telemetry analysis options must be an object');
  }
  const units = options.units ?? {};
  if (!units || typeof units !== 'object' || Array.isArray(units)) {
    throw new Error('telemetry units must be an object');
  }
  const unitEntries = Object.entries(units);
  if (unitEntries.length > 100 || unitEntries.some(([key, value]) =>
    !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || typeof value !== 'string' || value.length > 32
  )) {
    throw new Error('telemetry units must contain at most 100 valid metric names and short unit strings');
  }
  const thresholds = options.thresholds ?? [];
  if (!Array.isArray(thresholds)) throw new Error('telemetry thresholds must be an array');
  const rules = [...thresholds];
  if (rules.length > MAX_THRESHOLD_RULES) {
    throw new Error('at most ' + MAX_THRESHOLD_RULES + ' telemetry threshold rules are allowed');
  }
  const ruleIds = new Set<string>();
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error('each telemetry threshold rule must be an object');
    }
    if (typeof rule.id !== 'string' || !rule.id.trim() || rule.id.length > 128 || ruleIds.has(rule.id)) {
      throw new Error('telemetry threshold rule IDs must be non-empty, unique strings up to 128 characters');
    }
    ruleIds.add(rule.id);
    if (typeof rule.metric !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(rule.metric)) {
      throw new Error('threshold ' + rule.id + ' requires a valid metric name');
    }
    if (rule.unit !== undefined && (typeof rule.unit !== 'string' || rule.unit.length > 32)) {
      throw new Error('threshold ' + rule.id + ' unit must be a short string');
    }
    if (rule.label !== undefined && (typeof rule.label !== 'string' || rule.label.length > 200)) {
      throw new Error('threshold ' + rule.id + ' label must be a string up to 200 characters');
    }
    if (rule.min === undefined && rule.max === undefined) {
      throw new Error('threshold ' + rule.id + ' must define min or max');
    }
    if (rule.severity !== undefined && !['info', 'warning', 'error'].includes(rule.severity)) {
      throw new Error('threshold ' + rule.id + ' severity is invalid');
    }
    if (rule.min !== undefined && !Number.isFinite(rule.min)) {
      throw new Error('threshold ' + rule.id + ' min must be finite');
    }
    if (rule.max !== undefined && !Number.isFinite(rule.max)) {
      throw new Error('threshold ' + rule.id + ' max must be finite');
    }
    if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
      throw new Error('threshold ' + rule.id + ' min must not exceed max');
    }
  }

  const metrics: TypedTelemetryMetric[] = [];
  const anomalies: TelemetryAnomaly[] = [];
  const values = new Map<string, number[]>();
  let metricSampleCount = 0;
  const addAnomaly = (anomaly: TelemetryAnomaly): void => {
    if (anomalies.length >= MAX_ANALYSIS_ANOMALIES) {
      throw new Error('telemetry analysis exceeds the ' + MAX_ANALYSIS_ANOMALIES + ' anomaly limit');
    }
    anomalies.push(anomaly);
  };
  const eventCounts: Record<string, number> = {};

  session.points.forEach((point, pointIndex) => {
    if (!point || typeof point !== 'object' || Array.isArray(point)) {
      throw new Error('telemetry session contains an invalid point');
    }
    if (
      (point.timestamp !== null && typeof point.timestamp !== 'string') ||
      !point.metrics ||
      typeof point.metrics !== 'object' ||
      Array.isArray(point.metrics) ||
      (point.event !== null && typeof point.event !== 'string')
    ) {
      throw new Error('telemetry session contains an invalid point shape');
    }
    const event = normalizeEventForAnalysis(point.event);
    if (event) eventCounts[event] = (eventCounts[event] ?? 0) + 1;
    if (event === 'watchdog' || event === 'watchdog_reset') {
      const ruleId = 'event.watchdog';
      addAnomaly({
        id: stableId([session.rawSha256, ruleId, pointIndex, event]),
        ruleId,
        kind: 'watchdog',
        severity: 'error',
        pointIndex,
        timestamp: point.timestamp,
        message: 'Watchdog-related event detected in the supplied telemetry recording.',
      });
    }
    if (event === 'reset' || event === 'watchdog_reset') {
      const ruleId = 'event.reset';
      addAnomaly({
        id: stableId([session.rawSha256, ruleId, pointIndex, point.event]),
        ruleId,
        kind: 'reset',
        severity: 'warning',
        pointIndex,
        timestamp: point.timestamp,
        message: 'Reset-related event detected in the supplied telemetry recording.',
      });
    }

    for (const [name, value] of Object.entries(point.metrics)) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) || typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('telemetry session contains an invalid metric value');
      }
      metricSampleCount += 1;
      if (metricSampleCount > MAX_METRIC_SAMPLES) {
        throw new Error('telemetry analysis exceeds the ' + MAX_METRIC_SAMPLES + ' metric sample limit');
      }
      metrics.push({
        pointIndex,
        timestamp: point.timestamp,
        name,
        value,
        unit:
          units[name] ??
          rules.find((rule) => rule.metric === name && rule.unit)?.unit ??
          null,
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
        addAnomaly({
          id: stableId([session.rawSha256, ruleId, pointIndex, name, value, limit]),
          ruleId,
          kind: 'threshold',
          severity: rule.severity ?? 'warning',
          pointIndex,
          timestamp: point.timestamp,
          metric: name,
          value,
          ...(limit !== undefined ? { limit } : {}),
          message:
            rule.label?.slice(0, 200) ??
            `${name}=${value}${units[name] ? ` ${units[name]}` : ''} is ${comparator} configured limit ${limit}`,
        });
      }
    }
  });

  const metricStats: TelemetryAnalysis['metricStats'] = {};
  for (const [name, series] of [...values.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sum = series.reduce((total, value) => total + value, 0);
    metricStats[name] = {
      count: series.length,
      min: series.reduce((minimum, value) => Math.min(minimum, value), Number.POSITIVE_INFINITY),
      max: series.reduce((maximum, value) => Math.max(maximum, value), Number.NEGATIVE_INFINITY),
      mean: sum / series.length,
      unit:
        options.units?.[name] ??
        rules.find((rule) => rule.metric === name && rule.unit)?.unit ??
        null,
    };
  }

  return {
    schemaVersion: 1,
    metrics,
    anomalies: anomalies.sort(
      (a, b) => a.pointIndex - b.pointIndex || a.ruleId.localeCompare(b.ruleId),
    ),
    metricStats,
    eventCounts: Object.fromEntries(
      Object.entries(eventCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
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
    async read() {
      return content;
    },
    async close() {
      /* no external resource is held */
    },
  };
}

export const SERIAL_TRANSPORT_STATUS = {
  available: false,
  reason:
    'No USB serial adapter is shipped in this build. Use recorded-file replay; physical device access requires a separately reviewed, explicitly approved adapter.',
} as const;
