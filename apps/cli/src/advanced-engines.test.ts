import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from './program.js';

const directories: string[] = [];
function tempDir(): string {
  const path = mkdtempSync(join(tmpdir(), 'orbit-advanced-'));
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

describe('extended WITNESS CLI', () => {
  it('compares LCOV snapshots and reports a measured regression', async () => {
    const root = tempDir();
    const before = join(root, 'before.info');
    const after = join(root, 'after.info');
    writeFileSync(before, 'SF:src/a.ts\nDA:1,1\nDA:2,1\nend_of_record\n');
    writeFileSync(after, 'SF:src/a.ts\nDA:1,0\nDA:2,1\nend_of_record\n');
    const report = JSON.parse(
      await run(['witness', 'coverage-compare', before, after, '--format', 'lcov']),
    ) as {
      comparisons: Array<{ status: string; percentageDelta: number }>;
    };
    expect(report.comparisons[0]).toMatchObject({ status: 'REGRESSION', percentageDelta: -50 });
  });

  it('flags sensitive filenames without printing file contents', async () => {
    const root = tempDir();
    const diff = join(root, 'secret.diff');
    writeFileSync(
      diff,
      [
        'diff --git a/id_rsa b/id_rsa',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/id_rsa',
        '@@ -0,0 +1 @@',
        '+PRIVATE CONTENT MUST NOT BE READ',
      ].join('\n'),
    );
    const report = JSON.parse(await run(['witness', 'sensitive-paths', diff])) as {
      findings: Array<{ rule: string; message: string }>;
    };
    expect(report.findings[0]?.rule).toBe('secrets.private-key');
    expect(JSON.stringify(report)).not.toContain('PRIVATE CONTENT');
  });
});

describe('extended FLARE CLI', () => {
  it('combines multiple JUnit reports and detects repeated pass/fail flips', async () => {
    const root = tempDir();
    const files: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const file = join(root, `run-${index}.xml`);
      const body = index % 2 === 0 ? '' : '<failure message="unstable"/>';
      writeFileSync(
        file,
        `<testsuite name="unit"><testcase classname="auth" name="login" time="0.1">${body}</testcase></testsuite>`,
      );
      files.push(file);
    }
    const report = JSON.parse(
      await run(['flare', 'analyse', ...files, '--format', 'junit', '--min-samples', '8']),
    ) as {
      executionsInReports: number;
      summaries: Array<{ classification: string; flipCount: number }>;
    };
    expect(report.executionsInReports).toBe(8);
    expect(report.summaries[0]).toMatchObject({ classification: 'suspected-flaky', flipCount: 7 });
  });
});

describe('extended CAPSULE CLI', () => {
  it('inspects manifests without reading actual .env secrets or executing tools', async () => {
    const root = tempDir();
    mkdirSync(join(root, '.devcontainer'));
    writeFileSync(join(root, '.tool-versions'), 'nodejs 22.12.0\npython 3.12.0');
    writeFileSync(join(root, 'requirements.txt'), 'fastapi==0.115.0');
    writeFileSync(join(root, 'Dockerfile'), 'FROM node:22-alpine');
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*');
    writeFileSync(
      join(root, '.devcontainer', 'devcontainer.json'),
      '{"image":"mcr.microsoft.com/devcontainers/base:ubuntu"}',
    );
    writeFileSync(join(root, '.env.example'), 'PUBLIC_URL=https://example.invalid');
    writeFileSync(join(root, '.env'), 'TOKEN=DO_NOT_EXPOSE');
    const report = JSON.parse(await run(['capsule', 'inspect-extended', root])) as {
      toolchains: Record<string, string>;
      declaredDependencies: Record<string, string>;
      containerImages: Array<{ image: string }>;
      environmentVariableNames: string[];
      mode: string;
    };
    expect(report.toolchains).toMatchObject({ node: '22.12.0', python: '3.12.0' });
    expect(report.declaredDependencies.fastapi).toBe('0.115.0');
    expect(report.containerImages.map((item) => item.image)).toContain('node:22-alpine');
    expect(report.environmentVariableNames).toEqual(['PUBLIC_URL']);
    expect(report.mode).toBe('manifest-only-no-execution');
    expect(JSON.stringify(report)).not.toContain('DO_NOT_EXPOSE');
  });
});
