import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import type { Command } from 'commander';
import {
  analyseTestHistory,
  compareCoverageSnapshots,
  findSensitivePathFindings,
  inspectExtendedEnvironment,
  parseCobertura,
  parseGoTestJson,
  parseJestJsonReport,
  parseJunitXml,
  parseLcov,
  parsePytestJsonReport,
  renderWitnessSarif,
  verifyChangedLineCoverage,
} from '@orbit/atlas';
import type { CliIo } from './program.js';

const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const IGNORED_DIRS = new Set([
  '.git', 'node_modules', '.orbit', 'dist', 'build', 'coverage',
  '.turbo', '.next', 'vendor', '.venv', 'venv', '__pycache__',
]);
const MANIFEST_NAMES = new Set([
  'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'package-lock.json',
  'yarn.lock', 'bun.lock', 'bun.lockb', '.nvmrc', '.node-version',
  '.python-version', 'runtime.txt', 'go.mod', 'go.sum', 'go.work',
  'Cargo.toml', 'Cargo.lock', 'rust-toolchain', 'rust-toolchain.toml',
  'pyproject.toml', 'requirements.txt', 'requirements-dev.txt',
  'poetry.lock', 'uv.lock', 'Pipfile.lock', '.tool-versions',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.env.example', '.env.sample', 'turbo.json', 'nx.json', 'lerna.json',
  'devcontainer.json', 'flake.nix',
]);

async function readBounded(path: string): Promise<string> {
  const value = await readFile(path, 'utf8');
  if (Buffer.byteLength(value, 'utf8') > MAX_REPORT_BYTES) {
    throw new Error(`${path} exceeds the 10 MiB report limit`);
  }
  return value;
}

async function writeNewFile(path: string | undefined, content: string): Promise<void> {
  if (!path) return;
  await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
}

function formatChoice(value: string, allowed: readonly string[], name: string): string {
  if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

async function readManifestSet(rootInput: string): Promise<Record<string, string>> {
  const root = await realpath(resolve(rootInput));
  const result: Record<string, string> = {};
  let files = 0;
  let totalBytes = 0;
  const maxFiles = 1000;
  const maxTotalBytes = 16 * 1024 * 1024;

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 12 || files >= maxFiles || totalBytes >= maxTotalBytes) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files >= maxFiles || totalBytes >= maxTotalBytes) break;
      if (entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(absolute, depth + 1);
        continue;
      }
      const name = entry.name;
      const isDevcontainer = name === 'devcontainer.json' && absolute.split(sep).includes('.devcontainer');
      if (!entry.isFile() || (!MANIFEST_NAMES.has(name) && !isDevcontainer)) continue;
      const actual = await realpath(absolute);
      const rel = relative(root, actual);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) continue;
      const info = await lstat(actual);
      if (info.size > 2 * 1024 * 1024 || totalBytes + info.size > maxTotalBytes) continue;
      const content = await readFile(actual, 'utf8');
      result[rel.split(sep).join('/')] = content;
      files += 1;
      totalBytes += info.size;
    }
  }

  await walk(root, 0);
  return result;
}

