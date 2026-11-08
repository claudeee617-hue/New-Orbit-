import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./orbit-action.mjs', import.meta.url));

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-action-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace');
  const runtime = join(root, 'runtime');
  const cli = join(runtime, 'apps', 'cli', 'dist');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(cli, { recursive: true });

  git(workspace, 'init');
  git(workspace, 'config', 'user.name', 'ORBIT action test');
  git(workspace, 'config', 'user.email', 'orbit-action-test@example.invalid');
  writeFileSync(join(workspace, 'source.txt'), 'base\n');
  git(workspace, 'add', 'source.txt');
  git(workspace, 'commit', '-m', 'base');
  const base = git(workspace, 'rev-parse', 'HEAD');
  writeFileSync(join(workspace, 'source.txt'), 'base\nchanged\n');
  git(workspace, 'add', 'source.txt');
  git(workspace, 'commit', '-m', 'head');
  const head = git(workspace, 'rev-parse', 'HEAD');

  writeFileSync(
    join(cli, 'index.js'),
    `const args = process.argv.slice(2);
if (args[0] === 'witness') {
  process.stdout.write(JSON.stringify({ findings: [] }));
} else if (args[0] === 'verify' && args.includes('--format')) {
  const format = args[args.indexOf('--format') + 1];
  if (format === 'markdown') process.stdout.write('# Fixture verification\\n');
  else if (format === 'sarif') process.stdout.write(JSON.stringify({ version: '2.1.0', runs: [] }));
  else if (format === 'json') process.stdout.write(JSON.stringify({ summary: { status: process.env.ORBIT_TEST_STATUS || 'PASS' } }));
} else {
  process.stderr.write('Unexpected CLI invocation: ' + args.join(' '));
  process.exit(2);
}`,
  );

  const eventPath = join(root, 'event.json');
  writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head } } }));
  const output = join(root, 'github-output.txt');
  const summary = join(root, 'step-summary.md');
  const env = {
    ...process.env,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_WORKSPACE: workspace,
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary,
    ORBIT_RUNTIME_DIR: runtime,
  };
  return { root, workspace, env, output, summary, base, head };
}

function run(f, extra = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: f.workspace,
    env: { ...f.env, ...extra },
    encoding: 'utf8',
  });
}

test('reports NOT_MEASURED when no coverage file is supplied', (t) => {
  const f = fixture(t);
  const result = run(f);
  assert.equal(result.status, 0, result.stderr);
  const output = readFileSync(f.output, 'utf8');
  assert.match(output, /verification-status=NOT_MEASURED/);
  assert.match(readFileSync(f.summary, 'utf8'), /NOT_MEASURED/);
  assert.match(readFileSync(join(f.workspace, '.orbit-action-report.md'), 'utf8'), /path-name check only/);
});

test('writes Markdown, SARIF and measured status when coverage is supplied', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.workspace, 'coverage.info'), 'TN:\n');
  const result = run(f, { INPUT_COVERAGE_FILE: 'coverage.info', INPUT_COVERAGE_FORMAT: 'lcov' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(f.output, 'utf8'), /verification-status=PASS/);
  assert.equal(readFileSync(join(f.workspace, '.orbit-action-report.sarif'), 'utf8'), JSON.stringify({ version: '2.1.0', runs: [] }));
  assert.match(readFileSync(join(f.workspace, '.orbit-action-report.md'), 'utf8'), /Fixture verification/);
});

test('fails when fail-on-uncovered is enabled and status is partial', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.workspace, 'coverage.info'), 'TN:\n');
  const result = run(f, {
    INPUT_COVERAGE_FILE: 'coverage.info',
    INPUT_COVERAGE_FORMAT: 'lcov',
    INPUT_FAIL_ON_UNCOVERED: 'true',
    ORBIT_TEST_STATUS: 'PARTIAL',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /uncovered or incompletely measured/);
});

test('rejects an invalid coverage format', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.workspace, 'coverage.info'), 'TN:\n');
  const result = run(f, { INPUT_COVERAGE_FILE: 'coverage.info', INPUT_COVERAGE_FORMAT: 'unknown' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /coverage-format must be lcov or cobertura/);
});
