import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import type { Command } from 'commander';
import {
  analyseTelemetry,
  compareChangePassports,
  compareEnvironments,
  createChangePassport,
  createReproductionPlan,
  findSensitivePathFindings,
  getPassportHistory,
  inspectEnvironment,
  parseCobertura,
  parseJunitXml,
  parseLcov,
  parseTelemetry,
  recordChangePassport,
  renderWitnessSarif,
  SERIAL_TRANSPORT_STATUS,
  storeTelemetrySession,
  summarizeTestHistory,
  verifyChangedLineCoverage,
  type TelemetrySession,
} from '@orbit/atlas';
import { createGraphStore, openDatabase } from '@orbit/database';
import { loadConfig } from '@orbit/shared';
import type { CliIo } from './program.js';
import {
  collectValues,
  failOnError,
  parseFailOn,
  parseFraction,
  resolveGitFormat,
  runVerify,
} from './verify.js';

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

async function withGraphStore<T>(
  dbPath: string,
  repositoryKey: string | undefined,
  action: (
    store: ReturnType<typeof createGraphStore>,
    repository: { id: string; key: string },
  ) => Promise<T> | T,
  readOnly = false,
): Promise<T> {
  const database = readOnly
    ? openDatabase({ path: dbPath, migrate: false, readonly: true })
    : openDatabase({ path: dbPath });
  try {
    const store = createGraphStore(database);
    const repositories = store.repositories.list();
    const repository = repositoryKey
      ? repositories.find((item) => item.key === repositoryKey)
      : repositories.length === 1
        ? repositories[0]
        : undefined;
    if (!repository) {
      throw new Error(
        repositoryKey
          ? `Repository key ${repositoryKey} is not registered in this database`
          : `Specify --repo because this database contains ${repositories.length} repositories`,
      );
    }
    return await action(store, { id: repository.id, key: repository.key });
  } finally {
    database.close();
  }
}