export function attachAdvancedEngineCommands(program: Command, io: CliIo): void {
  const witness = program.command('witness').description('advanced change verification and coverage regression');

  witness
    .command('coverage-compare <before-report> <after-report>')
    .description('compare baseline and candidate LCOV or Cobertura coverage reports')
    .requiredOption('--format <format>', 'lcov or cobertura')
    .option('--out <file>', 'write JSON report to a new file (refuses to overwrite)')
    .action(async (beforePath: string, afterPath: string, options: { format: string; out?: string }) => {
      const format = formatChoice(options.format, ['lcov', 'cobertura'], '--format');
      const parse = format === 'lcov' ? parseLcov : parseCobertura;
      const before = parse(await readBounded(beforePath));
      const after = parse(await readBounded(afterPath));
      const report = {
        schemaVersion: 1,
        format,
        comparisons: compareCoverageSnapshots(before, after),
        limitations: [
          'Coverage percentages compare the supplied line maps; changed-file scope and test attribution are not inferred.',
          'A percentage regression is a review signal, not proof of a correctness regression.',
          'Paths are matched exactly; missing measurements are NOT_COMPARABLE.',
        ],
      };
      const output = `${JSON.stringify(report, null, 2)}\n`;
      await writeNewFile(options.out, output);
      io.stdout(options.out ? `Wrote WITNESS regression report to ${options.out}\n` : output);
    });

  witness
    .command('sensitive-paths <diff-file>')
    .description('flag potentially sensitive filenames in a diff without reading their contents')
    .option('--out <file>', 'write JSON findings to a new file')
    .action(async (diffFile: string, options: { out?: string }) => {
      const findings = findSensitivePathFindings(await readBounded(diffFile));
      const report = {
        schemaVersion: 1,
        scope: 'path-name-only',
        findings,
        limitations: ['This checks paths only; it does not inspect file contents or prove that a credential is present.'],
      };
      const output = `${JSON.stringify(report, null, 2)}\n`;
      await writeNewFile(options.out, output);
      io.stdout(options.out ? `Wrote path findings to ${options.out}\n` : output);
    });

  const flare = program.command('flare');
  flare
    .command('analyse <report-files...>')
    .description('combine JUnit, pytest, Jest or Go test reports for reliability, failure and duration analysis')
    .requiredOption('--format <format>', 'junit, pytest-json, jest-json or go-json')
    .option('--min-samples <n>', 'minimum executions before classification', '8')
    .option('--min-flips <n>', 'minimum pass/fail flips before suspected-flaky', '3')
    .option('--out <file>', 'write JSON report to a new file')
    .action(async (reportFiles: string[], options: { format: string; minSamples: string; minFlips: string; out?: string }) => {
      const format = formatChoice(options.format, ['junit', 'pytest-json', 'jest-json', 'go-json'], '--format');
      const minSamples = Number(options.minSamples);
      const minFlips = Number(options.minFlips);
      if (!Number.isInteger(minSamples) || minSamples < 2 || minSamples > 10000) throw new Error('--min-samples must be between 2 and 10000');
      if (!Number.isInteger(minFlips) || minFlips < 1 || minFlips > 10000) throw new Error('--min-flips must be between 1 and 10000');
      if (reportFiles.length > 100) throw new Error('at most 100 report files can be analysed at once');
      const parser = format === 'junit' ? parseJunitXml
        : format === 'pytest-json' ? parsePytestJsonReport
          : format === 'jest-json' ? parseJestJsonReport : parseGoTestJson;
      const history = [];
      for (const file of reportFiles) history.push(...parser(await readBounded(file)));
      const reliability = analyseTestHistory(history, { minSamples, minFlips });
      const report = {
        schemaVersion: 1,
        format,
        sourceFiles: reportFiles,
        executionsInReports: history.length,
        ...reliability,
        note: 'Pass multiple time-ordered CI reports to build history. A single report cannot establish historical flakiness.',
      };
      const output = `${JSON.stringify(report, null, 2)}\n`;
      await writeNewFile(options.out, output);
      io.stdout(options.out ? `Wrote FLARE reliability report to ${options.out}\n` : output);
    });

  const capsule = program.command('capsule');
  capsule
    .command('inspect-extended <repository>')
    .description('inspect polyglot toolchain, dependency, container and workspace manifests without executing tools')
    .option('--out <file>', 'write JSON snapshot to a new file')
    .action(async (repository: string, options: { out?: string }) => {
      const files = await readManifestSet(repository);
      const snapshot = inspectExtendedEnvironment(files);
      const report = {
        ...snapshot,
        inspectedFiles: Object.keys(files).sort(),
        inspectedFileCount: Object.keys(files).length,
        mode: 'manifest-only-no-execution',
      };
      const output = `${JSON.stringify(report, null, 2)}\n`;
      await writeNewFile(options.out, output);
      io.stdout(options.out ? `Wrote extended environment snapshot to ${options.out}\n` : output);
    });
}
