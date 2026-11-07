import { Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EXIT_CODES,
  ORBIT_VERSION,
  OrbitError,
  createLogger,
  exitCodeFor,
  isLoopbackHost,
  loadConfig,
  toOrbitError,
} from './index.js';

describe('version', () => {
  it('matches the root package.json version', () => {
    const rootPackage = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(ORBIT_VERSION).toBe(rootPackage.version);
  });
});

describe('errors', () => {
  it('keeps the code, details and cause', () => {
    const cause = new Error('boom');
    const error = new OrbitError('DATABASE_ERROR', 'db failed', {
      cause,
      details: { table: 'meta' },
    });
    expect(error.code).toBe('DATABASE_ERROR');
    expect(error.details).toEqual({ table: 'meta' });
    expect(error.cause).toBe(cause);
  });

  it('wraps unknown values as INTERNAL', () => {
    expect(toOrbitError('oops').code).toBe('INTERNAL');
    expect(toOrbitError(new Error('x')).message).toBe('x');
  });

  it('returns the same OrbitError instance', () => {
    const error = new OrbitError('NOT_FOUND', 'missing');
    expect(toOrbitError(error)).toBe(error);
  });

  it('maps every code to a distinct non-zero exit code', () => {
    const codes = Object.values(EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => code > 0)).toBe(true);
    expect(exitCodeFor(new OrbitError('CONFIG_INVALID', 'bad'))).toBe(EXIT_CODES.CONFIG_INVALID);
  });
});

describe('loadConfig', () => {
  it('provides safe defaults', () => {
    const config = loadConfig({});
    expect(config).toEqual({
      host: '127.0.0.1',
      port: 4317,
      dbPath: '.orbit/orbit.db',
      logLevel: 'info',
      allowNonLoopback: false,
    });
  });

  it('parses overrides', () => {
    const config = loadConfig({
      ORBIT_PORT: '8080',
      ORBIT_LOG_LEVEL: 'debug',
      ORBIT_DB_PATH: 'x.db',
    });
    expect(config.port).toBe(8080);
    expect(config.logLevel).toBe('debug');
    expect(config.dbPath).toBe('x.db');
  });

  it('rejects an invalid port without echoing the value', () => {
    expect(() => loadConfig({ ORBIT_PORT: '99999' })).toThrowError(/ORBIT_PORT/);
    try {
      loadConfig({ ORBIT_PORT: 'super-secret-value' });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('super-secret-value');
    }
  });

  it('refuses a non-loopback host unless explicitly allowed', () => {
    expect(() => loadConfig({ ORBIT_HOST: '0.0.0.0' })).toThrowError(/loopback/);
    expect(loadConfig({ ORBIT_HOST: '0.0.0.0', ORBIT_ALLOW_NON_LOOPBACK: 'true' }).host).toBe(
      '0.0.0.0',
    );
  });

  it('identifies loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('192.168.1.5')).toBe(false);
  });
});

describe('logger', () => {
  it('writes structured JSON and redacts secrets', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = createLogger({ name: 'test', level: 'info', destination });
    logger.info({ token: 'abc123', nested: { password: 'hunter2' }, visible: 'yes' }, 'hello');
    const record = JSON.parse(lines.join('')) as Record<string, unknown>;
    expect(record['msg']).toBe('hello');
    expect(record['name']).toBe('test');
    expect(record['token']).toBe('[REDACTED]');
    expect((record['nested'] as Record<string, unknown>)['password']).toBe('[REDACTED]');
    expect(record['visible']).toBe('yes');
    expect(lines.join('')).not.toContain('abc123');
    expect(lines.join('')).not.toContain('hunter2');
  });
});
