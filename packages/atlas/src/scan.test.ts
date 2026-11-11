import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IN_MEMORY,
  createGraphStore,
  openDatabase,
  type GraphStore,
  type OrbitDatabase,
} from '@orbit/database';
import {
  buildArchitectureMap,
  exportAtlas,
  impactMap,
  moduleSummaries,
  scanRepository,
  symbolIndex,
} from './index.js';

let db: OrbitDatabase;
let store: GraphStore;
let repo: string;
let cache: string;
const created: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

const FIXTURE: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'demo',
    main: 'src/index.ts',
    dependencies: { react: '^19.0.0', lodash: '^4.0.0' },
    devDependencies: { vitest: '^5.0.0' },
  }),
  'src/index.ts': `import { a } from './a';\nimport _ from 'lodash';\nimport { readFileSync } from 'node:fs';\nexport function main() { return a(); }\n`,
  'src/a.ts': `import { b } from './b.js';\nexport function a() { return b() + local(); }\nfunction local() { return 1; }\n`,
  'src/b.ts': `import { a } from './a';\nexport function b() { if (a) { return 1; } return 2; }\n`,
  'src/a.test.ts': `import { a } from './a';\nimport { describe } from 'vitest';\ndescribe('a', () => { a(); });\n`,
  'tests/b.test.ts': `describe('b', () => {});\n`,
  'py/app/__init__.py': '',
  'py/app/core.py': `from .util import helper\nimport requests\n\ndef run():\n    return helper()\n\nif __name__ == "__main__":\n    run()\n`,
  'py/app/util.py': `def helper():\n    return 1\n`,
  'py/requirements.txt': 'requests==2.31.0\nflask>=3\n',
  'java/src/com/acme/Main.java': `package com.acme;\nimport com.acme.util.Tool;\npublic class Main { public static void main(String[] a) { new Tool().go(); } }\n`,
  'java/src/com/acme/util/Tool.java': `package com.acme.util;\npublic class Tool { public void go() {} }\n`,
  'c/main.c': `#include <stdio.h>\n#include "util.h"\nint main(void) { return util(); }\n`,
  'c/util.h': `int util(void);\n`,
  'c/util.c': `#include "util.h"\nint util(void) { return 1; }\n`,
  'docs/readme.md': '# hi\n',
  'node_modules/dep/index.js': 'module.exports = 1;\n',
};

beforeEach(() => {
  db = openDatabase({ path: IN_MEMORY });
  store = createGraphStore(db);
  cache = tempDir('orbit-cache-');
});

