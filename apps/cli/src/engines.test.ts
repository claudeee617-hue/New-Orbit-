import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from './program.js';

const directories: string[] = [];
function tempDir(): string {
  const path = mkdtempSync(join(tmpdir(), 'orbit-engines-'));
  directories.push(path);
  return path;
}
function capture(): { io: CliIo; output: () => string } {
  let value = '';
  return {
    io: { stdout: (text) => (value += text), stderr: () => undefined, env: {} },
    output: () => value,
  };
}
async function run(args: string[]): Promise<string> {
  const result = capture();
  await buildProgram(result.io).parseAsync(['node', 'orbit', ...args]);
  return result.output();
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('ORBIT engine CLI', () => {
  it('runs WITNESS coverage verification from diff and LCOV files', async () => {
    const root = tempDir();
    const diff = join(root, 'change.diff');
    const lcov = join(root, 'coverage.info');
    writeFileSync(
      diff,
      [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,1 +1,2 @@',
        ' const before = true;',
        '+const changed = true;',
      ].join('\n'),
    );
    writeFileSync(lcov, 'SF:src/a.ts\nDA:2,1\nend_of_record\n');
    const report = JSON.parse(await run(['verify', diff, '--lcov', lcov])) as {
      summary: { status: string; percentage: number };
    };
    expect(report.summary).toMatchObject({ status: 'PASS', percentage: 100 });
  });

  it('runs CAPSULE inspection without reading secret .env values', async () => {
    const root = tempDir();
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@10', engines: { node: '>=22' } }),
    );
    writeFileSync(join(root, '.env'), 'PRIVATE_TOKEN=must-not-be-read');
    writeFileSync(join(root, '.env.example'), 'PUBLIC_ENDPOINT=https://example.invalid');
    const report = JSON.parse(await run(['capsule', 'inspect', root])) as {
      runtimes: Record<string, string>;
      environmentVariableNames: string[];
    };
    expect(report.runtimes.node).toBe('>=22');
    expect(report.environmentVariableNames).toEqual(['PUBLIC_ENDPOINT']);
    expect(JSON.stringify(report)).not.toContain('must-not-be-read');
  });

  it('replays a recorded telemetry file in read-only mode', async () => {
    const root = tempDir();
    const log = join(root, 'serial.ndjson');
    writeFileSync(
      log,
      '{"time":"2026-11-08T10:00:00Z","voltage":3.3,"event":"boot"}\n{"event":"watchdog reset"}\n',
    );
    const report = JSON.parse(await run(['device', 'replay', log])) as {
      mode: string;
      watchdogEvents: number;
    };
    expect(report.mode).toBe('read-only-recorded-file-replay');
    expect(report.watchdogEvents).toBe(1);
  });

  it('creates a partial passport and reports missing evidence', async () => {
    const root = tempDir();
    const input = join(root, 'passport.json');
    writeFileSync(
      input,
      JSON.stringify({
        repository: 'owner/repo',
        commitSha: '0123456789abcdef0123456789abcdef01234567',
        diffSha256: 'a'.repeat(64),
        changedFiles: ['src/a.ts'],
        evidence: [],
      }),
    );
    const report = JSON.parse(await run(['passport', 'create', input])) as {
      state: string;
      missingEvidence: string[];
    };
    expect(report.state).toBe('PARTIAL');
    expect(report.missingEvidence).toHaveLength(4);
  });

  it('generates a JUnit summary and avoids claiming historical flakiness from one run', async () => {
    const root = tempDir();
    const reportPath = join(root, 'junit.xml');
    writeFileSync(
      reportPath,
      '<testsuite name="unit"><testcase classname="a" name="works" time="0.01"/></testsuite>',
    );
    const report = JSON.parse(await run(['flare', 'summarize', reportPath])) as {
      tests: Array<{ classification: string }>;
    };
    expect(report.tests[0]?.classification).toBe('insufficient-data');
  });
});
