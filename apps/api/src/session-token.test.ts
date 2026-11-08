import { mkdtempSync, readFileSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getOrCreateApiToken, readTokenFile } from './session-token.js';

const directories: string[] = [];

function tempDir(): string {
  const path = mkdtempSync(join(tmpdir(), 'orbit-api-token-'));
  directories.push(path);
  return path;
}

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('API session token', () => {
  it('creates a random token with private file permissions and reuses it', () => {
    const directory = tempDir();
    const dbPath = join(directory, '.orbit', 'orbit.db');
    const first = getOrCreateApiToken(dbPath, {});
    const second = getOrCreateApiToken(dbPath, {});
    expect(first.source).toBe('file');
    expect(first.filePath).toBe(join(directory, '.orbit', 'api.token'));
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{40,128}$/);
    expect(second.token).toBe(first.token);
    expect(readFileSync(first.filePath!, 'utf8').trim()).toBe(first.token);
    if (process.platform !== 'win32') {
      expect(statSync(first.filePath!).mode & 0o777).toBe(0o600);
    }
  });

  it('accepts an explicit environment token without writing a file', () => {
    const result = getOrCreateApiToken(join(tempDir(), 'orbit.db'), {
      ORBIT_API_TOKEN: 'a'.repeat(48),
    });
    expect(result).toEqual({
      token: 'a'.repeat(48),
      filePath: null,
      source: 'environment',
    });
  });

  it('rejects short environment tokens', () => {
    expect(() =>
      getOrCreateApiToken(join(tempDir(), 'orbit.db'), { ORBIT_API_TOKEN: 'short' }),
    ).toThrow(/ORBIT_API_TOKEN/);
  });

  it('rejects a symbolic-link token path', () => {
    const directory = tempDir();
    const secret = join(directory, 'secret');
    const target = join(directory, 'api.token');
    require('node:fs').writeFileSync(secret, 'x'.repeat(48));
    symlinkSync(secret, target);
    expect(() => readTokenFile(target)).toThrow(/regular file/);
  });

  it('rejects malformed token file contents', () => {
    const directory = tempDir();
    const file = join(directory, 'api.token');
    require('node:fs').writeFileSync(file, 'not-a-token');
    expect(() => readTokenFile(file)).toThrow(/invalid/);
  });
});
