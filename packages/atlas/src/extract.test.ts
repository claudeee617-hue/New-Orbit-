import { describe, expect, it } from 'vitest';
import { extractFile } from './extract.js';

async function run(language: Parameters<typeof extractFile>[0], path: string, code: string) {
  const result = await extractFile(language, path, code);
  if (!result) throw new Error('parse timed out');
  return result;
}

const names = (xs: { qualifiedName: string }[]) => xs.map((s) => s.qualifiedName);

describe('TypeScript', () => {
  const code = `#!/usr/bin/env node
import fs, { readFile as rf } from 'node:fs';
import * as path from "./path";
import type { A } from '../types';
import './side-effect';
export { x } from './x';
export * from './all';
const lazy = await import('./lazy');
const dyn = await import(name);
const cjs = require('./cjs');

export class Greeter extends Base {
  private secret = () => 1;
  hello(name: string) {
    if (name && name.length > 3) { return helper(name); }
    return name ? this.format(name) : '';
  }
  private hidden() {}
}
export interface Shape { area(): number }
export type Id = string;
export enum Color { Red }
export function helper(x: number): number {
  for (let i = 0; i < x; i++) { if (i % 2) continue; }
  return x;
}
const arrow = (a: number) => a > 1 || a < -1;
export const exported = function () { eval('1'); };
namespace NS { export function inner() {} }
new Greeter().hello('x');
`;

  it('extracts symbols with kinds, qualified names and export flags', async () => {
    const r = await run('typescript', 'a.ts', code);
    const byName = new Map(r.symbols.map((s) => [s.qualifiedName, s]));
    expect(byName.get('Greeter')).toMatchObject({ kind: 'class', exported: true });
    expect(byName.get('Greeter.hello')).toMatchObject({ kind: 'method', exported: true });
    expect(byName.get('Greeter.hidden')).toMatchObject({ kind: 'method', exported: false });
    expect(byName.get('Greeter.secret')).toMatchObject({ kind: 'method' });
    expect(byName.get('Shape')).toMatchObject({ kind: 'interface', exported: true });
    expect(byName.get('Id')).toMatchObject({ kind: 'type' });
    expect(byName.get('Color')).toMatchObject({ kind: 'enum' });
    expect(byName.get('helper')).toMatchObject({ kind: 'function', exported: true });
    expect(byName.get('arrow')).toMatchObject({ kind: 'function', exported: false });
    expect(byName.get('exported')).toMatchObject({ kind: 'function', exported: true });
    expect(byName.get('NS.inner')).toBeDefined();
  });

  it('keeps 1-based line locations', async () => {
    const r = await run('typescript', 'a.ts', code);
    const helper = r.symbols.find((s) => s.name === 'helper');
    expect(helper?.location.startLine).toBe(23);
  });

  it('computes cyclomatic complexity', async () => {
    const r = await run('typescript', 'a.ts', code);
    const complexity = (n: string) => r.symbols.find((s) => s.qualifiedName === n)?.complexity;
    expect(complexity('Greeter.hello')).toBe(1 + 1 + 1 + 1); // if, &&, ternary
    expect(complexity('helper')).toBe(1 + 2); // for, if
    expect(complexity('arrow')).toBe(2); // ||
    expect(r.complexity).toBeGreaterThanOrEqual(8);
  });

  it('extracts imports with kinds, names and confidence', async () => {
    const r = await run('typescript', 'a.ts', code);
    const find = (s: string) => r.imports.find((i) => i.specifier === s);
    expect(find('node:fs')).toMatchObject({
      kind: 'static',
      names: expect.arrayContaining(['readFile', 'default']),
    });
    expect(find('./path')?.names).toEqual(['*']);
    expect(find('../types')?.kind).toBe('type');
    expect(find('./side-effect')?.names).toEqual([]);
    expect(find('./x')?.kind).toBe('reexport');
    expect(find('./all')).toMatchObject({ kind: 'reexport', names: ['*'] });
    expect(find('./lazy')).toMatchObject({ kind: 'dynamic', confidence: 0.9 });
    expect(find('./cjs')).toMatchObject({ kind: 'require' });
    expect(r.imports.every((i) => i.confidence > 0 && i.location.startLine > 0)).toBe(true);
  });

  it('reports unsupported constructs instead of guessing', async () => {
    const r = await run('typescript', 'a.ts', code);
    const constructs = r.unsupported.map((u) => u.construct);
    expect(constructs).toContain('dynamic-import');
    expect(constructs).toContain('eval');
  });

  it('extracts calls with enclosing function', async () => {
    const r = await run('typescript', 'a.ts', code);
    expect(r.calls).toContainEqual(
      expect.objectContaining({ callee: 'helper', enclosing: 'Greeter.hello' }),
    );
    expect(r.calls).toContainEqual(
      expect.objectContaining({ callee: 'format', receiver: 'this', enclosing: 'Greeter.hello' }),
    );
    expect(r.calls).toContainEqual(expect.objectContaining({ callee: 'Greeter' })); // new Greeter()
  });

  it('handles TSX and JSX', async () => {
    const tsx = await run(
      'typescript',
      'c.tsx',
      `export function App() { return <div onClick={() => go()}>hi</div>; }\nfunction go() {}`,
    );
    expect(names(tsx.symbols)).toContain('App');
    expect(tsx.parseErrors).toBe(0);
    const jsx = await run('javascript', 'c.jsx', `export const B = () => <b/>;`);
    expect(names(jsx.symbols)).toContain('B');
  });
});

