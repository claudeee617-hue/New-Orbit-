import { createHash } from 'node:crypto';

export interface TelemetryPoint {
  timestamp: string | null;
  metrics: Record<string, number>;
  event: string | null;
  /** Kept empty for backwards-compatible shape; raw lines can contain secrets and are not copied into reports. */
  raw: string;
}

export interface TelemetrySession {
  schemaVersion: 1;
  format: 'json' | 'ndjson' | 'csv' | 'key-value';
  points: TelemetryPoint[];
  eventCounts: Record<string, number>;
  metricNames: string[];
  watchdogEvents: number;
  resetEvents: number;
  rawSha256: string;
  limitations: string[];
}

const MAX_TELEMETRY_BYTES = 10 * 1024 * 1024;
const METRIC_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function normaliseEvent(value: string): string {
  const event = value.toLowerCase();
  const hasWatchdog = event.includes('watchdog') || event.includes('wdt');
  const hasReset = event.includes('reset') || event.includes('reboot');
  if (hasWatchdog && hasReset) return 'watchdog_reset';
  if (hasWatchdog) return 'watchdog';
  if (hasReset) return 'reset';
  if (event.includes('boot')) return 'boot';
  if (event.includes('panic')) return 'panic';
  if (event.includes('brownout')) return 'brownout';
  if (event.includes('fault') || event.includes('exception') || event.includes('assert'))
    return 'fault';
  if (event.includes('crash')) return 'crash';
  if (event.includes('disconnect')) return 'disconnected';
  if (event.includes('connect')) return 'connected';
  if (event.includes('start')) return 'start';
  if (event.includes('stop')) return 'stop';
  return 'other';
}

