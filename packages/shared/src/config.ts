import { z } from 'zod';
import { OrbitError } from './errors.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z
  .object({
    ORBIT_HOST: z.string().min(1).default('127.0.0.1'),
    ORBIT_PORT: z.coerce.number().int().min(1).max(65535).default(4317),
    ORBIT_DB_PATH: z.string().min(1).default('.orbit/orbit.db'),
    ORBIT_LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Explicit opt-in required to bind the API to anything other than loopback. */
    ORBIT_ALLOW_NON_LOOPBACK: booleanFlag.default(false),
  })
  .superRefine((value, ctx) => {
    if (!value.ORBIT_ALLOW_NON_LOOPBACK && !LOOPBACK_HOSTS.has(value.ORBIT_HOST)) {
      ctx.addIssue({
        code: 'custom',
        path: ['ORBIT_HOST'],
        message:
          'must be a loopback address (127.0.0.1, localhost, ::1) unless ORBIT_ALLOW_NON_LOOPBACK=true',
      });
    }
  });

export interface OrbitConfig {
  host: string;
  port: number;
  dbPath: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  allowNonLoopback: boolean;
}

/**
 * Load configuration from environment variables.
 * Error messages name the offending variables but never echo their values.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): OrbitConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => ({
      variable: String(issue.path[0] ?? 'unknown'),
      problem: issue.message,
    }));
    throw new OrbitError(
      'CONFIG_INVALID',
      `Invalid configuration: ${problems.map((p) => `${p.variable} ${p.problem}`).join('; ')}`,
      { details: { problems } },
    );
  }
  const data = parsed.data;
  return {
    host: data.ORBIT_HOST,
    port: data.ORBIT_PORT,
    dbPath: data.ORBIT_DB_PATH,
    logLevel: data.ORBIT_LOG_LEVEL,
    allowNonLoopback: data.ORBIT_ALLOW_NON_LOOPBACK,
  };
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}
