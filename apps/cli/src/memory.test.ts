import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from './program.js';

const dirs: string[] = [];
let root: string;
let db: string;

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'orbit-cli-mem-'));
  dirs.push(d);
  return d;
}
function write(base: string, files: Record<string, string>): void {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(base, p)), { recursive: true });
    writeFileSync(join(base, p), c);
  }
}

async function orbit(...args: string[]): Promise<{ out: string; err: string; code: number }> {
  let out = '';
  let err = '';
  const io: CliIo = {
    stdout: (t) => (out += t),
    stderr: (t) => (err += t),
    env: { ORBIT_DB_PATH: db, ORBIT_USER: 'claudy' },
  };
  const before = process.exitCode;
  process.exitCode = 0;
  try {
    await buildProgram(io).parseAsync(['node', 'orbit', ...args]);
    return { out, err, code: Number(process.exitCode ?? 0) };
  } finally {
    process.exitCode = before;
  }
}

beforeEach(async () => {
  root = tmp();
  db = join(tmp(), 'orbit.db');
  const git = (...a: string[]): void => {
    execFileSync(
      'git',
      ['-c', 'user.name=T', '-c', 'user.email=t@e.com', '-c', 'commit.gpgsign=false', ...a],
      { cwd: root, stdio: 'pipe' },
    );
  };
  git('init', '-q', '-b', 'main');
  write(root, {
    'src/a.ts': 'export function a() { return 1; }\n',
    'docs/adr/0001-sqlite.md':
      '# ADR-0001: Use SQLite\n\nStatus: Accepted\n\n## Decision\nUse SQLite for local storage.\n',
  });
  git('add', '.');
  git('commit', '-q', '-m', 'Add storage per ADR-0001');
  await orbit('scan', root, '--key', 'demo');
});

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('orbit memory', () => {
  it('adds, shows, updates, versions and invalidates a memory item', async () => {
    const add = await orbit(
      'memory',
      'add',
      '--category',
      'team-convention',
      '--title',
      'Commit style',
      '--body',
      'Use conventional commits.',
      '--tag',
      'git',
      '--file',
      'src/a.ts:1',
      '--root',
      root,
      '--json',
    );
    const item = JSON.parse(add.out) as {
      id: string;
      version: number;
      createdBy: string;
      authoritative: boolean;
    };
    expect(item).toMatchObject({
      id: 'memory/team-convention/commit-style',
      version: 1,
      createdBy: 'claudy',
      authoritative: true,
    });

    const shown = await orbit('memory', 'show', item.id);
    expect(shown.out).toContain('Use conventional commits.');
    expect(shown.out).toContain('src/a.ts:1');

    await orbit(
      'memory',
      'update',
      item.id,
      '--body',
      'Use conventional commits with scopes.',
      '--reason',
      'add scopes',
      '--root',
      root,
    );
    const history = JSON.parse((await orbit('memory', 'history', item.id, '--json')).out) as {
      version: number;
    }[];
    expect(history.map((h) => h.version)).toEqual([1, 2]);

    await orbit('memory', 'invalidate', item.id, '--reason', 'dropped');
    expect((await orbit('memory', 'search', 'conventional')).out).toContain('No matching memory');
    expect((await orbit('memory', 'search', 'conventional', '--invalidated')).out).toContain(
      'INVALIDATED',
    );
    expect((await orbit('memory', 'reinstate', item.id, '--reason', 'oops')).out).toContain(
      'Reinstated',
    );
  });

  it('keeps AI suggestions labelled until a person confirms them', async () => {
    const add = await orbit(
      'memory',
      'add',
      '--category',
      'repository-discovery',
      '--title',
      'Guess',
      '--body',
      'Maybe a cache helps.',
      '--ai',
      '--json',
    );
    const item = JSON.parse(add.out) as {
      id: string;
      authority: string;
      authoritative: boolean;
      createdBy: string;
    };
    expect(item).toMatchObject({
      authority: 'ai-suggested',
      authoritative: false,
      createdBy: 'ai:claudy',
    });
    expect((await orbit('memory', 'search', 'cache', '--authoritative')).out).toContain(
      'No matching memory',
    );
    const confirmed = JSON.parse(
      (await orbit('memory', 'confirm', item.id, '--note', 'checked', '--json')).out,
    ) as { authoritative: boolean };
    expect(confirmed.authoritative).toBe(true);
  });

  it('imports ADRs, links history, and check exits 1 when a cited file changed', async () => {
    const imported = await orbit('memory', 'import', root);
    expect(imported.out).toContain('1 new');
    expect((await orbit('memory', 'import', root)).out).toContain('1 unchanged');
    const linked = await orbit('memory', 'link');
    expect(linked.out).toContain('subject cites ADR-1');

    expect((await orbit('memory', 'check', '--root', root)).code).toBe(0);
    write(root, {
      'docs/adr/0001-sqlite.md':
        '# ADR-0001: Use SQLite\n\nStatus: Accepted\n\n## Decision\nUse SQLite with WAL.\n',
    });
    const check = await orbit('memory', 'check', '--root', root);
    expect(check.code).toBe(1);
    expect(check.out).toContain('STALE');
    expect(check.out).toContain('file-changed');
  });

  it('rejects bad input with a clear error instead of writing anything', async () => {
    await expect(
      orbit('memory', 'add', '--category', 'nonsense', '--title', 'x', '--body', 'y'),
    ).rejects.toThrow(/Invalid memory/);
    await expect(
      orbit(
        'memory',
        'add',
        '--category',
        'known-bug',
        '--title',
        'x',
        '--body',
        'y',
        '--file',
        '../etc/passwd',
      ),
    ).rejects.toThrow(/Invalid memory/);
    await expect(orbit('memory', 'show', 'memory/known-bug/nope')).rejects.toThrow(/No memory/);
    expect((await orbit('memory', 'search')).out).toContain('No matching memory');
  });
});
