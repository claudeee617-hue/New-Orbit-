import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A tiny deterministic Git repository used by tests and the committed sample report. Dates, names
 * and contents are fixed, so commit SHAs are identical on every machine.
 */
export interface SampleRepo {
  root: string;
  inputsDir: string;
  baseSha: string;
  headSha: string;
}

const BASE: Record<string, string> = {
  'package.json': '{"name":"sample","private":true}\n',
  'docs/DECISIONS/0001-math-module.md':
    '# ADR-0001: Keep arithmetic in src/math.ts\n\nStatus: Accepted\n\nAll arithmetic helpers live in `src/math.ts` so they can be tested in isolation.\n',
  'src/math.ts':
    'export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function div(a: number, b: number): number {\n  return a / b;\n}\n',
  'src/math.test.ts':
    "import { add } from './math';\nimport { test } from 'vitest';\ntest('add', () => { add(1, 2); });\n",
  'src/auth.ts': 'export function login(user: string): boolean {\n  return user.length > 0;\n}\n',
};

const HEAD: Record<string, string> = {
  'src/math.ts':
    "export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function div(a: number, b: number): number {\n  if (b === 0) {\n    throw new Error('division by zero');\n  }\n  return a / b;\n}\nexport function mul(a: number, b: number): number {\n  return a * b;\n}\n",
  'src/auth.ts': 'export function login(user: string): boolean {\n  return user.length > 2;\n}\n',
  '.github/workflows/ci.yml': 'name: ci\non: [push]\njobs: {}\n',
};

/** Hand-written to exercise the LCOV parser; these are not output from a real test run. */
export const SAMPLE_LCOV =
  'TN:\nSF:src/math.ts\nDA:1,3\nDA:2,3\nDA:4,1\nDA:5,1\nDA:6,0\nDA:8,1\nDA:10,0\nDA:11,0\nLF:8\nLH:5\nend_of_record\n';
export const SAMPLE_BASE_LCOV =
  'TN:\nSF:src/math.ts\nDA:1,3\nDA:2,3\nDA:4,1\nDA:5,1\nend_of_record\n';
export const SAMPLE_JUNIT =
  '<?xml version="1.0"?>\n<testsuites>\n  <testsuite name="math">\n    <testcase classname="math" name="add"/>\n    <testcase classname="math" name="div by zero"><failure message="expected to throw"/></testcase>\n  </testsuite>\n</testsuites>\n';
export const SAMPLE_BASE_JUNIT =
  '<?xml version="1.0"?>\n<testsuites>\n  <testsuite name="math">\n    <testcase classname="math" name="add"/>\n    <testcase classname="math" name="div by zero"/>\n    <testcase classname="math" name="legacy"/>\n  </testsuite>\n</testsuites>\n';
export const SAMPLE_BUILD = '{"status":"success","command":"pnpm build"}\n';

function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function git(root: string, date: string, args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Sample Author',
      '-c',
      'user.email=sample@example.test',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.autocrlf=false',
      '-c',
      'core.safecrlf=false',
      ...args,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
        GIT_CONFIG_NOSYSTEM: '1',
      },
    },
  ).trim();
}

export function createSampleRepo(): SampleRepo {
  const parent = mkdtempSync(join(tmpdir(), 'orbit-witness-'));
  const root = join(parent, 'sample-repo');
  const inputsDir = join(parent, 'inputs');
  mkdirSync(root);
  mkdirSync(inputsDir);
  git(root, '2026-01-01T00:00:00Z', ['init', '-q', '-b', 'main']);
  write(root, BASE);
  git(root, '2026-01-01T00:00:00Z', ['add', '.']);
  git(root, '2026-01-01T00:00:00Z', ['commit', '-q', '-m', 'base']);
  const baseSha = git(root, '2026-01-01T00:00:00Z', ['rev-parse', 'HEAD']);
  git(root, '2026-01-02T00:00:00Z', ['checkout', '-q', '-b', 'feature']);
  write(root, HEAD);
  git(root, '2026-01-02T00:00:00Z', ['add', '.']);
  git(root, '2026-01-02T00:00:00Z', ['commit', '-q', '-m', 'guard division, add mul']);
  const headSha = git(root, '2026-01-02T00:00:00Z', ['rev-parse', 'HEAD']);
  write(inputsDir, {
    'lcov.info': SAMPLE_LCOV,
    'base-lcov.info': SAMPLE_BASE_LCOV,
    'junit.xml': SAMPLE_JUNIT,
    'base-junit.xml': SAMPLE_BASE_JUNIT,
    'build.json': SAMPLE_BUILD,
  });
  return { root, inputsDir, baseSha, headSha };
}
