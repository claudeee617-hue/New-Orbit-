import { builtinModules } from 'node:module';
import { posix } from 'node:path';
import type { ExtractedImport, Language } from './types.js';

export type Resolution =
  | { kind: 'file'; path: string; confidence: number; how: string }
  | { kind: 'module'; dir: string; confidence: number; how: string }
  | { kind: 'external'; ecosystem: string; name: string; confidence: number; how: string }
  /** A C/C++ system header (`<stdio.h>`): counted but not stored as a dependency. */
  | { kind: 'system'; name: string }
  /** A real non-code file (stylesheet, JSON, image) imported by path. Counted, not a graph edge. */
  | { kind: 'asset'; path: string }
  | { kind: 'unresolved'; reason: string };

export interface ResolveContext {
  files: ReadonlySet<string>;
  /** Every discovered file, including non-code ones. */
  allFiles: ReadonlySet<string>;
  /** npm workspace package name → package directory. */
  workspacePackages: ReadonlyMap<string, string>;
  /** Fully qualified Java class name → file path. */
  javaClasses: ReadonlyMap<string, string>;
  /** Java package → directories containing that package's files. */
  javaPackageDirs: ReadonlyMap<string, readonly string[]>;
  /** basename → paths, for C/C++ include fallback. */
  basenames: ReadonlyMap<string, readonly string[]>;
}

const JS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.d.ts'];
const JS_REPLACEMENTS: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};
const BUILTINS = new Set(builtinModules);

function joinClean(...parts: string[]): string | undefined {
  const joined = posix.normalize(posix.join(...parts));
  if (joined.startsWith('..') || joined.startsWith('/')) return undefined;
  return joined === '.' ? '' : joined;
}

function firstExisting(
  files: ReadonlySet<string>,
  candidates: readonly (string | undefined)[],
): { path: string; index: number } | undefined {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate !== undefined && files.has(candidate)) return { path: candidate, index };
  }
  return undefined;
}

function resolveJs(ctx: ResolveContext, from: string, imp: ExtractedImport): Resolution[] {
  const spec = imp.specifier;
  if (spec.startsWith('.')) {
    const base = joinClean(posix.dirname(from), spec);
    if (base === undefined)
      return [{ kind: 'unresolved', reason: 'import escapes the repository root' }];
    const candidates: string[] = [base];
    for (const ext of JS_EXTENSIONS) candidates.push(base + ext);
    const ext = posix.extname(base);
    for (const replacement of JS_REPLACEMENTS[ext] ?? [])
      candidates.push(base.slice(0, -ext.length) + replacement);
    for (const ext2 of JS_EXTENSIONS) candidates.push(posix.join(base, `index${ext2}`));
    const found = firstExisting(ctx.files, candidates);
    if (!found) {
      if (ctx.allFiles.has(base)) return [{ kind: 'asset', path: base }];
      return [{ kind: 'unresolved', reason: `no file matches ${spec}` }];
    }
    return [
      {
        kind: 'file',
        path: found.path,
        confidence: found.index === 0 ? 1 : 0.95,
        how: found.index === 0 ? 'exact path' : 'extension or index probing',
      },
    ];
  }
  if (spec.startsWith('/')) return [{ kind: 'unresolved', reason: 'absolute path import' }];
  if (spec.startsWith('node:'))
    return [
      {
        kind: 'external',
        ecosystem: 'node',
        name: spec.slice(5).split('/')[0] ?? spec,
        confidence: 1,
        how: 'node: builtin',
      },
    ];
  const parts = spec.split('/');
  const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
  if (BUILTINS.has(pkg))
    return [{ kind: 'external', ecosystem: 'node', name: pkg, confidence: 1, how: 'node builtin' }];
  const workspaceDir = ctx.workspacePackages.get(pkg);
  if (workspaceDir !== undefined)
    return [{ kind: 'module', dir: workspaceDir, confidence: 0.9, how: 'workspace package name' }];
  return [
    { kind: 'external', ecosystem: 'npm', name: pkg, confidence: 0.9, how: 'bare specifier' },
  ];
}

