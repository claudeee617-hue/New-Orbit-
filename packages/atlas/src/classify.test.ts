import { describe, expect, it } from 'vitest';
import { conventionalTargetNames, findCycles, rankHotspots } from './analysis.js';
import {
  classifyFile,
  compileGlobs,
  detectLanguage,
  globToRegExp,
  isTestPath,
} from './classify.js';
import { parseGitLog } from './git.js';

describe('language and category detection', () => {
  it.each([
    ['a.ts', 'typescript'],
    ['a.d.ts', 'typescript'],
    ['A.TSX', 'typescript'],
    ['a.mjs', 'javascript'],
    ['a.py', 'python'],
    ['A.java', 'java'],
    ['a.c', 'c'],
    ['a.h', 'c'],
    ['a.cpp', 'cpp'],
    ['a.hpp', 'cpp'],
    ['a.rs', undefined],
    ['README', undefined],
  ])('detects %s as %s', (path, language) => {
    expect(detectLanguage(path)).toBe(language);
  });

  it.each([
    ['src/a.ts', 'source'],
    ['src/a.test.ts', 'test'],
    ['tests/helper.py', 'test'],
    ['pkg/test_x.py', 'test'],
    ['src/FooTest.java', 'test'],
    ['vendor/lib/x.c', 'vendor'],
    ['src/generated/api.ts', 'generated'],
    ['docs/guide.md', 'docs'],
    ['README.md', 'docs'],
    ['package.json', 'build'],
    ['requirements.txt', 'build'],
    ['requirements-dev.txt', 'build'],
    ['config/app.yaml', 'config'],
    ['logo.png', 'asset'],
    ['data.bin', 'other'],
  ])('classifies %s as %s', (path, category) => {
    expect(classifyFile(path)).toBe(category);
  });

  it('recognises test paths', () => {
    expect(isTestPath('src/__tests__/x.js')).toBe(true);
    expect(isTestPath('src/contest.ts')).toBe(false);
  });
});

describe('globs', () => {
  it('supports **, * and ? on POSIX paths', () => {
    const m = (g: string, p: string) => globToRegExp(g).test(p);
    expect(m('**/node_modules/**', 'a/b/node_modules/x.js')).toBe(true);
    expect(m('**/node_modules/**', 'node_modules/x.js')).toBe(true);
    expect(m('src/*.ts', 'src/a.ts')).toBe(true);
    expect(m('src/*.ts', 'src/deep/a.ts')).toBe(false);
    expect(m('src/**/*.ts', 'src/deep/er/a.ts')).toBe(true);
    expect(m('*.min.js', 'a/b/x.min.js')).toBe(true);
    expect(m('a?.ts', 'ab.ts')).toBe(true);
    expect(m('build/', 'build/out.js')).toBe(true);
    expect(m('a.b', 'aXb')).toBe(false); // dots are literal
  });

  it('does not treat regex metacharacters in globs as regex', () => {
    expect(compileGlobs(['src/(x)+.ts'])('src/(x)+.ts')).toBe(true);
    expect(compileGlobs(['src/(x)+.ts'])('src/xx.ts')).toBe(false);
  });
});

describe('findCycles', () => {
  it('finds multi-node cycles and self loops, sorted', () => {
    const g = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a', 'd']],
      ['d', []],
      ['e', ['e']],
      ['f', ['a']],
    ]);
    expect(findCycles(g)).toEqual([['a', 'b', 'c'], ['e']]);
  });

  it('returns nothing for a DAG', () => {
    expect(
      findCycles(
        new Map([
          ['a', ['b']],
          ['b', []],
        ]),
      ),
    ).toEqual([]);
  });

  it('handles a 100000-long chain without overflowing the stack', () => {
    const g = new Map<string, string[]>();
    const n = 100_000;
    for (let i = 0; i < n; i += 1) g.set(`n${i}`, i + 1 < n ? [`n${i + 1}`] : ['n0']);
    const cycles = findCycles(g);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(n);
  });
});

describe('test naming conventions and hotspots', () => {
  it('derives candidate target names', () => {
    expect(conventionalTargetNames('src/foo.test.ts')).toContain('foo');
    expect(conventionalTargetNames('tests/test_foo.py')).toContain('foo');
    expect(conventionalTargetNames('foo_test.c')).toContain('foo');
    expect(conventionalTargetNames('FooTest.java')).toContain('Foo');
  });

  it('ranks by complexity × churn and keeps both visible', () => {
    const ranked = rankHotspots(
      [
        { path: 'a', complexity: 10, churn: 1 },
        { path: 'b', complexity: 3, churn: 10 },
        { path: 'c', complexity: 0, churn: 50 },
        { path: 'd', complexity: 5, churn: undefined },
      ],
      10,
    );
    expect(ranked.map((h) => [h.path, h.score])).toEqual([
      ['b', 30],
      ['a', 10],
      ['d', 5],
    ]);
    expect(ranked[2]?.churn).toBeUndefined();
  });
});

describe('git log parsing', () => {
  it('parses numstat records and ignores malformed ones', () => {
    const sha = 'a'.repeat(40);
    const out = `\u001e${sha}\u001fAsha\u001f2026-01-01T00:00:00+00:00\u001fmsg\n\n3\t1\tsrc/a.ts\n-\t-\tbin.png\n\u001enot-a-sha\u001fx\u001fy\u001fz\n`;
    expect(parseGitLog(out)).toEqual([
      {
        sha,
        authorName: 'Asha',
        date: '2026-01-01T00:00:00+00:00',
        subject: 'msg',
        files: [
          { path: 'src/a.ts', additions: 3, deletions: 1 },
          { path: 'bin.png', additions: 0, deletions: 0 },
        ],
      },
    ]);
  });
});
