// Behavioural tests for orbit-action.mjs. They need a built ORBIT runtime:
//   ORBIT_RUNTIME_DIR=/path/to/built/orbit node --test .github/scripts/orbit-action.test.mjs
// Without ORBIT_RUNTIME_DIR the suite is skipped (it is not a substitute for CI).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const runtime = process.env.ORBIT_RUNTIME_DIR;
const script = resolve(dirname(fileURLToPath(import.meta.url)), 'orbit-action.mjs');
const skip = runtime ? false : 'ORBIT_RUNTIME_DIR is not set';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-action-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.invalid');
  git(dir, 'config', 'user.name', 'test');
  writeFileSync(join(dir, 'a.txt'), 'base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'head');
  return { dir, base, head: git(dir, 'rev-parse', 'HEAD') };
}

function run(repo, extraEnv = {}) {
  const summary = join(repo.dir, 'summary.md');
  const output = join(repo.dir, 'output.txt');
  writeFileSync(summary, '');
  writeFileSync(output, '');
  writeFileSync(join(repo.dir, 'event.json'), '{}');
  const result = spawnSync(process.execPath, [script], {
    cwd: repo.dir,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      ORBIT_RUNTIME_DIR: runtime,
      GITHUB_WORKSPACE: repo.dir,
      GITHUB_EVENT_PATH: join(repo.dir, 'event.json'),
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_OUTPUT: output,
      INPUT_BASE_SHA: repo.base,
      INPUT_HEAD_SHA: repo.head,
      ...extraEnv,
    },
  });
  const report = (() => {
    try {
      return readFileSync(join(repo.dir, '.orbit-action-report.md'), 'utf8');
    } catch {
      return '';
    }
  })();
  return { ...result, report, outputs: readFileSync(output, 'utf8') };
}

test('without coverage the status is NOT_MEASURED and the report says so', { skip }, () => {
  const repo = makeRepo({ 'src/x.ts': 'export const x = 1;\n' });
  try {
    const r = run(repo);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.outputs, /verification-status=NOT_MEASURED/);
    assert.match(r.report, /does not interpret missing coverage as 0%/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('a coverage-file that does not exist fails clearly instead of reporting 0%', { skip }, () => {
  const repo = makeRepo({ 'src/x.ts': 'export const x = 1;\n' });
  try {
    const r = run(repo, { INPUT_COVERAGE_FILE: 'missing.lcov' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /does not exist/);
    assert.match(r.stderr, /0% coverage/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('a coverage-file outside the workspace is rejected', { skip }, () => {
  const repo = makeRepo({ 'src/x.ts': 'export const x = 1;\n' });
  try {
    const r = run(repo, { INPUT_COVERAGE_FILE: '../../etc/passwd' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /inside the workspace/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('an unknown base commit explains the fetch-depth requirement', { skip }, () => {
  const repo = makeRepo({ 'src/x.ts': 'export const x = 1;\n' });
  try {
    const r = run(repo, { INPUT_BASE_SHA: 'deadbeefdeadbeef' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /fetch-depth: 0/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('an unsupported coverage-format is rejected', { skip }, () => {
  const repo = makeRepo({ 'src/x.ts': 'export const x = 1;\n', 'c.lcov': 'TN:\nend_of_record\n' });
  try {
    const r = run(repo, { INPUT_COVERAGE_FILE: 'c.lcov', INPUT_COVERAGE_FORMAT: 'jacoco' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /lcov or cobertura/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('file names from the PR cannot mention users or teams', { skip }, () => {
  const repo = makeRepo({ 'deploy/@octocat/.env': 'KEY=value\n' });
  try {
    const r = run(repo);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.report, /Sensitive-path review/);
    assert.doesNotMatch(r.report, /@octocat/);
    assert.match(r.report, /@\u200boctocat/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('very large reports are truncated below the GitHub comment limit', { skip }, () => {
  const files = {};
  for (let i = 0; i < 1500; i += 1) files[`service-${i}/nested/config/.env`] = 'KEY=value\n';
  const repo = makeRepo(files);
  try {
    const r = run(repo);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.report.length < 65000, `report was ${r.report.length} characters`);
    assert.match(r.report, /Report truncated/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});
