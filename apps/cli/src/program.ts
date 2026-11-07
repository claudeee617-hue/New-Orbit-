import { Command } from 'commander';
import { ORBIT_TAGLINE, ORBIT_VERSION, loadConfig } from '@orbit/shared';
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

  return program;
}
