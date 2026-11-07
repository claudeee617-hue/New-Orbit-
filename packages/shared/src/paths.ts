import { OrbitError } from './errors.js';

const MAX_PATH_LENGTH = 4096;

/**
 * Normalise a repository-relative path to POSIX form (`a/b/c.ts`).
 *
 * This is a safety boundary for paths that come from untrusted inputs such as coverage reports,
 * diffs and telemetry files. It is deliberately strict: instead of resolving `..` it rejects it,
 * and it rejects absolute paths on every platform (POSIX, Windows drive and UNC).
 *
 * It is a purely lexical check. It does not touch the filesystem, so symlinks are not followed.
 */
export function normalizeRepoRelativePath(input: string): string {
  if (input.length === 0) throw invalid('Path is empty');
  if (input.length > MAX_PATH_LENGTH) throw invalid('Path is too long');
  if (input.includes('\0')) throw invalid('Path contains a NUL byte');

  const slashed = input.replaceAll('\\', '/');
  if (slashed.startsWith('/')) throw invalid('Path must be relative to the repository root');
  if (/^[A-Za-z]:/.test(slashed)) throw invalid('Path must be relative to the repository root');

  const segments: string[] = [];
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') throw invalid('Path must not contain ".." segments');
    segments.push(segment);
  }
  if (segments.length === 0) throw invalid('Path is empty');
  return segments.join('/');
}

/** True when `normalizeRepoRelativePath` would accept the input. */
export function isSafeRepoRelativePath(input: string): boolean {
  try {
    normalizeRepoRelativePath(input);
    return true;
  } catch {
    return false;
  }
}

function invalid(message: string): OrbitError {
  return new OrbitError('INVALID_INPUT', message);
}
