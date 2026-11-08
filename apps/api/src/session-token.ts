import { randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { OrbitError } from '@orbit/shared';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/;

export interface ApiToken {
  token: string;
  filePath: string | null;
  source: 'environment' | 'file';
}

/**
 * Load an explicit ORBIT_API_TOKEN or create/read a private, persistent workspace token.
 * The token is never logged or included in error messages.
 */
export function getOrCreateApiToken(
  databasePath: string,
  env: Record<string, string | undefined> = process.env,
): ApiToken {
  const configured = env['ORBIT_API_TOKEN'];
  if (configured !== undefined) {
    if (!TOKEN_PATTERN.test(configured)) {
      throw new OrbitError(
        'CONFIG_INVALID',
        'ORBIT_API_TOKEN must contain 40–128 URL-safe characters',
      );
    }
    return { token: configured, filePath: null, source: 'environment' };
  }

  const directory = dirname(resolve(databasePath));
  const filePath = join(directory, 'api.token');
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') chmodSync(directory, 0o700);
    const token = readTokenFile(filePath);
    return { token, filePath, source: 'file' };
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }

  const token = randomBytes(32).toString('base64url');
  try {
    writeFileSync(filePath, `${token}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return { token, filePath, source: 'file' };
  } catch (error) {
    // Another ORBIT process may have created the file between the read and create operations.
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      return { token: readTokenFile(filePath), filePath, source: 'file' };
    }
    throw new OrbitError('DATABASE_ERROR', 'Could not create the local API session token file', {
      cause: error,
    });
  }
}

export function readTokenFile(filePath: string): string {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256) {
    throw new OrbitError('CONFIG_INVALID', 'The local API token path is not a valid regular file');
  }
  if (process.platform !== 'win32') chmodSync(filePath, 0o600);
  const token = readFileSync(filePath, 'utf8').trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new OrbitError(
      'CONFIG_INVALID',
      'The local API token file is invalid; remove it and restart ORBIT',
    );
  }
  return token;
}