const ISO_LIKE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * Wall-clock timestamps only. ISO-8601-style strings (zone-less values are read as UTC so results
 * do not depend on the machine's time zone) and epoch seconds/milliseconds of a plausible year
 * (2001–5138). Small numbers such as uptime ticks or sequence numbers are not dates and are
 * ignored rather than turned into 1970 or machine-local times.
 */
export function parseTelemetryTimestamp(item: unknown): string | null {
  let ms: number | undefined;
  if (typeof item === 'number' || (typeof item === 'string' && /^\d+(\.\d+)?$/.test(item.trim()))) {
    const n = Number(item);
    if (n >= 1e9 && n < 1e11) ms = n * 1000;
    else if (n >= 1e11 && n < 1e14) ms = n;
  } else if (typeof item === 'string') {
    const text = item.trim();
    const match = ISO_LIKE.exec(text);
    if (match) {
      const zone = match[7];
      const normalized = zone || !match[4] ? text : `${text.replace(' ', 'T')}Z`;
      ms = new Date(normalized.replace(' ', 'T').replace(/\s+(?=Z|[+-])/i, '')).getTime();
      if (!zone && !match[4]) ms = new Date(`${text}T00:00:00Z`).getTime();
    }
  }
  if (ms === undefined || !Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normaliseRecord(value: Record<string, unknown>): TelemetryPoint {
  const metrics: Record<string, number> = {};
  let timestamp: string | null = null;
  let event: string | null = null;
  for (const [key, item] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (['timestamp', 'time', 'ts', 'datetime'].includes(lower)) {
      timestamp = parseTelemetryTimestamp(item) ?? timestamp;
    } else if (['event', 'type', 'message', 'status'].includes(lower)) {
      if (typeof item === 'string' && item.trim()) event = normaliseEvent(item);
    } else if (typeof item === 'number' && Number.isFinite(item) && METRIC_NAME.test(key)) {
      metrics[key] = item;
    } else if (
      typeof item === 'string' &&
      item.trim() !== '' &&
      Number.isFinite(Number(item)) &&
      METRIC_NAME.test(key)
    ) {
      metrics[key] = Number(item);
    }
  }
  return {
    timestamp,
    metrics: Object.fromEntries(Object.entries(metrics).sort(([a], [b]) => a.localeCompare(b))),
    event,
    raw: '',
  };
}

function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"' && quoted && line[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  cells.push(cell);
  return cells;
}

function parseKeyValue(line: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const pattern = /([A-Za-z][A-Za-z0-9_.-]{0,63})\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
  for (const match of line.matchAll(pattern)) {
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    result[match[1]!] = value;
  }
  return result;
}

/** Parse recorded device output. This function never opens a serial port or sends device commands. */
export function parseTelemetry(
  input: string,
  format?: TelemetrySession['format'],
): TelemetrySession {
  if (typeof input !== 'string') throw new Error('Telemetry input must be text');
  if (format !== undefined && !['json', 'ndjson', 'csv', 'key-value'].includes(format)) {
    throw new Error('Telemetry format must be json, ndjson, csv or key-value');
  }
  if (Buffer.byteLength(input, 'utf8') > MAX_TELEMETRY_BYTES)
    throw new Error('Telemetry exceeds the 10 MiB parser limit');
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Telemetry input is empty');
  let detected = format;
  if (!detected) {
    try {
      JSON.parse(trimmed);
      detected = 'json';
    } catch {
      const rows = trimmed.split(/\r?\n/).filter(Boolean);
      const isNdjson =
        rows.length > 1 &&
        rows.every((row) => {
          try {
            const value = JSON.parse(row) as unknown;
            return !!value && typeof value === 'object' && !Array.isArray(value);
          } catch {
            return false;
          }
        });
      if (isNdjson) detected = 'ndjson';
      else if (/^[^\r\n]*,[^\r\n]*\r?\n/.test(trimmed)) detected = 'csv';
      else detected = 'key-value';
    }
  }

  let records: Array<{ value: Record<string, unknown>; raw: string }>;
  if (detected === 'json') {
    const parsed = JSON.parse(trimmed) as unknown;
    const values = Array.isArray(parsed) ? parsed : [parsed];
    if (values.length === 0 || values.length > 100_000) {
      throw new Error('JSON telemetry must contain between 1 and 100000 records');
    }
    records = values.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('JSON telemetry records must be objects');
      }
      return { value: value as Record<string, unknown>, raw: '' };
    });
  } else if (detected === 'ndjson') {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0 || lines.length > 100_000)
      throw new Error('NDJSON must contain between 1 and 100000 records');
    records = lines.map((raw) => {
      const value = JSON.parse(raw) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('NDJSON rows must be objects');
      return { value: value as Record<string, unknown>, raw };
    });
  } else if (detected === 'csv') {
    const [headerLine, ...dataLines] = trimmed.split(/\r?\n/);
    const headers = csvCells(headerLine ?? '').map((value) => value.trim());
    if (
      headers.length === 0 ||
      headers.some((header) => !header) ||
      new Set(headers).size !== headers.length
    ) {
      throw new Error('CSV telemetry requires unique, non-empty column names');
    }
    const lines = dataLines.filter((line) => line.trim());
    if (lines.length === 0 || lines.length > 100_000)
      throw new Error('CSV must contain between 1 and 100000 data rows');
    records = lines.map((raw) => {
      const cells = csvCells(raw);
      if (cells.length !== headers.length)
        throw new Error('CSV row has a different number of columns than its header');
      const value: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        value[header] = cells[index] ?? '';
      });
      return { value, raw: '' };
    });
  } else {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0 || lines.length > 100_000)
      throw new Error('Key-value telemetry must contain between 1 and 100000 records');
    records = lines.map((raw) => {
      const value = parseKeyValue(raw);
      if (Object.keys(value).length === 0)
        throw new Error('Key-value telemetry line contains no key/value pairs');
      return { value, raw: '' };
    });
  }

  const points = records.map(({ value }) => normaliseRecord(value));
  const eventCounts: Record<string, number> = {};
  const metricNames = new Set<string>();
  let watchdogEvents = 0;
  let resetEvents = 0;
  for (const point of points) {
    for (const name of Object.keys(point.metrics)) metricNames.add(name);
    const event = point.event?.toLowerCase() ?? '';
    if (event) eventCounts[event] = (eventCounts[event] ?? 0) + 1;
    if (event.includes('watchdog') || event.includes('wdt')) watchdogEvents += 1;
    if (event.includes('reset') || event.includes('reboot')) resetEvents += 1;
  }
  return {
    schemaVersion: 1,
    format: detected,
    points,
    eventCounts: Object.fromEntries(
      Object.entries(eventCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
    metricNames: [...metricNames].sort(),
    watchdogEvents,
    resetEvents,
    rawSha256: createHash('sha256').update(input).digest('hex'),
    limitations: [
      'This parser analyses supplied log data only; it does not connect to or control hardware.',
      'Metric names and units are source-defined. ORBIT does not infer units from numeric values.',
      'Raw log lines are not copied into parsed records because they may contain credentials or personal data; the raw artifact is represented by its SHA-256 digest.',
      'Event classification is keyword-based and must be checked against the device firmware log format.',
    ],
  };
}
