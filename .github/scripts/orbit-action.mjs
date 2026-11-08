import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

function requiredSha(value, label) {
  if (!/^[0-9a-f]{7,64}$/i.test(value ?? '')) {
    throw new Error(`Missing or invalid ${label}. Set the action input or run this action on a pull_request event.`);
  }
  return value;
}
function runCli(args) {
  return execFileSync(process.execPath, ['apps/cli/dist/index.js', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
}
function writeOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (output) appendFileSync(output, `${name}=${value}\n`);
}
function writeSummary(markdown) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, markdown + '\n');
}

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const base = requiredSha(process.env.INPUT_BASE_SHA || event.pull_request?.base?.sha, 'base SHA');
const head = requiredSha(process.env.INPUT_HEAD_SHA || event.pull_request?.head?.sha || process.env.GITHUB_SHA, 'head SHA');
const diffPath = resolve('.orbit-action.diff');
const reportPath = resolve('.orbit-action-report.md');
const sarifPath = resolve('.orbit-action-report.sarif');
mkdirSync(dirname(diffPath), { recursive: true });
const diff = execFileSync('git', ['diff', '--no-ext-diff', '--unified=0', `${base}...${head}`, '--'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
writeFileSync(diffPath, diff, { flag: 'w' });

let status = 'NOT_MEASURED';
let markdown = '# ORBIT WITNESS — Pull request verification\n\n**Coverage status:** NOT_MEASURED\n\nNo coverage report was supplied. ORBIT does not interpret missing coverage as 0%.\n';
let sarif = '';
const coverageFile = process.env.INPUT_COVERAGE_FILE;
if (coverageFile) {
  const format = process.env.INPUT_COVERAGE_FORMAT || 'lcov';
  if (!['lcov', 'cobertura'].includes(format)) throw new Error('coverage-format must be lcov or cobertura');
  const option = format === 'lcov' ? '--lcov' : '--cobertura';
  markdown = runCli(['verify', diffPath, option, resolve(coverageFile), '--format', 'markdown']);
  sarif = runCli(['verify', diffPath, option, resolve(coverageFile), '--format', 'sarif']);
  const json = runCli(['verify', diffPath, option, resolve(coverageFile), '--format', 'json']);
  status = JSON.parse(json).summary.status;
  writeFileSync(sarifPath, sarif, 'utf8');
}

const pathReport = JSON.parse(runCli(['witness', 'sensitive-paths', diffPath]));
const findings = pathReport.findings ?? [];
markdown += '\n## Sensitive-path review\n\n';
markdown += findings.length
  ? findings.map((item) => `- **${item.severity.toUpperCase()} · ${item.rule}** ${item.path}: ${item.message}`).join('\n')
  : '- No sensitive-path filename findings. This is a path-name check only; it does not inspect file contents.';
markdown += '\n\n## Scope and limitations\n\n- ORBIT analyses the supplied diff and optional coverage artifact; it does not run the pull request source code.\n- Coverage evidence is only as current and trustworthy as the supplied report.\n- A passing coverage result is not a correctness, security or merge approval.\n- Missing coverage is NOT_MEASURED, never 0%.\n- Sensitive-path checks inspect filenames only, not file contents.\n';
writeFileSync(reportPath, markdown, 'utf8');
writeSummary(markdown);
writeOutput('report-path', reportPath);
writeOutput('sarif-path', coverageFile ? sarifPath : '');
writeOutput('verification-status', status);

if (process.env.INPUT_FAIL_ON_UNCOVERED === 'true' && status === 'PARTIAL') {
  throw new Error('ORBIT reports uncovered or incompletely measured changed lines (PARTIAL). Review the generated report.');
}