describe('JavaScript', () => {
  it('parses CommonJS', async () => {
    const r = await run(
      'javascript',
      'a.js',
      `const x = require('./x');\nfunction f() { return x(); }\nmodule.exports = { f };`,
    );
    expect(r.imports).toHaveLength(1);
    expect(names(r.symbols)).toEqual(['f']);
  });
});

describe('Python', () => {
  const code = `import os, sys
import a.b.c as abc
from . import sibling
from ..pkg.mod import thing, other as o
from x import *
import importlib

class Service(Base):
    def run(self, n):
        if n and n > 1:
            return helper(n)
        for i in range(n):
            pass
        return [x for x in range(3) if x]

    def _private(self):
        pass

def helper(n):
    try:
        return n
    except ValueError:
        eval("1")
    importlib.import_module(name)
    importlib.import_module("plugins.a")

if __name__ == "__main__":
    helper(1)
`;
  it('extracts symbols, visibility and complexity', async () => {
    const r = await run('python', 'a.py', code);
    const by = new Map(r.symbols.map((s) => [s.qualifiedName, s]));
    expect(by.get('Service')).toMatchObject({ kind: 'class', exported: true });
    expect(by.get('Service.run')).toMatchObject({ kind: 'method', exported: true });
    expect(by.get('Service._private')).toMatchObject({ exported: false });
    expect(by.get('helper')).toMatchObject({ kind: 'function' });
    // base 1 + if + and + for + comprehension (for_in + if)
    expect(by.get('Service.run')?.complexity).toBe(1 + 1 + 1 + 1 + 2);
    expect(by.get('helper')?.complexity).toBe(1 + 1); // except
  });

  it('extracts absolute, relative, aliased and wildcard imports', async () => {
    const r = await run('python', 'a.py', code);
    const spec = r.imports.map((i) => `${'.'.repeat(i.relativeLevel)}${i.specifier}`);
    expect(spec).toEqual(
      expect.arrayContaining(['os', 'sys', 'a.b.c', '.', '..pkg.mod', 'x', 'plugins.a']),
    );
    const from = r.imports.find((i) => i.specifier === 'pkg.mod');
    expect(from).toMatchObject({ relativeLevel: 2, names: ['thing', 'other'] });
    expect(r.imports.find((i) => i.specifier === 'x')?.names).toEqual(['*']);
    expect(r.imports.find((i) => i.specifier === 'plugins.a')?.kind).toBe('dynamic');
  });

  it('flags unsupported dynamic behaviour and detects the __main__ entry point', async () => {
    const r = await run('python', 'a.py', code);
    const constructs = r.unsupported.map((u) => u.construct);
    expect(constructs).toEqual(
      expect.arrayContaining(['eval', 'wildcard-import', 'dynamic-import']),
    );
    expect(r.entryPointReasons).toContain('python __main__ guard');
  });

  it('extracts calls', async () => {
    const r = await run('python', 'a.py', code);
    expect(r.calls).toContainEqual(
      expect.objectContaining({ callee: 'helper', enclosing: 'Service.run' }),
    );
  });
});