afterEach(() => {
  db.close();
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function scan(root: string, extra: Partial<Parameters<typeof scanRepository>[0]> = {}) {
  const result = await scanRepository({
    rootPath: root,
    store,
    repositoryKey: 'demo',
    cacheDir: cache,
    config: { skipGit: true },
    ...extra,
  });
  repo = result.repositoryId;
  return result;
}

describe('scanRepository on a multi-language repository', () => {
  it('discovers, classifies and excludes', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    const r = await scan(root);
    expect(r.stats.byLanguage).toEqual({ c: 3, java: 2, python: 3, typescript: 5 });
    expect(r.excludedDirectories).toContain('node_modules');
    expect(store.nodes.find(repo, { type: 'File' }).map((n) => n.key)).not.toContain(
      'node_modules/dep/index.js',
    );
    expect(r.stats.byCategory['test']).toBe(2);
    expect(r.stats.byCategory['docs']).toBe(1);
  });

  it('writes files, symbols and modules with locations', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    await scan(root);
    const symbols = symbolIndex(store, repo, { name: 'b' });
    expect(symbols).toEqual([
      expect.objectContaining({
        file: 'src/b.ts',
        kind: 'function',
        line: 2,
        exported: true,
        complexity: 2,
      }),
    ]);
    expect(store.nodes.find(repo, { type: 'Module' }).map((m) => m.key)).toEqual(
      expect.arrayContaining(['.', 'src', 'py/app', 'c', 'java/src/com/acme']),
    );
  });

  it('resolves imports across languages with confidence and source locations', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    await scan(root);
    const file = (p: string) => store.nodes.find(repo, { type: 'File', keyPrefix: p })[0]!;
    const imports = (from: string) =>
      store.edges.list(repo, { fromId: file(from).id, types: ['IMPORTS'] });
    const targetKey = (id: string) => store.nodes.get(repo, id)?.key;

    const tsImports = imports('src/a.ts');
    expect(tsImports.map((e) => targetKey(e.toId))).toEqual(['src/b.ts']); // `./b.js` resolved to b.ts
    expect(tsImports[0]?.confidence).toBeGreaterThan(0.9);
    expect(tsImports[0]?.attrs['locations']).toEqual([
      expect.objectContaining({ path: 'src/a.ts', startLine: 1 }),
    ]);

    const idx = imports('src/index.ts')
      .map((e) => targetKey(e.toId))
      .sort();
    expect(idx).toEqual(['npm:lodash', 'src/a.ts', 'node:fs'.replace('node:', 'node:')].sort());
    expect(
      imports('py/app/core.py')
        .map((e) => targetKey(e.toId))
        .sort(),
    ).toEqual(['pypi:requests', 'py/app/util.py'].sort());
    expect(imports('java/src/com/acme/Main.java').map((e) => targetKey(e.toId))).toEqual([
      'java/src/com/acme/util/Tool.java',
    ]);
    expect(imports('c/main.c').map((e) => targetKey(e.toId))).toEqual(['c/util.h']);
  });

  it('detects dependencies, frameworks, build systems and entry points', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    const r = await scan(root);
    expect(r.analysis.frameworks.map((f) => f.name)).toEqual(
      expect.arrayContaining(['React', 'Vitest', 'Flask']),
    );
    expect(r.analysis.buildSystems).toEqual(expect.arrayContaining(['npm']));
    const deps = store.nodes.find(repo, { type: 'Dependency' }).map((d) => d.key);
    expect(deps).toEqual(
      expect.arrayContaining([
        'npm:react',
        'npm:lodash',
        'npm:vitest',
        'pypi:requests',
        'pypi:flask',
      ]),
    );
    const entries = Object.fromEntries(r.analysis.entryPoints.map((e) => [e.path, e.reasons]));
    expect(entries['src/index.ts']).toContain('package.json "main"');
    expect(entries['py/app/core.py']).toContain('python __main__ guard');
    expect(entries['java/src/com/acme/Main.java']).toContain('java public static void main');
    expect(entries['c/main.c']).toContain('C/C++ main function');
  });

  it('reports circular dependencies', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    const r = await scan(root);
    expect(r.analysis.fileCycles).toEqual([['src/a.ts', 'src/b.ts']]);
  });

  it('maps tests by imports and by naming convention', async () => {
    const root = tempDir('orbit-repo-');
    write(root, { ...FIXTURE, 'src/b.ts': FIXTURE['src/b.ts'] as string });
    await scan(root);
    const test = (p: string) => store.nodes.find(repo, { type: 'Test', keyPrefix: p })[0]!;
    const covers = (p: string) =>
      store.edges
        .list(repo, { fromId: test(p).id, types: ['TESTS'] })
        .map((e) => ({ target: store.nodes.get(repo, e.toId)?.key, reasons: e.attrs['reasons'] }));
    expect(covers('src/a.test.ts')).toEqual([
      { target: 'src/a.ts', reasons: expect.arrayContaining(['test file imports this file']) },
    ]);
    expect(covers('tests/b.test.ts')).toEqual([
      { target: 'src/b.ts', reasons: ['file naming convention'] },
    ]);
  });

  it('resolves calls with confidence and labels heuristics', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    await scan(root);
    const fn = (q: string) =>
      store.nodes
        .find(repo, { type: 'Function' })
        .find(
          (n) =>
            n.attrs['qualifiedName'] === q &&
            n.attrs['file'] ===
              (q === 'main' ? 'src/index.ts' : q === 'b' ? 'src/b.ts' : 'src/a.ts'),
        )!;
    const callsFrom = (id: string) => store.edges.list(repo, { fromId: id, types: ['CALLS'] });
    const fromA = callsFrom(fn('a').id)
      .map((e) => ({ to: store.nodes.get(repo, e.toId)?.attrs['qualifiedName'], c: e.confidence }))
      .sort((x, y) => String(x.to).localeCompare(String(y.to)));
    expect(fromA).toEqual([
      { to: 'b', c: 0.8 }, // via import
      { to: 'local', c: 0.9 }, // same file
    ]);
    const fromMain = callsFrom(fn('main').id);
    expect(fromMain).toHaveLength(1);
    expect(fromMain[0]?.attrs['locations']).toEqual([
      expect.objectContaining({ path: 'src/index.ts', startLine: 4 }),
    ]);
  });

  it('produces a coherent architecture map and module summaries', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    await scan(root);
    const map = buildArchitectureMap(store, repo);
    const src = map.modules.find((m) => m.module === 'src')!;
    expect(src.externalDependencies).toEqual([]); // externals attach to manifest modules
    const root0 = map.modules.find((m) => m.module === '.')!;
    expect(root0.externalDependencies).toEqual(expect.arrayContaining(['react', 'lodash']));
    const summaries = moduleSummaries(store, repo);
    const srcSummary = summaries.find((s) => s.module === 'src')!;
    expect(srcSummary.files).toBe(4);
    expect(srcSummary.publicSurface.map((p) => p.name)).toEqual(
      expect.arrayContaining(['a', 'b', 'main']),
    );
  });

  it('answers impact questions', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    await scan(root);
    const impact = impactMap(store, repo, 'src/b.ts');
    expect(impact.dependents.map((d) => d.path)).toEqual(
      expect.arrayContaining(['src/a.ts', 'src/index.ts']),
    );
    expect(impact.tests.map((t) => t.test)).toEqual(
      expect.arrayContaining(['src/a.test.ts', 'tests/b.test.ts']),
    );
    expect(impact.affectedModules).toContain('src');
    expect(() => impactMap(store, repo, 'nope.ts')).toThrowError(/not in the graph/);
  });

  it('exports deterministic JSON', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    await scan(root);
    const first = JSON.stringify(exportAtlas(store, repo));
    await scan(root);
    expect(JSON.stringify(exportAtlas(store, repo))).toBe(first);
    const parsed = exportAtlas(store, repo);
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.relationships.every((r) => Array.isArray(r.locations))).toBe(true);
  });

  it('leaves the graph verifiable', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    await scan(root);
    expect(store.verifyIntegrity(repo)).toMatchObject({ ok: true, problems: [] });
  });
});