function parseJsonOption<T>(value: string | undefined, label: string, fallback: T): T {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

export function attachEngineCommands(program: Command, io: CliIo): void {
  program
    .command('verify [diff-file]')
    .description(
      'WITNESS: verify a change. Git mode (--base/--head) reads coverage, test and build evidence; diff-file mode checks added lines of a saved diff against one coverage report',
    )
    .option('--base <ref>', 'git mode: base ref (the target branch)')
    .option('--head <ref>', 'git mode: head ref (the change under review)')
    .option('--repo <path>', 'git mode: repository to verify', '.')
    .option(
      '--coverage <file>',
      'git mode: LCOV or Cobertura XML for head (repeatable)',
      collectValues,
    )
    .option('--base-coverage <file>', 'git mode: coverage for the merge base', collectValues)
    .option('--test-report <file>', 'git mode: JUnit XML for head (repeatable)', collectValues)
    .option('--base-test-report <file>', 'git mode: JUnit XML for the merge base', collectValues)
    .option('--build-result <file>', 'git mode: JSON like {"status":"success","command":"…"}')
    .option('--coverage-commit <sha>', 'git mode: commit the coverage was produced from')
    .option(
      '--min-coverage <ratio>',
      'git mode: fail below this changed-line ratio (0..1)',
      parseFraction,
    )
    .option('--force', 'git mode: allow --out to overwrite an existing file')
    .option('--record', 'git mode: record evidence and findings in the workspace database')
    .option('--key <key>', 'git mode: repository key used with --record')
    .option('--db <path>', 'git mode: database path used with --record')
    .option(
      '--fail-on <status>',
      'git mode: exit code 6 when the overall status is at least this bad (PARTIAL, INCOMPLETE, FAIL)',
      parseFailOn,
    )
    .option('--lcov <file>', 'diff-file mode: LCOV coverage report')
    .option('--cobertura <file>', 'diff-file mode: Cobertura XML report')
    .option(
      '--format <format>',
      'json, markdown (md) or sarif (default: md in git mode, json otherwise)',
    )
    .option('--out <file>', 'write report to a new file (refuses to overwrite)')
    .action(
      async (
        diffFile: string | undefined,
        options: {
          base?: string;
          head?: string;
          repo: string;
          coverage?: string[];
          baseCoverage?: string[];
          testReport?: string[];
          baseTestReport?: string[];
          buildResult?: string;
          coverageCommit?: string;
          minCoverage?: number;
          force?: boolean;
          record?: boolean;
          key?: string;
          db?: string;
          failOn?: 'PARTIAL' | 'INCOMPLETE' | 'FAIL';
          lcov?: string;
          cobertura?: string;
          format?: string;
          out?: string;
        },
      ) => {
        const gitMode = options.base !== undefined || options.head !== undefined;
        if (gitMode) {
          if (diffFile !== undefined)
            throw new Error('use either a diff file or --base/--head, not both');
          if (options.base === undefined || options.head === undefined)
            throw new Error('git mode needs both --base and --head');
          if (options.lcov || options.cobertura)
            throw new Error(
              '--lcov/--cobertura belong to diff-file mode; use --coverage in git mode',
            );
          const config = loadConfig(io.env);
          const { report, text } = await runVerify({
            repo: options.repo,
            base: options.base,
            head: options.head,
            format: resolveGitFormat(options.format),
            db: options.db ?? config.dbPath,
            ...(options.coverage && { coverage: options.coverage }),
            ...(options.baseCoverage && { baseCoverage: options.baseCoverage }),
            ...(options.testReport && { testReport: options.testReport }),
            ...(options.baseTestReport && { baseTestReport: options.baseTestReport }),
            ...(options.buildResult !== undefined && { buildResult: options.buildResult }),
            ...(options.coverageCommit !== undefined && { coverageCommit: options.coverageCommit }),
            ...(options.minCoverage !== undefined && { minCoverage: options.minCoverage }),
            ...(options.out !== undefined && { out: options.out }),
            ...(options.force !== undefined && { force: options.force }),
            ...(options.record !== undefined && { record: options.record }),
            ...(options.key !== undefined && { key: options.key }),
          });
          io.stdout(text);
          failOnError(report, options.failOn);
          return;
        }
        if (diffFile === undefined)
          throw new Error('provide a diff file, or --base and --head for git mode');
        if (Boolean(options.lcov) === Boolean(options.cobertura)) {
          throw new Error('provide exactly one of --lcov or --cobertura');
        }
        const format = options.format ?? 'json';
        if (!['json', 'markdown', 'sarif'].includes(format))
          throw new Error('--format must be json, markdown or sarif');
        const diff = await readText(diffFile);
        const coverageText = await readText(options.lcov ?? options.cobertura!);
        const coverage = options.lcov ? parseLcov(coverageText) : parseCobertura(coverageText);
        const report = verifyChangedLineCoverage(diff, coverage);
        const sensitivePathFindings = findSensitivePathFindings(diff);
        const output =
          format === 'markdown'
            ? markdownVerification(report)
            : format === 'sarif'
              ? renderWitnessSarif(report, sensitivePathFindings)
              : `${JSON.stringify({ ...report, sensitivePathFindings }, null, 2)}\n`;
        await writeOutput(options.out, output);
        if (options.out) io.stdout(`Wrote ${format} verification report to ${options.out}\n`);
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
    .description('parse and analyse a recorded JSON, NDJSON, CSV or key-value telemetry file')
    .option('--format <format>', 'json, ndjson, csv or key-value')
    .option('--units <json>', 'JSON object mapping metric names to source-defined units')
    .option('--thresholds <json>', 'JSON array of explicit threshold rules')
    .option('--out <file>', 'write parsed session and analysis to a new JSON file')
    .option('--db <path>', 'persist session in an ORBIT workspace (writes evidence)')
    .option('--repo <key>', 'repository key; inferred only when one repository exists')
    .option('--repo-root <path>', 'local repository root for verifying the source artifact')
    .option('--artifact-path <path>', 'repo-relative path to the original telemetry file')
    .option('--commit <sha>', 'Git commit SHA to associate with the session')
    .option('--build-id <id>', 'firmware build identifier')
    .option('--device <label>', 'hardware device label')
    .option('--demo', 'mark this session as synthetic demonstration data')
    .action(
      async (
        file: string,
        options: {
          format?: TelemetrySession['format'];
          units?: string;
          thresholds?: string;
          out?: string;
          db?: string;
          repo?: string;
          repoRoot?: string;
          artifactPath?: string;
          commit?: string;
          buildId?: string;
          device?: string;
          demo?: boolean;
        },
      ) => {
        const allowed: TelemetrySession['format'][] = ['json', 'ndjson', 'csv', 'key-value'];
        if (options.format && !allowed.includes(options.format))
          throw new Error('--format must be json, ndjson, csv or key-value');
        const raw = await readText(file);
        const session = parseTelemetry(raw, options.format);
        const units = parseJsonOption<Record<string, string>>(options.units, '--units', {});
        if (
          !units ||
          typeof units !== 'object' ||
          Array.isArray(units) ||
          Object.entries(units).some(
            ([key, value]) =>
              !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) ||
              typeof value !== 'string' ||
              value.length > 32,
          )
        ) {
          throw new Error('--units must be a JSON object of metric names to short unit strings');
        }
        const thresholds = parseJsonOption<
          Array<{
            id: string;
            metric: string;
            min?: number;
            max?: number;
            unit?: string;
            severity?: 'info' | 'warning' | 'error';
            label?: string;
          }>
        >(options.thresholds, '--thresholds', []);
        if (!Array.isArray(thresholds)) throw new Error('--thresholds must be a JSON array');
        const analysis = analyseTelemetry(session, { units, thresholds });
        let persistence: unknown;
        if (options.db || options.repoRoot || options.artifactPath || options.repo) {
          if (!options.db || !options.repoRoot || !options.artifactPath) {
            throw new Error('persistence requires all of --db, --repo-root and --artifact-path');
          }
          persistence = await withGraphStore(options.db, options.repo, async (store, repository) =>
            storeTelemetrySession(store, {
              repositoryId: repository.id,
              repositoryRoot: options.repoRoot!,
              source: `file:${options.artifactPath}`,
              artifactRelativePath: options.artifactPath!,
              session,
              analysisOptions: { units, thresholds },
              isDemo: options.demo === true,
              ...(options.device ? { deviceLabel: options.device } : {}),
              ...(options.buildId ? { firmwareBuildId: options.buildId } : {}),
              ...(options.commit ? { commitSha: options.commit } : {}),
            }),
          );
        }
        const report = {
          ...session,
          schemaVersion: 1,
          source: basename(file),
          mode: 'read-only-recorded-file-replay',
          analysis,
          serialTransport: SERIAL_TRANSPORT_STATUS,
          ...(persistence ? { persistence } : {}),
          ...(options.demo
            ? { demoLabel: 'DEMO — synthetic data, not a physical device capture' }
            : {}),
        };
        const output = `${JSON.stringify(report, null, 2)}\n`;
        await writeOutput(options.out, output);
        io.stdout(options.out ? `Wrote telemetry replay report to ${options.out}\n` : output);
      },
    );

  device
    .command('serial-status')
    .description('show whether a reviewed hardware serial transport is available')
    .action(() => io.stdout(`${JSON.stringify(SERIAL_TRANSPORT_STATUS, null, 2)}\n`));

  const passport = program
    .command('passport')
    .description('assemble an evidence-backed Change Passport');
  passport
    .command('create <input-json>')
    .description(
      'create a canonical passport from supplied evidence, optionally correlating it with the ORBIT graph',
    )
    .option('--out <file>', 'write passport to a new JSON file')
    .option('--repository <owner/name>', 'repository identifier for a standalone passport')
    .option('--commit <sha>', 'override commit SHA')
    .option('--db <path>', 'persist a versioned passport in the ORBIT graph')
    .option('--repo <key>', 'repository key for graph correlation')
    .action(
      async (
        file: string,
        options: { out?: string; repository?: string; commit?: string; db?: string; repo?: string },
      ) => {
        const input = JSON.parse(await readText(file, 2 * 1024 * 1024)) as Record<string, unknown>;
        const basicInput = {
          ...input,
          ...(options.repository && { repository: options.repository }),
          ...(options.commit && { commitSha: options.commit }),
        } as Parameters<typeof createChangePassport>[0];
        const result = options.db
          ? await withGraphStore(options.db, options.repo, (store, repository) =>
              recordChangePassport(store, {
                ...basicInput,
                repositoryId: repository.id,
                repository: repository.key,
              } as Parameters<typeof recordChangePassport>[1]),
            )
          : createChangePassport(basicInput);
        const output = `${JSON.stringify(result, null, 2)}\n`;
        await writeOutput(options.out, output);
        io.stdout(options.out ? `Wrote Change Passport to ${options.out}\n` : output);
      },
    );

  passport
    .command('history <passport-node-id>')
    .description('list immutable Change Passport versions')
    .requiredOption('--db <path>', 'ORBIT workspace database path')
    .option('--repo <key>', 'repository key when the database contains several repositories')
    .action(async (passportNodeId: string, options: { db: string; repo?: string }) => {
      const result = await withGraphStore(
        options.db,
        options.repo,
        (store, repository) => getPassportHistory(store, repository.id, passportNodeId),
        true,
      );
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    });

  passport
    .command('compare <before-node-id> <after-node-id>')
    .description('compare evidence, files, findings and completeness between two passports')
    .requiredOption('--db <path>', 'ORBIT workspace database path')
    .option('--repo <key>', 'repository key when the database contains several repositories')
    .action(async (before: string, after: string, options: { db: string; repo?: string }) => {
      const result = await withGraphStore(
        options.db,
        options.repo,
        (store, repository) => compareChangePassports(store, repository.id, before, after),
        true,
      );
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    });

  passport
    .command('plan <passport-node-id>')
    .description('create a human-run reproduction plan; no commands are executed')
    .requiredOption('--db <path>', 'ORBIT workspace database path')
    .option('--repo <key>', 'repository key when the database contains several repositories')
    .action(async (passportNodeId: string, options: { db: string; repo?: string }) => {
      const result = await withGraphStore(
        options.db,
        options.repo,
        (store, repository) => createReproductionPlan(store, repository.id, passportNodeId),
        true,
      );
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    });
}
