import { Command, InvalidArgumentError } from 'commander';
import { ORBIT_TAGLINE, ORBIT_VERSION, loadConfig } from '@orbit/shared';
import { attachEngineCommands } from './engines.js';
import { renderScan, runExport, runImpact, runScan } from './atlas.js';
import { collectStatus, renderStatus } from './status.js';
import { startOrbitMcpServer } from '@orbit/mcp';

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

  program
    .command('mcp')
    .description('start read-only MCP access to an indexed ORBIT repository')
    .command('start')
    .description('serve ATLAS graph and memory tools over stdio (read-only)')
    .option('--db <path>', 'existing ORBIT database path')
    .option(
      '--repo <key>',
      'repository key (required when the database contains multiple repositories)',
    )
    .action(async (options: { db?: string; repo?: string }) => {
      const config = loadConfig(io.env);
      await startOrbitMcpServer({
        dbPath: options.db ?? config.dbPath,
        ...(options.repo ? { repositoryKey: options.repo } : {}),
      });
    });

  attachEngineCommands(program, io);
  return program;
}