describe('Java', () => {
  const code = `package com.acme.app;
import java.util.List;
import com.acme.util.*;
import static com.acme.util.Strings.join;

public class Main {
  public static void main(String[] args) {
    Helper h = new Helper();
    if (args.length > 0 && args[0] != null) { h.run(args[0]); }
    switch (args.length) { case 1: break; default: break; }
  }
  private int hidden() { return 1; }
}
interface Helper2 {}
enum Mode { A }
`;
  it('extracts package, imports, symbols and entry point', async () => {
    const r = await run('java', 'Main.java', code);
    expect(r.packageName).toBe('com.acme.app');
    expect(r.imports.map((i) => i.specifier)).toEqual([
      'java.util.List',
      'com.acme.util',
      'com.acme.util.Strings.join',
    ]);
    expect(r.imports[1]?.names).toEqual(['*']);
    expect(r.imports[2]?.names).toEqual(['join']);
    const by = new Map(r.symbols.map((s) => [s.qualifiedName, s]));
    expect(by.get('Main')).toMatchObject({ kind: 'class', exported: true });
    expect(by.get('Main.main')).toMatchObject({ kind: 'method', exported: true });
    expect(by.get('Main.hidden')?.exported).toBe(false);
    expect(by.get('Helper2')?.kind).toBe('interface');
    expect(by.get('Mode')?.kind).toBe('enum');
    expect(r.entryPointReasons).toContain('java public static void main');
    expect(by.get('Main.main')?.complexity).toBe(1 + 1 + 1 + 1); // if, &&, case 1 (default is not a decision)
  });

  it('extracts calls and constructors', async () => {
    const r = await run('java', 'Main.java', code);
    expect(r.calls).toContainEqual(
      expect.objectContaining({ callee: 'run', receiver: 'h', enclosing: 'Main.main' }),
    );
    expect(r.calls).toContainEqual(
      expect.objectContaining({ callee: 'Helper', enclosing: 'Main.main' }),
    );
  });
});

describe('C', () => {
  const code = `#include <stdio.h>
#include "util/math.h"
#define SQUARE(x) ((x)*(x))
#ifdef DEBUG
#define LOG 1
#endif
struct Point { int x; int y; };
enum Color { RED };
static int helper(int a) { return a > 0 && a < 10 ? a : 0; }
int add(int a, int b) { return helper(a) + b; }
int main(void) {
  for (int i = 0; i < 3; i++) { if (i) printf("x"); }
  return add(1, 2);
}
`;
  it('extracts includes, symbols, entry point and flags macros', async () => {
    const r = await run('c', 'main.c', code);
    expect(r.imports).toEqual([
      expect.objectContaining({ specifier: 'stdio.h', kind: 'include-system' }),
      expect.objectContaining({ specifier: 'util/math.h', kind: 'include-local' }),
    ]);
    const by = new Map(r.symbols.map((s) => [s.qualifiedName, s]));
    expect(by.get('helper')).toMatchObject({ kind: 'function', exported: false });
    expect(by.get('add')).toMatchObject({ kind: 'function', exported: true });
    expect(by.get('main')).toBeDefined();
    expect(by.get('Point')?.kind).toBe('struct');
    expect(by.get('Color')?.kind).toBe('enum');
    expect(by.get('helper')?.complexity).toBe(1 + 1 + 1); // ?: and &&
    expect(by.get('main')?.complexity).toBe(1 + 1 + 1);
    expect(r.entryPointReasons).toContain('C/C++ main function');
    const constructs = r.unsupported.map((u) => u.construct);
    expect(constructs).toContain('macro');
    expect(constructs).toContain('conditional-compilation');
  });

  it('extracts calls', async () => {
    const r = await run('c', 'main.c', code);
    expect(r.calls).toContainEqual(expect.objectContaining({ callee: 'add', enclosing: 'main' }));
    expect(r.calls).toContainEqual(expect.objectContaining({ callee: 'helper', enclosing: 'add' }));
  });
});

