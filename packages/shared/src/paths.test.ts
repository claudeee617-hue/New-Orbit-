import { describe, expect, it } from 'vitest';
import { isSafeRepoRelativePath, normalizeRepoRelativePath } from './paths.js';

describe('normalizeRepoRelativePath', () => {
  it.each([
    ['src/index.ts', 'src/index.ts'],
    ['./src/index.ts', 'src/index.ts'],
    ['src//nested///file.ts', 'src/nested/file.ts'],
    ['src\\windows\\file.ts', 'src/windows/file.ts'],
    ['.\\src\\file.ts', 'src/file.ts'],
    ['src/./a/./b.ts', 'src/a/b.ts'],
    ['src/dir/', 'src/dir'],
    ['файл/データ.ts', 'файл/データ.ts'],
    ['.hidden/config', '.hidden/config'],
    ['a..b/c', 'a..b/c'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizeRepoRelativePath(input)).toBe(expected);
  });

  it.each([
    ['empty', ''],
    ['only dots', './.'],
    ['only slashes', '///'],
    ['POSIX absolute', '/etc/passwd'],
    ['Windows drive (backslash)', 'C:\\Windows\\system32'],
    ['Windows drive (slash)', 'C:/Windows'],
    ['Windows drive relative', 'C:file.ts'],
    ['UNC path', '\\\\server\\share\\file'],
    ['parent segment at start', '../secret'],
    ['parent segment in the middle', 'a/../b'],
    ['parent via backslash', 'a\\..\\b'],
    ['NUL byte', 'a\0b'],
    ['too long', 'a/'.repeat(3000)],
  ])('rejects %s', (_name, input) => {
    expect(() => normalizeRepoRelativePath(input)).toThrowError();
    expect(isSafeRepoRelativePath(input)).toBe(false);
  });

  it('is idempotent', () => {
    const once = normalizeRepoRelativePath('.\\a//b\\c.ts');
    expect(normalizeRepoRelativePath(once)).toBe(once);
  });

  it('throws an INVALID_INPUT OrbitError', () => {
    try {
      normalizeRepoRelativePath('../x');
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_INPUT' });
    }
  });
});
