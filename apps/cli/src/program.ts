import { Command, InvalidArgumentError } from 'commander';
import { OrbitError, ORBIT_TAGLINE, ORBIT_VERSION, loadConfig } from '@orbit/shared';
import { renderScan, runExport, runImpact, runScan } from './atlas.js';
import { meetsFailThreshold, runVerify } from './verify.js';
import { collectStatus, renderStatus } from './status.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
}

export const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
};

export function buildProgram(io: CliIo = defaultIo): Command {
  const program = new Command();
  program
    .name('orbit')
    .description(`ORBIT — Engineering Intelligence Platform\n${ORBIT_TAGLINE}`)
    .version(ORBIT_VERSION, '-v, --version', 'print the ORBIT version')
    .configureOutput({
      writeOut: (text) => io.stdout(text),
      writeErr: (text) => io.stderr(text),
    })
    .exitOverride();

  program
    .command('status')
    .description('show ORBIT, Node.js and workspace database status (read-only)')
    .option('--json', 'print machine-readable JSON')
    .option('--db <path>', 'database path (default: ORBIT_DB_PATH or .orbit/orbit.db)')
    .action((options: { json?: boolean; db?: string }) => {
      const config = loadConfig(io.env);
      const report = collectStatus(options.db ?? config.dbPath);
      io.stdout(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderStatus(report));
    });

  const collect = (value: string, previous: string[] = []): string[] => [...previous, value];
  const positive = (value: string): number => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('must be a positive integer');
    return n;
  };

  program
    .command('scan <path>')
    .description(
      'scan a repository (read-only) with ATLAS and record the facts in the workspace database',
    )
    .option('--db <path>', 'database path (default: ORBIT_DB_PATH or .orbit/orbit.db)')
    .option('--key <key>', 'stable repository key (default: local/<folder name>)')
    .option('--include <glob>', 'only scan files matching this glob (repeatable)', collect)
    .option('--exclude <glob>', 'also skip files matching this glob (repeatable)', collect)
    .option('--max-files <n>', 'stop after this many files', positive)
    .option('--max-commits <n>', 'git history window', positive)
    .option('--no-git', 'skip git history (churn, ownership, commits)')
    .option('--no-calls', 'skip call extraction')
    .option('--json', 'print machine-readable JSON')
    .action(
      async (
        path: string,
        options: {
          db?: string;
          key?: string;
          include?: string[];
          exclude?: string[];
          maxFiles?: number;
          maxCommits?: number;
          git: boolean;
          calls: boolean;
          json?: boolean;
        },
      ) => {
        const config = loadConfig(io.env);
        const result = await runScan(path, { ...options, db: options.db ?? config.dbPath });
        io.stdout(options.json ? `${JSON.stringify(result, null, 2)}\n` : renderScan(result));
      },
    );

  const fraction = (value: string): number => {
    const n = Number(value);
    if (!(n >= 0 && n <= 1)) throw new InvalidArgumentError('must be a number between 0 and 1');
    return n;
  };
  const oneOf =
    <T extends string>(allowed: readonly T[]) =>
    (value: string): T => {
      if (!(allowed as readonly string[]).includes(value))
        throw new InvalidArgumentError(`must be one of: ${allowed.join(', ')}`);
      return value as T;
    };

  program
    .command('verify')
    .description(
      'WITNESS: verify a change between two git refs using coverage, test and build evidence',
    )
    .requiredOption('--base <ref>', 'base ref (the target branch)')
    .requiredOption('--head <ref>', 'head ref (the change under review)')
    .option('--repo <path>', 'repository to verify (default: current directory)', '.')
    .option('--coverage <file>', 'LCOV or Cobertura XML for head (repeatable)', collect)
    .option('--base-coverage <file>', 'coverage for the merge base, for regression checks', collect)
    .option('--test-report <file>', 'JUnit XML for head (repeatable)', collect)
    .option('--base-test-report <file>', 'JUnit XML for the merge base', collect)
    .option('--build-result <file>', 'JSON like {"status":"success","command":"…"}')
    .option('--coverage-commit <sha>', 'commit the coverage was produced from, if known')
    .option(
      '--min-coverage <ratio>',
      'fail coverage below this changed-line ratio (0..1)',
      fraction,
    )
    .option('--format <format>', 'md, json or sarif', oneOf(['md', 'json', 'sarif'] as const), 'md')
    .option('--out <file>', 'also write the report to a file (refuses to overwrite)')
    .option('--force', 'allow --out to overwrite an existing file')
    .option('--record', 'record evidence and findings in the workspace database')
    .option('--key <key>', 'repository key used with --record')
    .option('--db <path>', 'database path used with --record')
    .option(
      '--fail-on <status>',
      'exit with code 6 when the overall status is at least this bad',
      oneOf(['PARTIAL', 'INCOMPLETE', 'FAIL'] as const),
    )
    .action(
      async (options: {
        base: string;
        head: string;
        repo: string;
        coverage?: string[];
        baseCoverage?: string[];
        testReport?: string[];
        baseTestReport?: string[];
        buildResult?: string;
        coverageCommit?: string;
        minCoverage?: number;
        format: 'md' | 'json' | 'sarif';
        out?: string;
        force?: boolean;
        record?: boolean;
        key?: string;
        db?: string;
        failOn?: 'PARTIAL' | 'INCOMPLETE' | 'FAIL';
      }) => {
        const config = loadConfig(io.env);
        const { report, text } = await runVerify({
          ...options,
          db: options.db ?? config.dbPath,
        });
        io.stdout(text);
        if (options.failOn && meetsFailThreshold(report.overall, options.failOn))
          throw new OrbitError(
            'VERIFICATION_FAILED',
            `verification result ${report.overall} is at least ${options.failOn}`,
          );
      },
    );

  const atlas = program
    .command('atlas')
    .description('query what ATLAS learned about a scanned repository (read-only)');

  atlas
    .command('export')
    .description('export the architecture, symbols, dependencies and relationships as JSON')
    .option('--db <path>', 'database path')
    .option('--repo <key>', 'repository key (needed when several are scanned)')
    .option('--out <file>', 'write to a file instead of stdout')
    .action((options: { db?: string; repo?: string; out?: string }) => {
      const config = loadConfig(io.env);
      io.stdout(runExport(options.db ?? config.dbPath, options.repo, options.out));
    });

  atlas
    .command('impact <file>')
    .description('show what a change to <file> can affect: dependents, modules and tests')
    .option('--db <path>', 'database path')
    .option('--repo <key>', 'repository key')
    .option('--json', 'print machine-readable JSON')
    .action((file: string, options: { db?: string; repo?: string; json?: boolean }) => {
      const config = loadConfig(io.env);
      const impact = runImpact(options.db ?? config.dbPath, options.repo, file);
      if (options.json) {
        io.stdout(`${JSON.stringify(impact, null, 2)}\n`);
        return;
      }
      const lines = [
        `Impact of ${impact.file}`,
        `Dependents  ${impact.dependents.length}${impact.truncated ? ' (truncated)' : ''}`,
        ...impact.dependents.slice(0, 25).map((d) => `  ${'  '.repeat(d.depth - 1)}${d.path}`),
        `Modules     ${impact.affectedModules.join(', ') || 'none'}`,
        `Tests       ${impact.tests.length}`,
        ...impact.tests.map(
          (t) =>
            `  ${t.test} (covers ${t.covers}${t.confidence === null ? '' : `, confidence ${t.confidence}`})`,
        ),
      ];
      if (impact.packageLevelDependents.length > 0) {
        lines.push(
          `Package-level importers (coarser, may not use this file): ${impact.packageLevelDependents.length}`,
        );
      }
      io.stdout(`${lines.join('\n')}\n`);
    });

  return program;
}
