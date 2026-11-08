import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from './program.js';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'orbit-cli-atlas-'));
  dirs.push(d);
  return d;
}
function capture(): { io: CliIo; out: () => string } {
  let out = '';
  return { io: { stdout: (t) => (out += t), stderr: () => undefined, env: {} }, out: () => out };
}
function repo(): string {
  const root = tempDir();
  const files: Record<string, string> = {
    'src/a.ts': `import { b } from './b';\nexport function a() { return b(); }\n`,
    'src/b.ts': `export function b() { return 1; }\n`,
    'src/b.test.ts': `import { b } from './b';\nb();\n`,
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}
async function run(args: string[]): Promise<string> {
  const { io, out } = capture();
  await buildProgram(io).parseAsync(['node', 'orbit', ...args]);
  return out();
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('orbit scan / atlas', () => {
  it('scans, prints a summary with limitations, and keeps the cache outside the repository', async () => {
    const root = repo();
    const work = tempDir();
    const db = join(work, '.orbit', 'orbit.db');
    const text = await run(['scan', root, '--db', db, '--no-git', '--key', 'demo']);
    expect(text).toContain('Scanned demo');
    expect(text).toContain('3 parsed');
    expect(text).toContain('Git history indexing was disabled');
    expect(existsSync(db)).toBe(true);
    expect(existsSync(join(work, '.orbit', 'cache'))).toBe(true);
    expect(existsSync(join(root, '.orbit'))).toBe(false);
  });

  it('prints JSON for scan and exports the graph deterministically', async () => {
    const root = repo();
    const db = join(tempDir(), 'orbit.db');
    const scan = JSON.parse(await run(['scan', root, '--db', db, '--no-git', '--json'])) as {
      stats: { filesParsed: number };
    };
    expect(scan.stats.filesParsed).toBe(3);
    const first = await run(['atlas', 'export', '--db', db]);
    const second = await run(['atlas', 'export', '--db', db]);
    expect(first).toBe(second);
    const exported = JSON.parse(first) as {
      files: { path: string }[];
      relationships: { type: string; from: string; to: string }[];
    };
    expect(exported.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.test.ts', 'src/b.ts']);
    expect(exported.relationships).toContainEqual(
      expect.objectContaining({ type: 'IMPORTS', from: 'File:src/a.ts', to: 'File:src/b.ts' }),
    );
  });

  it('writes the export to a file when asked', async () => {
    const root = repo();
    const work = tempDir();
    const db = join(work, 'orbit.db');
    await run(['scan', root, '--db', db, '--no-git']);
    const out = join(work, 'out', 'atlas.json');
    expect(await run(['atlas', 'export', '--db', db, '--out', out])).toContain('Wrote');
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ formatVersion: 1 });
  });

  it('answers impact questions', async () => {
    const root = repo();
    const db = join(tempDir(), 'orbit.db');
    await run(['scan', root, '--db', db, '--no-git']);
    const text = await run(['atlas', 'impact', 'src/b.ts', '--db', db]);
    expect(text).toContain('src/a.ts');
    expect(text).toContain('src/b.test.ts');
    const json = JSON.parse(await run(['atlas', 'impact', 'src/b.ts', '--db', db, '--json'])) as {
      dependents: { path: string }[];
    };
    expect(json.dependents.map((d) => d.path).sort()).toEqual(['src/a.ts', 'src/b.test.ts']);
  });

  it('gives clear errors for missing database, unknown repo and bad paths', async () => {
    const db = join(tempDir(), 'missing.db');
    await expect(run(['atlas', 'export', '--db', db])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(existsSync(db)).toBe(false); // read-only commands never create the database
    const root = repo();
    const real = join(tempDir(), 'orbit.db');
    await run(['scan', root, '--db', real, '--no-git', '--key', 'demo']);
    await expect(run(['atlas', 'export', '--db', real, '--repo', 'nope'])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(run(['atlas', 'impact', 'nope.ts', '--db', real])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      run(['scan', join(tmpdir(), 'orbit-no-such-dir'), '--db', real]),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('requires --repo when several repositories are scanned', async () => {
    const db = join(tempDir(), 'orbit.db');
    await run(['scan', repo(), '--db', db, '--no-git', '--key', 'one']);
    await run(['scan', repo(), '--db', db, '--no-git', '--key', 'two']);
    await expect(run(['atlas', 'export', '--db', db])).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(await run(['atlas', 'export', '--db', db, '--repo', 'two'])).toContain(
      '"formatVersion"',
    );
  });
});
