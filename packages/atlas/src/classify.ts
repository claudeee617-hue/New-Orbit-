import { posix } from 'node:path';
import type { FileCategory, Language } from './types.js';

const EXTENSION_LANGUAGE: Readonly<Record<string, Language>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',
};

/** `.h` is ambiguous between C and C++; it is treated as C unless a C++ file includes it. */
export function detectLanguage(path: string): Language | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith('.d.ts')) return 'typescript';
  return EXTENSION_LANGUAGE[posix.extname(lower)];
}

export const DEFAULT_EXCLUDES: readonly string[] = [
  '**/.git/**',
  '**/node_modules/**',
  '**/.pnpm-store/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/target/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/.mypy_cache/**',
  '**/.pytest_cache/**',
  '**/.tox/**',
  '**/.gradle/**',
  '**/.idea/**',
  '**/.vscode/**',
  '**/.orbit/**',
  '**/*.min.js',
];

const VENDOR_DIRS = new Set(['vendor', 'third_party', 'third-party', 'external', 'extern', 'deps']);
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', '__mocks__']);
const DOC_DIRS = new Set(['docs', 'doc', 'documentation']);
const GENERATED_HINTS = ['/generated/', '/__generated__/', '/gen/'];
const ASSET_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.css',
  '.scss',
]);
const DOC_EXT = new Set(['.md', '.mdx', '.rst', '.txt', '.adoc']);
const CONFIG_EXT = new Set([
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.env',
  '.xml',
  '.gradle',
  '.properties',
]);
const BUILD_NAMES = new Set([
  'makefile',
  'cmakelists.txt',
  'dockerfile',
  'build.gradle',
  'pom.xml',
  'package.json',
  'pyproject.toml',
  'setup.py',
  'turbo.json',
]);

export function isTestPath(path: string): boolean {
  const lower = path.toLowerCase();
  const segments = lower.split('/');
  const base = segments[segments.length - 1] ?? '';
  if (segments.slice(0, -1).some((segment) => TEST_DIRS.has(segment))) return true;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) return true;
  if (/^test_.*\.py$/.test(base) || /_test\.py$/.test(base) || base === 'conftest.py') return true;
  if (/(^|[^a-z])tests?\.java$/.test(base) || /(test|tests|it)\.java$/.test(base)) return true;
  if (/_test\.(c|cc|cpp|cxx)$/.test(base) || /^test_.*\.(c|cc|cpp|cxx)$/.test(base)) return true;
  return false;
}

export function classifyFile(path: string): FileCategory {
  const lower = path.toLowerCase();
  const segments = lower.split('/');
  const base = segments[segments.length - 1] ?? '';
  const ext = posix.extname(base);
  const dirs = segments.slice(0, -1);
  if (dirs.some((d) => VENDOR_DIRS.has(d))) return 'vendor';
  if (
    GENERATED_HINTS.some((hint) => `/${lower}`.includes(hint)) ||
    /\.(generated|g)\.[a-z]+$/.test(base) ||
    base.endsWith('_pb2.py') ||
    base.endsWith('.pb.go')
  )
    return 'generated';
  if (detectLanguage(path) !== undefined) return isTestPath(path) ? 'test' : 'source';
  if (BUILD_NAMES.has(base) || /^requirements[^/]*\.txt$/.test(base)) return 'build';
  if (dirs.some((d) => DOC_DIRS.has(d)) || DOC_EXT.has(ext)) return 'docs';
  if (CONFIG_EXT.has(ext) || base.startsWith('.') || base.endsWith('rc')) return 'config';
  if (ASSET_EXT.has(ext)) return 'asset';
  return 'other';
}

/** Convert a glob (`**`, `*`, `?`) to an anchored RegExp over POSIX relative paths. */
export function globToRegExp(glob: string): RegExp {
  let pattern = glob.replace(/\\/g, '/');
  if (pattern.endsWith('/')) pattern += '**';
  if (!pattern.includes('/')) pattern = `**/${pattern}`;
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i] as string;
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        const slashAfter = pattern[i + 2] === '/';
        out += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else out += '[^/]*';
    } else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function compileGlobs(globs: readonly string[]): (path: string) => boolean {
  const patterns = globs.map(globToRegExp);
  return (path) => patterns.some((re) => re.test(path));
}
