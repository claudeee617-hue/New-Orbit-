import { createHash } from 'node:crypto';
import { OrbitError } from '@orbit/shared';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const MAX_DEPTH = 64;

/**
 * Deterministic JSON encoding used for every hash in ORBIT.
 *
 * - Object keys are sorted; properties whose value is `undefined` are omitted (they are "absent").
 * - Numbers must be finite. Strings use standard JSON escaping.
 * - Only plain objects, arrays, strings, numbers, booleans and null are accepted. Anything else
 *   (functions, Dates, Maps, bigint, class instances, `undefined` inside arrays) throws rather
 *   than being silently coerced, so two different inputs can never hash to the same bytes.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, 0);
}

function encode(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) throw invalid('Value is nested too deeply to hash');
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw invalid('Cannot hash a non-finite number');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw invalid(`Cannot hash a value of type ${typeof value}`);
  }

  if (Array.isArray(value)) {
    const items = value.map((item: unknown) => {
      if (item === undefined) throw invalid('Cannot hash an undefined array element');
      return encode(item, depth + 1);
    });
    return `[${items.join(',')}]`;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalid('Only plain objects can be hashed');
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${encode(entry, depth + 1)}`).join(',')}}`;
}

/** SHA-256 of a string (UTF-8) or bytes, as lowercase hex. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** SHA-256 of the canonical JSON encoding of a value. */
export function hashValue(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Hash an evidence artifact (a coverage file, a log, a report, …). */
export function hashArtifact(bytes: string | Uint8Array): string {
  return sha256Hex(bytes);
}

/** True when `bytes` hash to `expectedHash`. Comparison is case-insensitive on the hex digits. */
export function verifyArtifactHash(expectedHash: string, bytes: string | Uint8Array): boolean {
  return hashArtifact(bytes) === expectedHash.toLowerCase();
}

function invalid(message: string): OrbitError {
  return new OrbitError('INVALID_INPUT', message);
}