function resolvePython(ctx: ResolveContext, from: string, imp: ExtractedImport): Resolution[] {
  const segments = imp.specifier === '' ? [] : imp.specifier.split('.');
  const asCandidates = (root: string, parts: readonly string[]): string[] => {
    const joined = parts.length === 0 ? root : posix.join(root, ...parts);
    return [`${joined}.py`, `${joined}.pyi`, posix.join(joined, '__init__.py')].map((p) =>
      posix.normalize(p).replace(/^\.\//, ''),
    );
  };

  if (imp.relativeLevel > 0) {
    let base = posix.dirname(from);
    for (let i = 1; i < imp.relativeLevel; i += 1) base = posix.dirname(base);
    if (base === '.') base = '';
    const results: Resolution[] = [];
    // `from . import a, b` may name submodules.
    for (const name of imp.names) {
      if (name === '*') continue;
      const sub = firstExisting(ctx.files, asCandidates(base, [...segments, name]));
      if (sub)
        results.push({
          kind: 'file',
          path: sub.path,
          confidence: 0.9,
          how: 'relative submodule import',
        });
    }
    if (results.length > 0) return results;
    const target = firstExisting(
      ctx.files,
      segments.length === 0 ? [posix.join(base, '__init__.py')] : asCandidates(base, segments),
    );
    if (target)
      return [{ kind: 'file', path: target.path, confidence: 0.95, how: 'relative import' }];
    return [
      {
        kind: 'unresolved',
        reason: `no module matches ${'.'.repeat(imp.relativeLevel)}${imp.specifier}`,
      },
    ];
  }

  const roots = ['', 'src', 'lib', posix.dirname(from) === '.' ? '' : posix.dirname(from)];
  for (const root of [...new Set(roots)]) {
    const results: Resolution[] = [];
    for (const name of imp.names) {
      if (name === '*') continue;
      const sub = firstExisting(ctx.files, asCandidates(root, [...segments, name]));
      if (sub)
        results.push({
          kind: 'file',
          path: sub.path,
          confidence: 0.85,
          how: 'submodule named in from-import',
        });
    }
    if (results.length > 0) return results;
    const found = firstExisting(ctx.files, asCandidates(root, segments));
    if (found)
      return [
        {
          kind: 'file',
          path: found.path,
          confidence: root === '' ? 0.95 : 0.8,
          how: root === '' ? 'module path from repository root' : `module path under ${root}`,
        },
      ];
  }
  const top = segments[0] ?? imp.specifier;
  // Without an interpreter's stdlib list we cannot tell third-party from standard library.
  return [
    {
      kind: 'external',
      ecosystem: 'pypi',
      name: top,
      confidence: 0.6,
      how: 'not in repository: third-party or standard library',
    },
  ];
}

function resolveJava(ctx: ResolveContext, imp: ExtractedImport): Resolution[] {
  const spec = imp.specifier;
  if (imp.names[0] === '*') {
    const dirs = ctx.javaPackageDirs.get(spec);
    if (dirs && dirs.length > 0)
      return dirs.map((dir) => ({
        kind: 'module' as const,
        dir,
        confidence: dirs.length === 1 ? 0.8 : 0.5,
        how: 'wildcard import of package',
      }));
  } else {
    const exact = ctx.javaClasses.get(spec);
    if (exact)
      return [{ kind: 'file', path: exact, confidence: 1, how: 'fully qualified class name' }];
    const parent = spec.split('.').slice(0, -1).join('.');
    const staticTarget = ctx.javaClasses.get(parent);
    if (staticTarget)
      return [
        { kind: 'file', path: staticTarget, confidence: 0.9, how: 'static import of class member' },
      ];
  }
  if (/^javax?\./.test(spec))
    return [
      {
        kind: 'external',
        ecosystem: 'jdk',
        name: spec.split('.').slice(0, 2).join('.'),
        confidence: 0.9,
        how: 'JDK package',
      },
    ];
  const pkg = spec
    .split('.')
    .filter((part, i, all) => !(i === all.length - 1 && /^[A-Z]/.test(part)))
    .join('.');
  return [
    {
      kind: 'external',
      ecosystem: 'java',
      name: pkg || spec,
      confidence: 0.6,
      how: 'not in repository',
    },
  ];
}

function resolveC(ctx: ResolveContext, from: string, imp: ExtractedImport): Resolution[] {
  if (imp.kind === 'include-system') return [{ kind: 'system', name: imp.specifier }];
  const spec = imp.specifier;
  const dir = posix.dirname(from);
  const candidates: (string | undefined)[] = [
    joinClean(dir, spec),
    joinClean(spec),
    joinClean('include', spec),
    joinClean('src', spec),
  ];
  const first = firstExisting(ctx.files, candidates);
  if (first)
    return [
      {
        kind: 'file',
        path: first.path,
        confidence: first.index === 0 ? 1 : 0.9,
        how:
          first.index === 0 ? 'relative to including file' : 'search path (root, include/, src/)',
      },
    ];
  // Walk up the including file's ancestors (covers per-directory include roots).
  let current = dir;
  while (current !== '.' && current !== '') {
    current = posix.dirname(current);
    const hit = joinClean(current === '.' ? '' : current, spec);
    if (hit !== undefined && ctx.files.has(hit))
      return [{ kind: 'file', path: hit, confidence: 0.85, how: 'ancestor directory search' }];
  }
  const base = posix.basename(spec);
  const matches = ctx.basenames.get(base) ?? [];
  if (matches.length === 1 && matches[0] !== undefined)
    return [
      {
        kind: 'file',
        path: matches[0],
        confidence: 0.5,
        how: 'unique file name in repository (include paths unknown)',
      },
    ];
  if (matches.length > 1)
    return [
      {
        kind: 'unresolved',
        reason: `${matches.length} files named ${base}; include search paths are not known`,
      },
    ];
  return [{ kind: 'unresolved', reason: `header ${spec} not found in repository` }];
}

/** Resolve one import to zero or more targets. Never throws. */
export function resolveImport(
  ctx: ResolveContext,
  from: string,
  language: Language,
  imp: ExtractedImport,
): Resolution[] {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return resolveJs(ctx, from, imp);
    case 'python':
      return resolvePython(ctx, from, imp);
    case 'java':
      return resolveJava(ctx, imp);
    case 'c':
    case 'cpp':
      return resolveC(ctx, from, imp);
  }
}
