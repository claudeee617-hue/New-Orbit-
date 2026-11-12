import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

function requiredSha(value, label) {
  if (!/^[0-9a-f]{7,64}$/i.test(value || '')) {
    throw new Error(
      'Missing or invalid ' +
        label +
        '. Set the action input or run this action on a pull_request event.',
    );
  }
  return value;
}

// GitHub rejects issue comments above 65,536 characters; stay well below that.
const MAX_REPORT_CHARS = 60000;

/** Neutralise @mentions so a crafted file name in a PR cannot ping users or teams. */
function neutraliseMentions(text) {
  return text.replace(/@(?=[A-Za-z0-9_-])/g, '@\u200b');
}

/** Render an untrusted value (such as a file path from the PR) as inert inline text. */
function inert(value) {
  const flat = String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/`/g, "'")
    .replace(/</g, '&lt;');
  return '`' + neutraliseMentions(flat) + '`';
}

function limitReport(text) {
  if (text.length <= MAX_REPORT_CHARS) return text;
  return (
    text.slice(0, MAX_REPORT_CHARS) +
    '\n\n> **Report truncated.** The full output exceeded ' +
    MAX_REPORT_CHARS +
    ' characters, so the remainder is omitted. Re-run ORBIT locally for the complete report.\n'
  );
}

function insideWorkspace(workspace, target) {
  const rel = relative(workspace, target);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function runCli(args) {
  const runtimeDir = process.env.ORBIT_RUNTIME_DIR;
  if (!runtimeDir) throw new Error('ORBIT_RUNTIME_DIR is required');
  return execFileSync(process.execPath, [join(runtimeDir, 'apps/cli/dist/index.js'), ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

function writeOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (output) appendFileSync(output, name + '=' + value + '\n');
}

function writeSummary(markdown) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, markdown + '\n');
}

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const base = requiredSha(process.env.INPUT_BASE_SHA || event.pull_request?.base?.sha, 'base SHA');
const head = requiredSha(
  process.env.INPUT_HEAD_SHA || event.pull_request?.head?.sha || process.env.GITHUB_SHA,
  'head SHA',
);
const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
const diffPath = resolve(workspace, '.orbit-action.diff');
const reportPath = resolve(workspace, '.orbit-action-report.md');
const sarifPath = resolve(workspace, '.orbit-action-report.sarif');

mkdirSync(dirname(diffPath), { recursive: true });
let diff;
try {
  diff = execFileSync('git', ['diff', '--no-ext-diff', '--unified=0', base + '...' + head, '--'], {
    cwd: workspace,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (error) {
  const detail = String(error?.stderr || error?.message || error)
    .trim()
    .split('\n')[0];
  throw new Error(
    'Could not compute the diff between base and head (' +
      detail +
      '). Check out the repository with fetch-depth: 0 so both commits are available.',
    { cause: error },
  );
}
writeFileSync(diffPath, diff, 'utf8');

let status = 'NOT_MEASURED';
let markdown =
  '# ORBIT WITNESS — Pull request verification\n\n' +
  '**Coverage status:** NOT_MEASURED\n\n' +
  'No coverage report was supplied. ORBIT does not interpret missing coverage as 0%.\n';
const coverageFile = process.env.INPUT_COVERAGE_FILE;

if (coverageFile) {
  const format = process.env.INPUT_COVERAGE_FORMAT || 'lcov';
  if (!['lcov', 'cobertura'].includes(format)) {
    throw new Error('coverage-format must be lcov or cobertura');
  }
  const option = format === 'lcov' ? '--lcov' : '--cobertura';
  const coveragePath = resolve(workspace, coverageFile);
  if (!insideWorkspace(workspace, coveragePath)) {
    throw new Error('coverage-file must be a path inside the workspace.');
  }
  // The checked-out PR head is untrusted: the coverage path may be a symlink the PR author
  // committed. Refuse symlinks and re-check containment on the real path so a link cannot make
  // the Action read runner files outside the workspace.
  let coverageStat;
  try {
    coverageStat = lstatSync(coveragePath);
  } catch {
    throw new Error(
      'coverage-file was set but the file does not exist: ' +
        coverageFile +
        '. ORBIT will not treat a missing report as 0% coverage.',
    );
  }
  if (coverageStat.isSymbolicLink()) {
    throw new Error('coverage-file must not be a symbolic link.');
  }
  if (!coverageStat.isFile()) throw new Error('coverage-file must be a regular file.');
  if (!insideWorkspace(realpathSync(workspace), realpathSync(coveragePath))) {
    throw new Error('coverage-file must be a path inside the workspace.');
  }
  markdown = runCli(['verify', diffPath, option, coveragePath, '--format', 'markdown']);
  const sarif = runCli(['verify', diffPath, option, coveragePath, '--format', 'sarif']);
  const json = runCli(['verify', diffPath, option, coveragePath, '--format', 'json']);
  status = JSON.parse(json).summary.status;
  writeFileSync(sarifPath, sarif, 'utf8');
}

const pathReport = JSON.parse(runCli(['witness', 'sensitive-paths', diffPath]));
const findings = pathReport.findings || [];
markdown += '\n## Sensitive-path review\n\n';
markdown += findings.length
  ? findings
      .map(
        (item) =>
          '- **' +
          String(item.severity).toUpperCase() +
          ' · ' +
          inert(item.rule) +
          '** ' +
          inert(item.path) +
          ': ' +
          inert(item.message),
      )
      .join('\n')
  : '- No sensitive-path filename findings. This is a path-name check only; it does not inspect file contents.';

markdown +=
  '\n\n## Scope and limitations\n\n' +
  '- ORBIT analyses the supplied diff and optional coverage artifact; it does not run the pull request source code.\n' +
  '- Coverage evidence is only as current and trustworthy as the supplied report.\n' +
  '- A passing coverage result is not a correctness, security or merge approval.\n' +
  '- Missing coverage is NOT_MEASURED, never 0%.\n' +
  '- Sensitive-path checks inspect filenames only, not file contents.\n';

markdown = limitReport(neutraliseMentions(markdown));
writeFileSync(reportPath, markdown, 'utf8');
writeSummary(markdown);
writeOutput('report-path', reportPath);
writeOutput('sarif-path', coverageFile ? sarifPath : '');
writeOutput('verification-status', status);

if (process.env.INPUT_FAIL_ON_UNCOVERED === 'true' && ['PARTIAL', 'INCOMPLETE'].includes(status)) {
  throw new Error(
    'ORBIT reports uncovered or incompletely measured changed lines (PARTIAL). Review the generated report.',
  );
}
