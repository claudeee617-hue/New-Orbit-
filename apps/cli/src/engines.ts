import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import type { Command } from 'commander';
import {
  compareEnvironments,
  createChangePassport,
  inspectEnvironment,
  parseCobertura,
  parseJunitXml,
  parseLcov,
  parseTelemetry,
  summarizeTestHistory,
  verifyChangedLineCoverage,
  type TelemetrySession,
} from '@orbit/atlas';
import type { CliIo } from './program.js';

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.orbit',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.next',
  'vendor',
]);
const CONFIG_NAMES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'poetry.lock',
  'uv.lock',
  'Cargo.lock',
  'go.sum',
  'Pipfile.lock',
  '.nvmrc',
  '.node-version',
  '.python-version',
  'runtime.txt',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'pom.xml',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.env.example',
  '.env.sample',
  'flake.nix',
]);

async function readText(path: string, maxBytes = 10 * 1024 * 1024): Promise<string> {
  const value = await readFile(path, 'utf8');
  if (Buffer.byteLength(value, 'utf8') > maxBytes)
    throw new Error(`${path} exceeds the ${maxBytes} byte limit`);
  return value;
}

async function writeOutput(path: string | undefined, content: string): Promise<void> {
  if (!path) return;
  await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
}

function markdownVerification(report: ReturnType<typeof verifyChangedLineCoverage>): string {
  const rows = report.files.map(
    (file) =>
      `| ${file.path} | ${file.coverage.changedLines} | ${file.coverage.measuredLines} | ${file.coverage.coveredLines} | ${file.coverage.percentage === null ? 'n/a' : `${file.coverage.percentage}%`} | ${file.coverage.status} |`,
  );
  return [
    '# ORBIT WITNESS — Changed-line coverage',
    '',
    `**Status:** ${report.summary.status}`,
    `**Changed lines:** ${report.summary.changedLines} · **Measured:** ${report.summary.measuredLines} · **Covered:** ${report.summary.coveredLines} · **Coverage:** ${report.summary.percentage === null ? 'not measured' : `${report.summary.percentage}%`}`,
    '',
    '| File | Changed | Measured | Covered | Coverage | Status |',
    '|---|---:|---:|---:|---:|---|',
    ...rows,
    '',
    '## Findings',
    ...(report.findings.length
      ? report.findings.map((item) => `- **${item.rule}** ${item.path}: ${item.message}`)
      : ['- No coverage findings.']),
    '',
    '## Limitations',
    ...report.limitations.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

async function inspectConfigFiles(rootInput: string): Promise<Record<string, string>> {
  const root = await realpath(resolve(rootInput));
  const collected: Record<string, string> = {};
  let count = 0;
  const maxFiles = 500;
  const maxTotalBytes = 8 * 1024 * 1024;
  let totalBytes = 0;

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 12 || count >= maxFiles || totalBytes >= maxTotalBytes) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (count >= maxFiles || totalBytes >= maxTotalBytes) break;
      if (entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile() || !CONFIG_NAMES.has(entry.name)) continue;
      // Only read files whose real path remains under the selected repository root.
      const actual = await realpath(absolute);
      const rel = relative(root, actual);
      if (!rel || rel.startsWith('..' + sep) || rel === '..') continue;
      const info = await lstat(actual);
      if (info.size > 2 * 1024 * 1024 || totalBytes + info.size > maxTotalBytes) continue;
      const content = await readFile(actual, 'utf8');
      collected[rel.split(sep).join('/')] = content;
      count += 1;
      totalBytes += info.size;
    }
  }

  await walk(root, 0);
  return collected;
}