describe('C++', () => {
  const code = `#include <vector>
#include "shape.hpp"
namespace geo {
class Circle : public Shape {
 public:
  double area() const { return r_ * r_ * 3.14; }
  void grow();
 private:
  double r_;
};
void Circle::grow() { if (r_ < 10) { r_ += 1; } }
template <typename T> T twice(T v) { return v + v; }
}
int main() { geo::Circle c; c.grow(); return 0; }
`;
  it('extracts namespaces, classes, qualified and template functions', async () => {
    const r = await run('cpp', 'main.cpp', code);
    const q = names(r.symbols);
    expect(q).toEqual(
      expect.arrayContaining([
        'geo',
        'geo.Circle',
        'geo.Circle.area',
        'geo.Circle.grow',
        'geo.twice',
        'main',
      ]),
    );
    expect(r.parseErrors).toBe(0);
    expect(r.calls).toContainEqual(
      expect.objectContaining({ callee: 'grow', receiver: 'c', enclosing: 'main' }),
    );
    expect(r.entryPointReasons).toContain('C/C++ main function');
  });
});

describe('syntax errors', () => {
  it('reports parse errors and still returns partial results', async () => {
    const r = await run(
      'typescript',
      'bad.ts',
      `export function ok() { return 1; }\nfunction broken( { `,
    );
    expect(r.parseErrors).toBeGreaterThan(0);
    expect(r.unsupported.some((u) => u.construct === 'syntax-error')).toBe(true);
    expect(names(r.symbols)).toContain('ok');
  });

  it('survives extremely deep nesting without crashing', async () => {
    const depth = 3000;
    const code = `const x = ${'['.repeat(depth)}1${']'.repeat(depth)};`;
    const r = await run('javascript', 'deep.js', code);
    expect(r.unsupported.map((u) => u.construct)).toContain('deep-nesting');
  });

  it('handles empty files', async () => {
    const r = await run('python', 'empty.py', '');
    expect(r.lines).toBe(0);
    expect(r.symbols).toEqual([]);
  });
});

describe('robustness', () => {
  const samples: [Parameters<typeof extractFile>[0], string, string][] = [
    [
      'typescript',
      'a.ts',
      "import { a as b } from './x';\nexport class A { m() { return b(); } }\nfunction f(){ if (1) { for(;;){} } }\n",
    ],
    ['python', 'a.py', 'from x import a as b\nclass A:\n    def m(self):\n        return b()\n'],
    ['java', 'A.java', 'package p;\nimport q.R;\npublic class A { int m() { return R.x(); } }\n'],
    ['c', 'a.c', '#include "a.h"\nint main(void) { return f(); }\n'],
  ];
  function mulberry(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('never throws on truncated or mutated sources', async () => {
    const rand = mulberry(2026);
    for (const [language, path, code] of samples) {
      for (let i = 0; i < 40; i++) {
        let mutated = code.slice(0, Math.floor(rand() * code.length));
        if (i % 2 === 0 && mutated.length > 2) {
          const at = Math.floor(rand() * mutated.length);
          mutated =
            mutated.slice(0, at) +
            String.fromCharCode(33 + Math.floor(rand() * 90)) +
            mutated.slice(at + 1);
        }
        const result = await extractFile(language, path, mutated);
        expect(result === undefined || Array.isArray(result.symbols)).toBe(true);
      }
    }
  });
});
