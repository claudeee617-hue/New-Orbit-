export type OrbitErrorCode =
  'CONFIG_INVALID' | 'INVALID_INPUT' | 'NOT_FOUND' | 'DATABASE_ERROR' | 'INTERNAL';

/** Process exit codes used by the CLI. 0 is success; codes are stable once released. */
export const EXIT_CODES: Readonly<Record<OrbitErrorCode, number>> = {
  INVALID_INPUT: 2,
  CONFIG_INVALID: 3,
  NOT_FOUND: 4,
  DATABASE_ERROR: 5,
  INTERNAL: 1,
};

export interface OrbitErrorOptions {
  cause?: unknown;
  /** Safe, non-secret context. Never put secret values here. */
  details?: Record<string, unknown>;
}

export class OrbitError extends Error {
  readonly code: OrbitErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: OrbitErrorCode, message: string, options: OrbitErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'OrbitError';
    this.code = code;
    this.details = options.details;
  }
}

export function isOrbitError(value: unknown): value is OrbitError {
  return value instanceof OrbitError;
}

/** Normalise anything thrown into an OrbitError without losing the original as `cause`. */
export function toOrbitError(value: unknown): OrbitError {
  if (isOrbitError(value)) return value;
  const message = value instanceof Error ? value.message : 'Unexpected non-error value was thrown';
  return new OrbitError('INTERNAL', message, { cause: value });
}

export function exitCodeFor(error: unknown): number {
  return EXIT_CODES[toOrbitError(error).code];
}