export function attachEngineCommands(program: Command, io: CliIo): void {
  program
    .command('verify <diff-file>')
    .description('verify added diff lines against an LCOV or Cobertura coverage report')
    .option('--lcov <file>', 'LCOV coverage report')
    .option('--cobertura <file>', 'Cobertura XML report')
    .option('--format <format>', 'json or markdown', 'json')
    .option('--out <file>', 'write report to a new file (refuses to overwrite)')
    .action(
      async (
        diffFile: string,
        options: { lcov?: string; cobertura?: string; format: string; out?: string },
      ) => {
        if (Boolean(options.lcov) === Boolean(options.cobertura)) {
          throw new Error('provide exactly one of --lcov or --cobertura');
        }
        if (options.format !== 'json' && options.format !== 'markdown')
          throw new Error('--format must be json or markdown');
        const diff = await readText(diffFile);
        const coverageText = await readText(options.lcov ?? options.cobertura!);
        const coverage = options.lcov ? parseLcov(coverageText) : parseCobertura(coverageText);
        const report = verifyChangedLineCoverage(diff, coverage);
        const output =
          options.format === 'markdown'
            ? markdownVerification(report)
            : `${JSON.stringify(report, null, 2)}\n`;
        await writeOutput(options.out, output);
        if (options.out)
          io.stdout(`Wrote ${options.format} verification report to ${options.out}\n`);
        else io.stdout(output);
      },
    );

  const flare = program
    .command('flare')
    .description('analyse CI test reports and historical test reliability');
  flare
    .command('summarize <junit-file>')
    .description('parse a JUnit XML report and summarise supplied test outcomes')
    .option('--min-samples <n>', 'minimum executions before classification', '8')
    .option('--out <file>', 'write JSON report to a new file')
    .action(async (file: string, options: { minSamples: string; out?: string }) => {
      const minSamples = Number(options.minSamples);
      if (!Number.isInteger(minSamples) || minSamples < 2 || minSamples > 10000)
        throw new Error('--min-samples must be an integer from 2 to 10000');
      const testCases = parseJunitXml(await readText(file));
      const summaries = summarizeTestHistory(testCases, { minSamples });
      const report = {
        schemaVersion: 1,
        source: file,
        executionsInReport: testCases.length,
        note: 'A single report is not historical evidence. suspected-flaky requires repeated executions; import multiple runs to build useful history.',
        tests: summaries,
      };
      const output = `${JSON.stringify(report, null, 2)}\n`;
      await writeOutput(options.out, output);
      io.stdout(options.out ? `Wrote test report to ${options.out}\n` : output);
    });

  const capsule = program
    .command('capsule')
    .description('inspect and compare declared development environments');
  capsule
    .command('inspect <repository>')
    .description('fingerprint known environment manifests without reading .env secret files')
    .option('--out <file>', 'write snapshot to a new JSON file')
    .action(async (repository: string, options: { out?: string }) => {
      const files = await inspectConfigFiles(repository);
      const snapshot = inspectEnvironment(files);
      const report = {
        ...snapshot,
        inspectedFiles: Object.keys(files).sort(),
        inspectedFileCount: Object.keys(files).length,
      };
      const output = `${JSON.stringify(report, null, 2)}\n`;
      await writeOutput(options.out, output);
      io.stdout(options.out ? `Wrote environment snapshot to ${options.out}\n` : output);
    });

  capsule
    .command('compare <before-json> <after-json>')
    .description('compare two previously exported environment snapshots')
    .action(async (beforePath: string, afterPath: string) => {
      const before = JSON.parse(await readText(beforePath)) as Parameters<
        typeof compareEnvironments
      >[0];
      const after = JSON.parse(await readText(afterPath)) as Parameters<
        typeof compareEnvironments
      >[1];
      io.stdout(
        `${JSON.stringify({ differences: compareEnvironments(before, after) }, null, 2)}\n`,
      );
    });

  const device = program
    .command('device')
    .description('parse or replay recorded embedded telemetry (read-only)');
  device
    .command('replay <log-file>')
    .description('parse a recorded JSON, NDJSON, CSV or key-value telemetry file')
    .option('--format <format>', 'json, ndjson, csv or key-value')
    .option('--out <file>', 'write parsed session to a new JSON file')
    .action(
      async (file: string, options: { format?: TelemetrySession['format']; out?: string }) => {
        const allowed: TelemetrySession['format'][] = ['json', 'ndjson', 'csv', 'key-value'];
        if (options.format && !allowed.includes(options.format))
          throw new Error('--format must be json, ndjson, csv or key-value');
        const session = parseTelemetry(await readText(file), options.format);
        const report = { ...session, source: basename(file), mode: 'read-only-replay' };
        const output = `${JSON.stringify(report, null, 2)}\n`;
        await writeOutput(options.out, output);
        io.stdout(options.out ? `Wrote telemetry session to ${options.out}\n` : output);
      },
    );

  const passport = program
    .command('passport')
    .description('assemble an evidence-backed Change Passport');
  passport
    .command('create <input-json>')
    .description('create a canonical passport from a JSON object containing supplied evidence')
    .option('--out <file>', 'write passport to a new JSON file')
    .option('--repository <owner/name>', 'override repository identifier')
    .option('--commit <sha>', 'override commit SHA')
    .action(
      async (file: string, options: { out?: string; repository?: string; commit?: string }) => {
        const input = JSON.parse(await readText(file, 2 * 1024 * 1024)) as Record<string, unknown>;
        const passportInput = {
          ...input,
          ...(options.repository && { repository: options.repository }),
          ...(options.commit && { commitSha: options.commit }),
        } as Parameters<typeof createChangePassport>[0];
        const passport = createChangePassport(passportInput);
        const output = `${JSON.stringify(passport, null, 2)}\n`;
        await writeOutput(options.out, output);
        io.stdout(options.out ? `Wrote Change Passport to ${options.out}\n` : output);
      },
    );
}