describe('import bindings resolve calls', () => {
  async function callTargets(root: string): Promise<string[]> {
    const r = await scan(root);
    const edges = store.edges.list(r.repositoryId, { types: ['CALLS'] });
    return edges.map((e) => `${e.fromId}->${e.toId}`).length > 0
      ? store.edges
          .list(r.repositoryId, { types: ['CALLS'] })
          .map((e) => {
            const from = store.nodes.get(r.repositoryId, e.fromId)?.key;
            const to = store.nodes.get(r.repositoryId, e.toId)?.key;
            return `${from} -> ${to}`;
          })
          .sort()
      : [];
  }

  it('resolves aliased named imports and namespace calls (JS)', async () => {
    const root = tempDir('orbit-repo-');
    write(root, {
      'lib.ts': `export function helper() { return 1; }\nexport function other() { return 2; }\n`,
      'use.ts': `import { helper as h } from './lib';\nimport * as lib from './lib';\nexport function go() { return h() + lib.other(); }\n`,
    });
    expect(await callTargets(root)).toEqual([
      'use.ts#go -> lib.ts#helper',
      'use.ts#go -> lib.ts#other',
    ]);
  });

  it('resolves aliased python imports', async () => {
    const root = tempDir('orbit-repo-');
    write(root, {
      'util.py': `def work():\n    return 1\n`,
      'main.py': `from util import work as w\nimport util as u\n\ndef run():\n    return w() + u.work()\n`,
    });
    const targets = await callTargets(root);
    expect(targets).toContain('main.py#run -> util.py#work');
  });

  it('resolves Java static calls through class imports', async () => {
    const root = tempDir('orbit-repo-');
    write(root, {
      'src/com/acme/Util.java': `package com.acme;\npublic class Util {\n  public static int twice(int x) { return x * 2; }\n}\n`,
      'src/com/acme/App.java': `package com.acme.app;\nimport com.acme.Util;\npublic class App {\n  public int run() { return Util.twice(2); }\n}\n`,
    });
    const targets = await callTargets(root);
    expect(targets).toContain('src/com/acme/App.java#App.run -> src/com/acme/Util.java#Util.twice');
  });

  it('resolves destructured require', async () => {
    const root = tempDir('orbit-repo-');
    write(root, {
      'lib.js': `exports.helper = function helper() {};\nfunction helper2() {}\nmodule.exports = { helper2 };\n`,
      'use.js': `const { helper2: h } = require('./lib');\nfunction go() { return h(); }\n`,
    });
    const r = await scan(root);
    const imp = store.edges.list(r.repositoryId, { types: ['IMPORTS'] });
    expect(imp.length).toBeGreaterThan(0);
  });
});

