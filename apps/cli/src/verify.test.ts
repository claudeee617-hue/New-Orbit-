import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from './program.js';
import { meetsFailThreshold } from './verify.js';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'orbit-cli-verify-'));
  dirs.push(d);
  return d;
}
function git(root: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args],
    { cwd: root, stdio: 'ignore' },
  );
}
function write(root: string, files: Record<string, string>): void {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
}
function repo(): string {
  const root = tempDir();
  git(root, 'init', '-q', '-b', 'main');
  write(root, { 'src/a.ts': 'export function a() {\n  return 1;\n}\n' });
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'base');
  git(root, 'checkout', '-q', '-b', 'feature');
  write(root, {
    'src/a.ts': 'export function a() {\n  return 1;\n}\nexport function b() {\n  return 2;\n}\n',
  });
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'add b');
  return root;
}
function capture(): { io: CliIo; out: () => string } {
  let out = '';
  return { io: { stdout: (t) => (out += t), stderr: () => undefined, env: {} }, out: () => out };
}
async function run(args: string[]): Promise<string> {
  const { io, out } = capture();
  await buildProgram(io).parseAsync(['node', 'orbit', ...args]);
  return out();
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('orbit verify', () => {
  it('reports NOT_MEASURED honestly without evidence inputs', async () => {
    const root = repo();
    const md = await run(['verify', '--repo', root, '--base', 'main', '--head', 'feature']);
    expect(md).toContain('# WITNESS verification: PARTIAL');
    expect(md).toContain('| coverage | NOT_MEASURED');
  });

  it('uses coverage to classify changed lines and emits JSON and SARIF', async () => {
    const root = repo();
    const cov = join(tempDir(), 'lcov.info');
    writeFileSync(cov, 'SF:src/a.ts\nDA:1,1\nDA:2,1\nDA:4,0\nDA:5,0\nend_of_record\n');
    const json = JSON.parse(
      await run([
        'verify',
        '--repo',
        root,
        '--base',
        'main',
        '--head',
        'feature',
        '--coverage',
        cov,
        '--format',
        'json',
      ]),
    ) as { files: { coverage: { uncovered: number[] } }[]; findings: { rule: string }[] };
    expect(json.files[0]?.coverage.uncovered).toEqual([4, 5]);
    expect(json.findings.map((f) => f.rule)).toContain('UNCOVERED-LINES');
    const sarif = JSON.parse(
      await run([
        'verify',
        '--repo',
        root,
        '--base',
        'main',
        '--head',
        'feature',
        '--coverage',
        cov,
        '--format',
        'sarif',
      ]),
    ) as { version: string };
    expect(sarif.version).toBe('2.1.0');
  });

  it('fails with exit-code semantics when --fail-on is met', async () => {
    const root = repo();
    await expect(
      run([
        'verify',
        '--repo',
        root,
        '--base',
        'main',
        '--head',
        'feature',
        '--fail-on',
        'PARTIAL',
      ]),
    ).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
    await expect(
      run(['verify', '--repo', root, '--base', 'main', '--head', 'feature', '--fail-on', 'FAIL']),
    ).resolves.toContain('WITNESS');
  });

  it('refuses to overwrite --out without --force', async () => {
    const root = repo();
    const out = join(tempDir(), 'report.md');
    const args = ['verify', '--repo', root, '--base', 'main', '--head', 'feature', '--out', out];
    await run(args);
    expect(existsSync(out)).toBe(true);
    writeFileSync(out, 'precious');
    await expect(run(args)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(readFileSync(out, 'utf8')).toBe('precious');
    await run([...args, '--force']);
    expect(readFileSync(out, 'utf8')).toContain('WITNESS');
  });

  it('records findings only when asked', async () => {
    const root = repo();
    const db = join(tempDir(), 'orbit.db');
    await run(['verify', '--repo', root, '--base', 'main', '--head', 'feature', '--db', db]);
    expect(existsSync(db)).toBe(false);
    await run([
      'verify',
      '--repo',
      root,
      '--base',
      'main',
      '--head',
      'feature',
      '--db',
      db,
      '--record',
    ]);
    expect(existsSync(db)).toBe(true);
  });

  it('rejects bad option values and bad refs', async () => {
    const root = repo();
    await expect(
      run(['verify', '--repo', root, '--base', 'main', '--head', 'feature', '--format', 'xml']),
    ).rejects.toBeDefined();
    await expect(
      run(['verify', '--repo', root, '--base', '-x', '--head', 'feature']),
    ).rejects.toBeDefined();
    await expect(
      run(['verify', '--repo', root, '--base', 'main', '--head', 'feature', '--min-coverage', '3']),
    ).rejects.toBeDefined();
  });

  it('orders thresholds', () => {
    expect(meetsFailThreshold('PASS', 'PARTIAL')).toBe(false);
    expect(meetsFailThreshold('NOT_MEASURED', 'PARTIAL')).toBe(true);
    expect(meetsFailThreshold('PARTIAL', 'INCOMPLETE')).toBe(false);
    expect(meetsFailThreshold('FAIL', 'INCOMPLETE')).toBe(true);
  });
});
