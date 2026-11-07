import { pino, type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

export interface CreateLoggerOptions {
  name: string;
  level?: LoggerOptions['level'];
  /** Where to write. Defaults to stderr so stdout stays clean for machine-readable CLI output. */
  destination?: NodeJS.WritableStream;
}

/** Paths whose values must never appear in logs. */
export const REDACTED_PATHS = [
  'token',
  'apiKey',
  'password',
  'secret',
  'authorization',
  '*.token',
  '*.apiKey',
  '*.password',
  '*.secret',
  '*.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
];

export function createLogger(options: CreateLoggerOptions): Logger {
  const loggerOptions: LoggerOptions = {
    name: options.name,
    level: options.level ?? 'info',
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
  };
  return pino(loggerOptions, options.destination ?? pino.destination(2));
}