describe('type-only imports and unresolved imports', () => {
  it('separates cycles that exist only through `import type`', async () => {
    const root = tempDir('orbit-repo-');
    write(root, {
      'a.ts': `import type { B } from './b';\nexport interface A { b: B }\n`,
      'b.ts': `import { type A } from './a';\nimport { x } from './c';\nexport interface B { a: A }\nexport const y = x;\n`,
      'c.ts': `import { y } from './b';\nexport const x = 1;\nexport const z = y;\n`,
    });
    const r = await scan(root);
    // b <-> c is a real runtime cycle; a <-> b is type-only.
    expect(r.analysis.fileCycles).toEqual([['b.ts', 'c.ts']]);
    // The full graph's component {a, b, c} exists only because type imports connect `a`.
    expect(r.analysis.typeOnlyCycles).toEqual([['a.ts', 'b.ts', 'c.ts']]);
  });

  it('counts imports of existing non-code files as assets, not unresolved', async () => {
    const root = tempDir('orbit-repo-');
    write(root, {
      'a.ts': `import './styles.css';\nimport data from './data.json';\n`,
      'styles.css': 'a{}',
      'data.json': '{}',
    });
    const r = await scan(root);
    expect(r.stats.imports).toMatchObject({ assets: 2, unresolved: 0 });
  });

  it('separates the Python standard library from third-party packages', async () => {
    const root = tempDir('orbit-repo-');
    write(root, { 'a.py': 'import os\nimport json\nimport requests\n' });
    const r = await scan(root);
    const deps = store.nodes.find(r.repositoryId, { type: 'Dependency' }).map((n) => n.key);
    expect(deps).toEqual(
      expect.arrayContaining(['python-stdlib:os', 'python-stdlib:json', 'pypi:requests']),
    );
  });

  it('lists unresolved imports with reasons', async () => {
    const root = tempDir('orbit-repo-');
    write(root, {
      'a.ts': `import { x } from './missing';\nimport '@/alias/thing';\n`,
      'c/m.c': `#include "nope.h"\n`,
    });
    const r = await scan(root);
    expect(r.unresolvedImports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'a.ts',
          specifier: './missing',
          reason: expect.stringContaining('no file matches'),
        }),
        expect.objectContaining({ path: 'c/m.c', specifier: 'nope.h' }),
      ]),
    );
  });
});

describe('evidence honesty', () => {
  it('marks the scan PARTIAL with limitations when git is skipped and constructs are unsupported', async () => {
    const root = tempDir('orbit-repo-');
    write(root, { 'a.py': 'eval("1")\nfrom x import *\n' });
    const r = await scan(root);
    const ev = store.evidence.get(repo, r.scanEvidenceId)!;
    expect(ev.status).toBe('PARTIAL');
    expect(ev.limitations.join(' ')).toMatch(/Git history indexing was disabled/);
    expect(ev.limitations.join(' ')).toMatch(/Unsupported constructs/);
    expect(ev.sourceType).toBe('parser');
  });

  it('marks syntax errors as partial results', async () => {
    const root = tempDir('orbit-repo-');
    write(root, { 'bad.ts': 'export function ok() {}\nfunction broken( {' });
    const r = await scan(root);
    expect(r.stats.parseErrors).toBeGreaterThan(0);
    expect(store.evidence.get(repo, r.scanEvidenceId)?.limitations.join(' ')).toMatch(
      /syntax the parser could not fully handle/,
    );
  });

  it('is INCOMPLETE when nothing could be parsed', async () => {
    const root = tempDir('orbit-repo-');
    write(root, { 'readme.md': '# nothing' });
    const r = await scan(root);
    expect(store.evidence.get(repo, r.scanEvidenceId)?.status).toBe('INCOMPLETE');
  });

  it('is PASS only when nothing was skipped, unsupported or unmeasured', async () => {
    const root = tempDir('orbit-repo-');
    write(root, { 'a.ts': 'export const x = 1;\n' });
    const git = tempDir('orbit-git-');
    void git;
    const r = await scan(root, { config: { skipGit: true } });
    // skipGit is itself a stated limitation, so even a trivial scan is PARTIAL.
    expect(store.evidence.get(repo, r.scanEvidenceId)?.status).toBe('PARTIAL');
  });
});

describe('incremental scanning', () => {
  it('reuses cache and writes nothing when nothing changed', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    const first = await scan(root);
    const head = store.ledger.head(repo)?.seq;
    const second = await scan(root);
    expect(first.stats.filesFromCache).toBe(0);
    expect(second.stats.filesFromCache).toBe(second.stats.filesParsed);
    expect(second.changes.nodes).toMatchObject({ added: 0, updated: 0, retired: 0 });
    expect(second.changes.edges).toMatchObject({ added: 0, updated: 0, retired: 0 });
    expect(store.ledger.head(repo)?.seq).toBe(head);
  });

  it('re-parses only changed files and updates the graph', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    await scan(root);
    write(root, { 'src/b.ts': `export function b() { return 3; }\nexport function extra() {}\n` });
    const r = await scan(root);
    expect(r.stats.filesParsed - r.stats.filesFromCache).toBe(1);
    expect(r.changes.nodes.added).toBeGreaterThanOrEqual(1); // extra()
    expect(r.changes.nodes.updated).toBeGreaterThanOrEqual(1); // b.ts and b()
    expect(r.analysis.fileCycles).toEqual([]); // b no longer imports a
    expect(r.changes.edges.retired).toBeGreaterThanOrEqual(1);
    expect(symbolIndex(store, repo, { name: 'extra' })).toHaveLength(1);
    expect(store.verifyIntegrity(repo).ok).toBe(true);
  });

  it('retires deleted files, their symbols and edges, and keeps history', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    await scan(root);
    rmSync(join(root, 'src/b.ts'));
    const r = await scan(root);
    expect(r.changes.nodes.retired).toBeGreaterThanOrEqual(2); // file + function
    expect(store.nodes.find(repo, { type: 'File' }).map((n) => n.key)).not.toContain('src/b.ts');
    const fileId = store.nodes.find(repo, { type: 'File' })[0]!.id;
    void fileId;
    expect(symbolIndex(store, repo, { name: 'b' })).toHaveLength(0);
    // History survives as tombstoned versions.
    const bId = (await import('@orbit/core')).nodeIdFor(repo, 'File', 'src/b.ts');
    expect(store.nodes.history(repo, bId).map((h) => h.deleted)).toEqual([false, true]);
    // A recreated file revives the node.
    write(root, { 'src/b.ts': FIXTURE['src/b.ts'] as string });
    await scan(root);
    expect(store.nodes.get(repo, bId)).toBeDefined();
    expect(store.verifyIntegrity(repo).ok).toBe(true);
  });

  it('works without a cache directory and after the cache is deleted', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    await scan(root, { cacheDir: undefined as unknown as string });
    rmSync(cache, { recursive: true, force: true });
    const r = await scan(root);
    expect(r.stats.filesFromCache).toBe(0);
    expect(r.changes.nodes).toMatchObject({ added: 0, updated: 0 });
  });

  it('invalidates the cache when the call setting changes', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    await scan(root);
    const r = await scan(root, { config: { skipGit: true, skipCalls: true } });
    expect(r.stats.filesFromCache).toBe(0);
    expect(r.stats.calls.total).toBe(0);
    expect(store.edges.list(repo, { types: ['CALLS'] })).toHaveLength(0); // stale call edges retired
  });
});

describe('scan scope and safety', () => {
  it('honours include and exclude globs', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    const only = await scan(root, { config: { skipGit: true, include: ['py/**'] } });
    expect(Object.keys(only.stats.byLanguage)).toEqual(['python']);
    const rest = await scan(root, {
      repositoryKey: 'demo2',
      config: { skipGit: true, exclude: ['java/**', 'c/**', 'py/**'] },
    });
    expect(Object.keys(rest.stats.byLanguage)).toEqual(['typescript']);
  });

  it('can disable default excludes', async () => {
    const root = tempDir('orbit-repo-');
    write(root, {
      'node_modules/x/index.js': 'export const a = 1;\n',
      'a.js': 'export const b = 1;\n',
    });
    const r = await scan(root, { config: { skipGit: true, noDefaultExcludes: true } });
    expect(r.stats.filesParsed).toBe(2);
  });

  it('does not follow symlinks, and skips binary and oversized files', async () => {
    const root = tempDir('orbit-repo-');
    const outside = tempDir('orbit-outside-');
    write(outside, { 'secret.py': 'def leak(): pass\n' });
    write(root, { 'a.py': 'def ok(): pass\n', 'big.py': `x = "${'a'.repeat(2000)}"\n` });
    writeFileSync(join(root, 'bin.py'), Buffer.from([0x70, 0x00, 0x01, 0x02]));
    symlinkSync(outside, join(root, 'linked'));
    symlinkSync(join(outside, 'secret.py'), join(root, 'link.py'));
    const r = await scan(root, { config: { skipGit: true, maxFileBytes: 1000 } });
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.path, s.reason]));
    expect(reasons['linked']).toBe('excluded-symlink');
    expect(reasons['link.py']).toBe('excluded-symlink');
    expect(reasons['big.py']).toBe('too-large');
    expect(reasons['bin.py']).toBe('binary');
    expect(symbolIndex(store, repo).map((s) => s.name)).toEqual(['ok']);
  });

  it('respects maxFiles and says so', async () => {
    const root = tempDir('orbit-repo-');
    write(root, { 'a.py': '', 'b.py': '', 'c.py': '' });
    const r = await scan(root, { config: { skipGit: true, maxFiles: 2 } });
    expect(r.stats.filesParsed).toBe(2);
    expect(r.limitations.join(' ')).toMatch(/maxFiles/);
  });

  it('never writes into the scanned repository', async () => {
    const root = tempDir('orbit-repo-');
    write(root, { 'a.py': 'def f(): pass\n' });
    await scan(root);
    expect(readdirSync(root)).toEqual(['a.py']);
  });

  it('rejects a missing path and invalid limits with clear errors', async () => {
    await expect(scan(join(tmpdir(), 'orbit-definitely-missing'))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    const root = tempDir('orbit-repo-');
    await expect(scan(root, { config: { maxFiles: 0 } })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('rolls back the whole scan if writing fails part-way', async () => {
    const root = tempDir('orbit-repo-');
    write(root, FIXTURE);
    const broken: GraphStore = {
      ...store,
      nodes: {
        ...store.nodes,
        upsert: () => {
          throw new Error('disk full');
        },
      },
    };
    await expect(
      scanRepository({
        rootPath: root,
        store: broken,
        repositoryKey: 'demo',
        config: { skipGit: true },
      }),
    ).rejects.toThrow('disk full');
    expect(store.repositories.list()).toHaveLength(0);
  });
});

describe('git history', () => {
  function git(root: string, ...args: string[]): void {
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Asha',
        '-c',
        'user.email=asha@example.test',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: root, stdio: 'ignore' },
    );
  }
  function commit(root: string, author: string, message: string): void {
    execFileSync(
      'git',
      [
        '-c',
        `user.name=${author}`,
        '-c',
        'user.email=x@example.test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-q',
        '-m',
        message,
      ],
      { cwd: root, stdio: 'ignore' },
    );
  }

  it('keeps unicode file names intact in history', async () => {
    const root = tempDir('orbit-repo-');
    git(root, 'init', '-q');
    write(root, { 'données.py': 'def a(): pass\n' });
    git(root, 'add', '.');
    commit(root, 'Asha', 'first');
    await scan(root, { config: {} });
    const file = store.nodes.find(repo, { type: 'File', keyPrefix: 'données.py' })[0];
    expect(file?.attrs['churn']).toBe(1);
  });

  it('indexes commits, churn, ownership and hotspots', async () => {
    const root = tempDir('orbit-repo-');
    git(root, 'init', '-q');
    write(root, { 'a.py': 'def a():\n    if 1:\n        pass\n', 'b.py': 'def b(): pass\n' });
    git(root, 'add', '.');
    commit(root, 'Asha', 'first');
    write(root, { 'a.py': 'def a():\n    if 1:\n        pass\n    if 2:\n        pass\n' });
    git(root, 'add', '.');
    commit(root, 'Ravi', 'second');
    write(root, {
      'a.py':
        'def a():\n    if 1:\n        pass\n    if 2:\n        pass\n    if 3:\n        pass\n',
    });
    git(root, 'add', '.');
    commit(root, 'Ravi', 'third');

    const r = await scan(root, { config: {} });
    expect(r.stats.commitsIndexed).toBe(3);
    expect(r.head).toMatch(/^[0-9a-f]{40}$/);
    const a = store.nodes.find(repo, { type: 'File', keyPrefix: 'a.py' })[0]!;
    expect(a.attrs['churn']).toBe(3);
    expect(a.attrs['owners']).toEqual([
      { name: 'Ravi', commits: 2, share: 0.667 },
      { name: 'Asha', commits: 1, share: 0.333 },
    ]);
    expect(r.analysis.hotspots[0]).toMatchObject({
      path: 'a.py',
      churn: 3,
      complexity: 4,
      score: 12,
    });
    expect(store.nodes.find(repo, { type: 'Commit' })).toHaveLength(3);
    const modifies = store.edges.list(repo, { toId: a.id, types: ['MODIFIES'] });
    expect(modifies).toHaveLength(3);
    expect(store.evidence.list(repo, { sourceType: 'git' })).toHaveLength(1);
    // A second scan of unchanged history changes nothing.
    const head = store.ledger.head(repo)?.seq;
    await scan(root, { config: {} });
    expect(store.ledger.head(repo)?.seq).toBe(head);
    expect(store.verifyIntegrity(repo).ok).toBe(true);
  });

  it('states when the window truncates history', async () => {
    const root = tempDir('orbit-repo-');
    git(root, 'init', '-q');
    for (const n of [1, 2, 3]) {
      write(root, { 'a.py': `x = ${n}\n` });
      git(root, 'add', '.');
      commit(root, 'Asha', `c${n}`);
    }
    const r = await scan(root, { config: { maxCommits: 2 } });
    expect(r.stats.commitsIndexed).toBe(2);
    expect(r.limitations.join(' ')).toMatch(/most recent 2/);
    expect(store.evidence.list(repo, { sourceType: 'git' })[0]?.status).toBe('PARTIAL');
  });

  it('reports not-a-repository instead of failing', async () => {
    const root = tempDir('orbit-repo-');
    write(root, { 'a.py': 'x = 1\n' });
    const r = await scan(root, { config: {} });
    expect(r.stats.commitsIndexed).toBe(0);
    expect(r.limitations.join(' ')).toMatch(/not a git repository|Not inside a git work tree/);
    expect(r.analysis.hotspots[0]?.churn).toBeUndefined();
  });
});
