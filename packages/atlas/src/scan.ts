import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  hashArtifact,
  nodeIdFor,
  repositoryIdFor,
  type EdgeType,
  type EvidenceStatus,
  type JsonValue,
  type NodeType,
} from '@orbit/core';
import type { GraphStore } from '@orbit/database';
import { OrbitError } from '@orbit/shared';
import {
  directoryOf,
  findCycles,
  rankHotspots,
  conventionalTargetNames,
  type Hotspot,
} from './analysis.js';
import { ExtractionCache, type CachedFile } from './cache.js';
import { extractFile } from './extract.js';
import { indexGit, summarizeHistory, type FileHistory, type GitIndex } from './git.js';
import { analyzeManifests, type ManifestAnalysis } from './manifests.js';
import { resolveImport, type ResolveContext } from './resolve.js';
import {
  ATLAS_VERSION,
  DEFAULT_SCAN_LIMITS,
  type ExtractedSymbol,
  type FileExtraction,
  type ResolvedScanConfig,
  type ScanConfig,
  type SkippedFile,
  type SourceLocation,
} from './types.js';
import { discoverFiles, readSourceFile, type DiscoveredFile } from './walk.js';

export interface ScanOptions {
  rootPath: string;
  store: GraphStore;
  /** Stable identity of the repository in the graph. Defaults to `local/<folder name>`. */
  repositoryKey?: string;
  /** Directory for the extraction cache. Must be outside the scanned repository. Omit to disable caching. */
  cacheDir?: string;
  config?: ScanConfig;
}

export interface ChangeCounts {
  added: number;
  updated: number;
  unchanged: number;
  retired: number;
}

export interface EntryPoint {
  path: string;
  reasons: string[];
}

export interface ScanResult {
  repositoryId: string;
  repositoryKey: string;
  scanEvidenceId: string;
  gitEvidenceId: string | undefined;
  head: string | undefined;
  stats: {
    filesDiscovered: number;
    filesParsed: number;
    filesFromCache: number;
    filesSkipped: number;
    filesNotParsed: number;
    byLanguage: Record<string, number>;
    byCategory: Record<string, number>;
    symbols: number;
    imports: {
      total: number;
      toFiles: number;
      toModules: number;
      external: number;
      system: number;
      assets: number;
      unresolved: number;
    };
    calls: { total: number; resolved: number; unresolved: number };
    parseErrors: number;
    unsupportedConstructs: Record<string, number>;
    commitsIndexed: number;
  };
  changes: { nodes: ChangeCounts; edges: ChangeCounts };
  analysis: {
    /** Import cycles that exist at runtime (type-only imports excluded). */
    fileCycles: string[][];
    /** Cycles that exist only because of `import type`; erased at compile time. */
    typeOnlyCycles: string[][];
    moduleCycles: string[][];
    entryPoints: EntryPoint[];
    hotspots: Hotspot[];
    frameworks: { name: string; via: string; manifestPath: string }[];
    buildSystems: string[];
    testLinks: number;
  };
  /** Imports that could not be resolved (first 200), with the reason. */
  unresolvedImports: { path: string; specifier: string; reason: string }[];
  skipped: SkippedFile[];
  excludedDirectories: string[];
  limitations: string[];
  durationMs: number;
}

export function resolveConfig(config: ScanConfig = {}): ResolvedScanConfig {
  const positive = (value: number | undefined, fallback: number, name: string): number => {
    const v = value ?? fallback;
    if (!Number.isInteger(v) || v < 1)
      throw new OrbitError('INVALID_INPUT', `${name} must be a positive integer`);
    return v;
  };
  return {
    include: config.include ?? [],
    exclude: config.exclude ?? [],
    noDefaultExcludes: config.noDefaultExcludes ?? false,
    maxFiles: positive(config.maxFiles, DEFAULT_SCAN_LIMITS.maxFiles, 'maxFiles'),
    maxFileBytes: positive(config.maxFileBytes, DEFAULT_SCAN_LIMITS.maxFileBytes, 'maxFileBytes'),
    maxCommits: positive(config.maxCommits, DEFAULT_SCAN_LIMITS.maxCommits, 'maxCommits'),
    skipGit: config.skipGit ?? false,
    skipCalls: config.skipCalls ?? false,
  };
}

interface ParsedFile {
  file: DiscoveredFile;
  hash: string;
  extraction: FileExtraction;
  shebang: boolean;
}

type SymbolNodeType = 'Function' | 'Class' | 'Symbol';

interface SymbolRef {
  filePath: string;
  symbol: ExtractedSymbol;
  nodeType: SymbolNodeType;
  key: string;
  nodeId: string;
}

interface EdgeAcc {
  from: string;
  to: string;
  kinds: Set<string>;
  specifiers: Set<string>;
  names: Set<string>;
  hows: Set<string>;
  locations: { path: string; location: SourceLocation }[];
  occurrences: number;
  confidence: number;
}

const MAX_EDGE_LOCATIONS = 10;

function symbolNodeType(kind: ExtractedSymbol['kind']): SymbolNodeType {
  if (kind === 'function' || kind === 'method') return 'Function';
  if (kind === 'class' || kind === 'interface' || kind === 'struct' || kind === 'enum')
    return 'Class';
  return 'Symbol';
}

function addEdge(
  map: Map<string, EdgeAcc>,
  from: string,
  to: string,
  init: {
    kind: string;
    specifier?: string;
    names?: readonly string[];
    how: string;
    location: { path: string; location: SourceLocation };
    confidence: number;
  },
): void {
  const key = `${from}\u0000${to}`;
  let acc = map.get(key);
  if (!acc) {
    acc = {
      from,
      to,
      kinds: new Set(),
      specifiers: new Set(),
      names: new Set(),
      hows: new Set(),
      locations: [],
      occurrences: 0,
      confidence: 0,
    };
    map.set(key, acc);
  }
  acc.kinds.add(init.kind);
  if (init.specifier !== undefined) acc.specifiers.add(init.specifier);
  for (const n of init.names ?? []) acc.names.add(n);
  acc.hows.add(init.how);
  acc.occurrences += 1;
  if (acc.locations.length < MAX_EDGE_LOCATIONS) acc.locations.push(init.location);
  acc.confidence = Math.max(acc.confidence, init.confidence);
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
const sorted = (set: ReadonlySet<string>): string[] => [...set].sort();

function edgeAttrs(acc: EdgeAcc): Record<string, JsonValue> {
  return {
    producer: 'atlas',
    kinds: sorted(acc.kinds),
    specifiers: sorted(acc.specifiers),
    names: sorted(acc.names).slice(0, 50),
    resolution: sorted(acc.hows),
    occurrences: acc.occurrences,
    locations: acc.locations.map((l) => ({ path: l.path, ...l.location })),
  };
}

function moduleOf(path: string): string {
  return directoryOf(path);
}

function jsonSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function countBy<T>(items: Iterable<T>, key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Common directory prefix length (in segments), used to pick the nearest naming-convention match. */
function sharedPrefix(a: string, b: string): number {
  const x = a.split('/');
  const y = b.split('/');
  let i = 0;
  while (i < x.length - 1 && i < y.length - 1 && x[i] === y[i]) i += 1;
  return i;
}

export async function scanRepository(options: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  let root: string;
  try {
    root = realpathSync(resolve(options.rootPath));
    if (!statSync(root).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new OrbitError('INVALID_INPUT', 'The scan path does not exist or is not a directory', {
      details: { path: options.rootPath },
    });
  }
  const config = resolveConfig(options.config);
  const store = options.store;
  const repositoryKey = options.repositoryKey ?? `local/${basename(root)}`;
  const repositoryId = repositoryIdFor(repositoryKey);
  const limitations: string[] = [];

  // 1. Discovery -----------------------------------------------------------------------------
  const discovery = discoverFiles(root, config);
  const skipped: SkippedFile[] = [...discovery.skipped];
  const maxFilesHit = discovery.skipped.filter((s) => s.reason === 'max-files').length;
  if (maxFilesHit > 0)
    limitations.push(
      `maxFiles (${config.maxFiles}) reached: ${maxFilesHit} further files were not scanned`,
    );
  const symlinks = discovery.skipped.filter((s) => s.reason === 'excluded-symlink').length;
  if (symlinks > 0) limitations.push(`${symlinks} symbolic links were not followed`);

  const readText = (path: string): string | undefined => {
    try {
      return readFileSync(resolve(root, path), 'utf8');
    } catch {
      return undefined;
    }
  };
  const manifests: ManifestAnalysis = analyzeManifests(discovery.files, readText);
  limitations.push(...manifests.limitations);

  // 2. Parse (or reuse cached extraction) ----------------------------------------------------
  const cache = new ExtractionCache(options.cacheDir, repositoryId, !config.skipCalls);
  const nextCache = new Map<string, CachedFile>();
  const parsed = new Map<string, ParsedFile>();
  let fromCache = 0;
  let notParsed = 0;
  for (const file of discovery.files) {
    if (file.language === undefined) continue;
    if (file.category !== 'source' && file.category !== 'test') {
      notParsed += 1;
      continue;
    }
    const read = readSourceFile(root, file, config.maxFileBytes);
    if (!read.ok) {
      skipped.push({ path: file.path, reason: read.reason });
      continue;
    }
    let extraction = cache.get(file.path, read.value.hash);
    if (extraction) fromCache += 1;
    else {
      extraction = await extractFile(file.language, file.path, read.value.content, {
        skipCalls: config.skipCalls,
      });
      if (
        extraction &&
        file.language === 'c' &&
        file.path.toLowerCase().endsWith('.h') &&
        extraction.parseErrors > 0
      ) {
        // A header with C++ syntax: reparse as C++ and keep the cleaner result.
        const retry = await extractFile('cpp', file.path, read.value.content, {
          skipCalls: config.skipCalls,
        });
        if (retry && retry.parseErrors < extraction.parseErrors) extraction = retry;
      }
    }
    if (!extraction) {
      skipped.push({ path: file.path, reason: 'parse-timeout' });
      continue;
    }
    nextCache.set(file.path, { hash: read.value.hash, extraction });
    parsed.set(file.path, {
      file,
      hash: read.value.hash,
      extraction,
      shebang: read.value.content.startsWith('#!'),
    });
  }
  const tooLarge = skipped.filter((s) => s.reason === 'too-large').length;
  if (tooLarge > 0)
    limitations.push(
      `${tooLarge} files exceed maxFileBytes (${config.maxFileBytes}) and were not parsed`,
    );
  const binary = skipped.filter((s) => s.reason === 'binary').length;
  if (binary > 0) limitations.push(`${binary} source-looking files are binary and were not parsed`);
  const timeouts = skipped.filter((s) => s.reason === 'parse-timeout').length;
  if (timeouts > 0)
    limitations.push(`${timeouts} files timed out while parsing and are missing from the graph`);
  if (notParsed > 0)
    limitations.push(
      `${notParsed} vendor or generated source files were classified but not parsed`,
    );

  const parsedPaths = [...parsed.keys()].sort();
  const unsupportedByConstruct: Record<string, number> = {};
  let parseErrors = 0;
  let filesWithParseErrors = 0;
  for (const path of parsedPaths) {
    const e = (parsed.get(path) as ParsedFile).extraction;
    parseErrors += e.parseErrors;
    if (e.parseErrors > 0) filesWithParseErrors += 1;
    for (const u of e.unsupported)
      unsupportedByConstruct[u.construct] = (unsupportedByConstruct[u.construct] ?? 0) + 1;
  }
  if (filesWithParseErrors > 0)
    limitations.push(
      `${filesWithParseErrors} files contain syntax the parser could not fully handle; their symbols and relationships are partial`,
    );
  const unsupportedTotal = Object.entries(unsupportedByConstruct).filter(
    ([k]) => k !== 'syntax-error' && k !== 'truncated',
  );
  if (unsupportedTotal.length > 0) {
    limitations.push(
      `Unsupported constructs were reported (${unsupportedTotal.map(([k, n]) => `${k}: ${n}`).join(', ')}); relationships through them are not in the graph`,
    );
  }

  // 3. Resolve imports -----------------------------------------------------------------------
  const javaClasses = new Map<string, string>();
  const javaPackageDirs = new Map<string, string[]>();
  const basenames = new Map<string, string[]>();
  for (const path of parsedPaths) {
    const { extraction } = parsed.get(path) as ParsedFile;
    if (extraction.language === 'java') {
      const cls = basename(path, '.java');
      javaClasses.set(extraction.packageName ? `${extraction.packageName}.${cls}` : cls, path);
      if (extraction.packageName) {
        const dirs = javaPackageDirs.get(extraction.packageName) ?? [];
        if (!dirs.includes(directoryOf(path))) dirs.push(directoryOf(path));
        javaPackageDirs.set(extraction.packageName, dirs);
      }
    }
    const list = basenames.get(basename(path)) ?? [];
    list.push(path);
    basenames.set(basename(path), list);
  }
  const resolveContext: ResolveContext = {
    files: new Set(parsedPaths),
    allFiles: new Set(discovery.files.map((f) => f.path)),
    workspacePackages: new Map(manifests.workspacePackages.map((p) => [p.name, p.dir])),
    javaClasses,
    javaPackageDirs,
    basenames,
  };

  const fileImportEdges = new Map<string, EdgeAcc>();
  const moduleImportEdges = new Map<string, EdgeAcc>();
  const externalEdges = new Map<string, EdgeAcc>();
  const externalNodes = new Map<
    string,
    { ecosystem: string; name: string; maybeStdlib: boolean }
  >();
  const importStats = {
    total: 0,
    toFiles: 0,
    toModules: 0,
    external: 0,
    system: 0,
    assets: 0,
    unresolved: 0,
  };
  const unresolvedImports: { path: string; specifier: string; reason: string }[] = [];
  const importedNames = new Map<string, Map<string, string>>(); // file → name → target file

  for (const path of parsedPaths) {
    const { extraction } = parsed.get(path) as ParsedFile;
    for (const imp of extraction.imports) {
      importStats.total += 1;
      const at = { path, location: imp.location };
      for (const res of resolveImport(resolveContext, path, extraction.language, imp)) {
        const confidence = round(
          imp.confidence *
            (res.kind === 'file' || res.kind === 'module' || res.kind === 'external'
              ? res.confidence
              : 1),
        );
        if (res.kind === 'file') {
          importStats.toFiles += 1;
          if (res.path === path) continue;
          addEdge(fileImportEdges, path, res.path, {
            kind: imp.kind,
            specifier: imp.specifier,
            names: imp.names,
            how: res.how,
            location: at,
            confidence,
          });
          const names = importedNames.get(path) ?? new Map<string, string>();
          for (const n of imp.names) if (n !== '*') names.set(n, res.path);
          importedNames.set(path, names);
        } else if (res.kind === 'module') {
          importStats.toModules += 1;
          addEdge(moduleImportEdges, path, res.dir, {
            kind: imp.kind,
            specifier: imp.specifier,
            names: imp.names,
            how: res.how,
            location: at,
            confidence,
          });
        } else if (res.kind === 'external') {
          importStats.external += 1;
          const dependencyKey = `${res.ecosystem}:${res.name}`;
          externalNodes.set(dependencyKey, {
            ecosystem: res.ecosystem,
            name: res.name,
            maybeStdlib: res.ecosystem === 'pypi' || res.ecosystem === 'java',
          });
          addEdge(externalEdges, path, dependencyKey, {
            kind: imp.kind,
            specifier: imp.specifier,
            names: imp.names,
            how: res.how,
            location: at,
            confidence,
          });
        } else if (res.kind === 'system') {
          importStats.system += 1;
        } else if (res.kind === 'asset') {
          importStats.assets += 1;
        } else {
          importStats.unresolved += 1;
          unresolvedImports.push({ path, specifier: imp.specifier, reason: res.reason });
        }
      }
    }
  }
  if (importStats.unresolved > 0)
    limitations.push(
      `${importStats.unresolved} imports could not be resolved to a file in the repository (for example path aliases or missing include paths)`,
    );

  // 4. Symbols and calls ---------------------------------------------------------------------
  const symbolsByFile = new Map<string, SymbolRef[]>();
  const exportedByName = new Map<string, SymbolRef[]>();
  const allSymbols: SymbolRef[] = [];
  for (const path of parsedPaths) {
    const { extraction } = parsed.get(path) as ParsedFile;
    const seen = new Map<string, number>();
    const refs: SymbolRef[] = [];
    for (const symbol of extraction.symbols) {
      const nodeType = symbolNodeType(symbol.kind);
      const base = `${path}#${symbol.qualifiedName}`;
      const n = (seen.get(`${nodeType}|${base}`) ?? 0) + 1;
      seen.set(`${nodeType}|${base}`, n);
      const key = n === 1 ? base : `${base}~${n}`;
      const ref: SymbolRef = {
        filePath: path,
        symbol,
        nodeType,
        key,
        nodeId: nodeIdFor(repositoryId, nodeType, key),
      };
      refs.push(ref);
      allSymbols.push(ref);
      if (symbol.exported && nodeType !== 'Symbol') {
        const list = exportedByName.get(symbol.name) ?? [];
        list.push(ref);
        exportedByName.set(symbol.name, list);
      }
    }
    symbolsByFile.set(path, refs);
  }

  const callEdges = new Map<string, EdgeAcc>();
  const callStats = { total: 0, resolved: 0, unresolved: 0 };
  const callable = (r: SymbolRef): boolean => r.nodeType !== 'Symbol';
  for (const path of parsedPaths) {
    const { extraction } = parsed.get(path) as ParsedFile;
    const local = symbolsByFile.get(path) ?? [];
    for (const call of extraction.calls) {
      callStats.total += 1;
      if (call.enclosing === undefined) {
        // Rules only allow CALLS between callable symbols, so top-level calls are not edges.
        continue;
      }
      const caller = local.find((r) => r.symbol.qualifiedName === call.enclosing && callable(r));
      if (!caller) {
        callStats.unresolved += 1;
        continue;
      }
      let target: SymbolRef | undefined;
      let how = '';
      let confidence = 0;
      const plain =
        call.receiver === undefined || call.receiver === 'this' || call.receiver === 'self';
      if (plain) {
        const matches = local.filter(
          (r) => callable(r) && r.symbol.name === call.callee && r !== caller,
        );
        const scoped =
          call.receiver === undefined
            ? matches
            : matches.filter((r) =>
                r.symbol.qualifiedName.startsWith(
                  `${call.enclosing?.split('.').slice(0, -1).join('.') ?? ''}.`,
                ),
              );
        const pick = scoped.length === 1 ? scoped : matches;
        if (pick.length === 1) {
          target = pick[0];
          how = 'same-file name match';
          confidence = call.receiver === undefined ? 0.9 : 0.85;
        }
      }
      if (!target && call.receiver === undefined) {
        const importedFrom = importedNames.get(path)?.get(call.callee);
        if (importedFrom) {
          const hits = (symbolsByFile.get(importedFrom) ?? []).filter(
            (r) => callable(r) && r.symbol.name === call.callee && r.symbol.exported,
          );
          if (hits.length === 1) {
            target = hits[0];
            how = 'imported name';
            confidence = 0.8;
          }
        }
      }
      if (!target && call.callee.length >= 3) {
        const hits = (exportedByName.get(call.callee) ?? []).filter((r) => r.filePath !== path);
        if (hits.length === 1) {
          target = hits[0];
          how = 'unique exported name in repository (heuristic)';
          confidence = call.receiver === undefined ? 0.4 : 0.3;
        }
      }
      if (!target || target.nodeId === caller.nodeId) {
        callStats.unresolved += 1;
        continue;
      }
      callStats.resolved += 1;
      addEdge(callEdges, caller.nodeId, target.nodeId, {
        kind: 'call',
        names: [call.callee],
        how,
        location: { path, location: call.location },
        confidence,
      });
    }
  }

  // 5. Modules, dependency graph, cycles -----------------------------------------------------
  const moduleDirs = new Set<string>(parsedPaths.map(moduleOf));
  for (const p of manifests.workspacePackages) moduleDirs.add(p.dir === '' ? '.' : p.dir);
  for (const d of manifests.dependencies) moduleDirs.add(directoryOf(d.manifestPath));
  const moduleKey = (dir: string): string => (dir === '' ? '.' : dir);

  const runtimeAdjacency = new Map<string, string[]>(parsedPaths.map((p) => [p, []]));
  const fullAdjacency = new Map<string, string[]>(parsedPaths.map((p) => [p, []]));
  for (const acc of fileImportEdges.values()) {
    fullAdjacency.get(acc.from)?.push(acc.to);
    if (![...acc.kinds].every((k) => k === 'type')) runtimeAdjacency.get(acc.from)?.push(acc.to);
  }
  const fileCycles = findCycles(runtimeAdjacency);
  const runtimeKeys = new Set(fileCycles.map((c) => c.join('\u0000')));
  const typeOnlyCycles = findCycles(fullAdjacency).filter(
    (cycle) => !runtimeKeys.has(cycle.join('\u0000')),
  );

  const moduleDeps = new Map<string, EdgeAcc>();
  for (const acc of fileImportEdges.values()) {
    const a = moduleOf(acc.from);
    const b = moduleOf(acc.to);
    if (a !== b)
      addEdge(moduleDeps, a, b, {
        kind: 'import',
        how: 'aggregated from file imports',
        location: acc.locations[0] ?? {
          path: acc.from,
          location: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 0 },
        },
        confidence: acc.confidence,
      });
  }
  for (const acc of moduleImportEdges.values()) {
    const a = moduleOf(acc.from);
    const b = moduleKey(acc.to);
    if (a !== b)
      addEdge(moduleDeps, a, b, {
        kind: 'import',
        how: 'aggregated from workspace package imports',
        location: acc.locations[0] ?? {
          path: acc.from,
          location: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 0 },
        },
        confidence: acc.confidence,
      });
  }
  const moduleAdjacency = new Map<string, string[]>([...moduleDirs].map((d) => [moduleKey(d), []]));
  for (const acc of moduleDeps.values()) moduleAdjacency.get(acc.from)?.push(acc.to);
  const moduleCycles = findCycles(moduleAdjacency);

  // 6. Entry points --------------------------------------------------------------------------
  const entryReasons = new Map<string, Set<string>>();
  const noteEntry = (path: string, reason: string): void => {
    if (!parsed.has(path)) return;
    const set = entryReasons.get(path) ?? new Set<string>();
    set.add(reason);
    entryReasons.set(path, set);
  };
  for (const [path, p] of parsed) {
    if (p.file.category !== 'source') continue;
    for (const reason of p.extraction.entryPointReasons) noteEntry(path, reason);
    if (p.shebang) noteEntry(path, 'shebang line');
    if (basename(path) === '__main__.py') noteEntry(path, 'python package __main__');
  }
  for (const e of manifests.declaredEntryPoints) noteEntry(e.path, e.reason);
  const entryPoints: EntryPoint[] = [...entryReasons]
    .map(([path, reasons]) => ({ path, reasons: sorted(reasons) }))
    .sort((a, b) => a.path.localeCompare(b.path));

  // 7. Test mapping --------------------------------------------------------------------------
  interface TestLink {
    test: string;
    target: string;
    confidence: number;
    reasons: Set<string>;
    locations: { path: string; location: SourceLocation }[];
  }
  const testLinks = new Map<string, TestLink>();
  const testFiles = parsedPaths.filter(
    (p) => (parsed.get(p) as ParsedFile).file.category === 'test',
  );
  const sourceFiles = parsedPaths.filter(
    (p) => (parsed.get(p) as ParsedFile).file.category === 'source',
  );
  const linkTest = (
    test: string,
    target: string,
    confidence: number,
    reason: string,
    location?: { path: string; location: SourceLocation },
  ): void => {
    const key = `${test}\u0000${target}`;
    const link = testLinks.get(key) ?? {
      test,
      target,
      confidence: 0,
      reasons: new Set<string>(),
      locations: [],
    };
    link.confidence = Math.max(link.confidence, confidence);
    link.reasons.add(reason);
    if (location && link.locations.length < MAX_EDGE_LOCATIONS) link.locations.push(location);
    testLinks.set(key, link);
  };
  for (const acc of fileImportEdges.values()) {
    if (
      (parsed.get(acc.from) as ParsedFile).file.category === 'test' &&
      (parsed.get(acc.to) as ParsedFile).file.category === 'source'
    ) {
      linkTest(acc.from, acc.to, acc.confidence, 'test file imports this file', acc.locations[0]);
    }
  }
  const sourcesByStem = new Map<string, string[]>();
  for (const s of sourceFiles) {
    const stem = basename(s).replace(/\.[^.]+$/, '');
    const list = sourcesByStem.get(stem) ?? [];
    list.push(s);
    sourcesByStem.set(stem, list);
  }
  let ambiguousTestNames = 0;
  for (const test of testFiles) {
    for (const name of conventionalTargetNames(test)) {
      const candidates = sourcesByStem.get(name) ?? [];
      if (candidates.length === 0) continue;
      const best = Math.max(...candidates.map((c) => sharedPrefix(test, c)));
      const nearest = candidates.filter((c) => sharedPrefix(test, c) === best);
      if (nearest.length === 1 && nearest[0] !== undefined)
        linkTest(test, nearest[0], 0.6, 'file naming convention');
      else ambiguousTestNames += 1;
    }
  }
  if (ambiguousTestNames > 0)
    limitations.push(
      `${ambiguousTestNames} test files matched several source files by name and were not linked by convention`,
    );

  // 8. Git history ---------------------------------------------------------------------------
  let git: GitIndex = {
    available: false,
    head: undefined,
    commits: [],
    truncated: false,
    shallow: false,
    limitations: [],
  };
  if (config.skipGit)
    limitations.push(
      'Git history indexing was disabled; churn, ownership and commit links were not measured',
    );
  else {
    git = await indexGit(root, config.maxCommits);
    limitations.push(...git.limitations);
  }
  const history: Map<string, FileHistory> = summarizeHistory(git.commits);
  const hotspots = rankHotspots(
    parsedPaths.map((p) => ({
      path: p,
      complexity: (parsed.get(p) as ParsedFile).extraction.complexity,
      churn: git.commits.length > 0 ? (history.get(p)?.churn ?? 0) : undefined,
    })),
    20,
  );

  // 9. Evidence ------------------------------------------------------------------------------
  const scanHash = hashArtifact(
    JSON.stringify({
      atlas: ATLAS_VERSION,
      config,
      files: parsedPaths.map((p) => [p, (parsed.get(p) as ParsedFile).hash]),
      manifests: manifests.dependencies.map((d) => [
        d.manifestPath,
        d.ecosystem,
        d.name,
        d.versionSpec,
        d.scope,
      ]),
    }),
  );
  const MAX_MODIFIES = 20_000;
  const modifiesCandidates = git.commits.reduce(
    (n, c) => n + c.files.filter((f) => parsed.has(f.path)).length,
    0,
  );
  if (modifiesCandidates > MAX_MODIFIES)
    limitations.push(
      `Commit-to-file links were capped at ${MAX_MODIFIES} of ${modifiesCandidates}; some MODIFIES edges are not in the graph`,
    );
  const partialReasons = limitations.length > 0;
  let status: EvidenceStatus = partialReasons ? 'PARTIAL' : 'PASS';
  const evidenceLimitations = limitations.map((l) => l.slice(0, 1000)).slice(0, 50);
  if (parsedPaths.length === 0) {
    status = 'INCOMPLETE';
    evidenceLimitations.unshift(
      'No supported source files were parsed, so the graph has no code facts for this scan',
    );
  }

  const stats: ScanResult['stats'] = {
    filesDiscovered: discovery.files.length,
    filesParsed: parsed.size,
    filesFromCache: fromCache,
    filesSkipped: skipped.length,
    filesNotParsed: notParsed,
    byLanguage: countBy(parsed.values(), (p) => p.extraction.language),
    byCategory: countBy(discovery.files, (f) => f.category),
    symbols: allSymbols.length,
    imports: importStats,
    calls: callStats,
    parseErrors,
    unsupportedConstructs: Object.fromEntries(
      Object.entries(unsupportedByConstruct).sort(([a], [b]) => a.localeCompare(b)),
    ),
    commitsIndexed: git.commits.length,
  };

  // 10. Write to the graph, atomically -------------------------------------------------------
  const nodeChanges: ChangeCounts = { added: 0, updated: 0, unchanged: 0, retired: 0 };
  const edgeChanges: ChangeCounts = { added: 0, updated: 0, unchanged: 0, retired: 0 };
  const desiredNodes = new Set<string>();
  const desiredEdges = new Set<string>();
  let scanEvidenceId = '';
  let gitEvidenceId: string | undefined;

  store.transaction(() => {
    store.repositories.register({ key: repositoryKey, displayName: basename(root) });
    scanEvidenceId = store.evidence.append({
      repositoryId,
      source: `atlas:${ATLAS_VERSION}`,
      sourceType: 'parser',
      ...(git.head !== undefined && { commitSha: git.head }),
      contentHash: scanHash,
      status,
      limitations: evidenceLimitations,
      relatedEntityIds: [],
    }).record.id;

    if (git.available && git.head !== undefined && git.commits.length > 0) {
      gitEvidenceId = store.evidence.append({
        repositoryId,
        source: 'git:log',
        sourceType: 'git',
        commitSha: git.head,
        contentHash: hashArtifact(git.commits.map((c) => c.sha).join('\n')),
        status: git.truncated || git.shallow ? 'PARTIAL' : 'PASS',
        limitations: git.limitations.slice(0, 50),
        relatedEntityIds: [],
      }).record.id;
    }

    const putNode = (
      type: NodeType,
      key: string,
      attrs: Record<string, JsonValue>,
      evidenceId: string,
    ): string => {
      const result = store.nodes.upsert({
        repositoryId,
        type,
        key,
        attrs,
        sourceEvidenceId: evidenceId,
      });
      desiredNodes.add(result.record.id);
      if (!result.changed) nodeChanges.unchanged += 1;
      else if (result.record.version === 1) nodeChanges.added += 1;
      else nodeChanges.updated += 1;
      return result.record.id;
    };
    const putEdge = (
      type: EdgeType,
      fromId: string,
      toId: string,
      confidence: number | undefined,
      attrs: Record<string, JsonValue>,
    ): void => {
      const result = store.edges.upsert({
        repositoryId,
        type,
        fromId,
        toId,
        ...(confidence !== undefined && {
          confidence: round(Math.min(1, Math.max(0, confidence))),
        }),
        attrs,
        sourceEvidenceId: scanEvidenceId,
      });
      desiredEdges.add(result.record.id);
      if (!result.changed) edgeChanges.unchanged += 1;
      else if (result.record.version === 1) edgeChanges.added += 1;
      else edgeChanges.updated += 1;
    };

    // Directory category = most common file category in the directory.
    const dirCategories = new Map<string, Map<string, number>>();
    for (const f of discovery.files) {
      const d = directoryOf(f.path);
      const m = dirCategories.get(d) ?? new Map<string, number>();
      m.set(f.category, (m.get(f.category) ?? 0) + 1);
      dirCategories.set(d, m);
    }
    const dirCategory = (dir: string): string => {
      const m = dirCategories.get(dir);
      if (!m) return 'other';
      return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'other';
    };

    // Repository summary node
    const cyclesForNode = (cycles: string[][]): string[][] =>
      cycles.slice(0, 25).map((c) => c.slice(0, 25));
    const repoAttrs: Record<string, JsonValue> = {
      producer: 'atlas',
      atlasVersion: ATLAS_VERSION,
      languages: stats.byLanguage,
      categories: stats.byCategory,
      frameworks: manifests.frameworks.map((f) => ({
        name: f.name,
        via: f.via,
        manifest: f.manifestPath,
      })),
      buildSystems: manifests.buildSystems,
      fileCycles: cyclesForNode(fileCycles),
      typeOnlyCycles: cyclesForNode(typeOnlyCycles),
      moduleCycles: cyclesForNode(moduleCycles),
      entryPoints: entryPoints.slice(0, 100).map((e) => ({ path: e.path, reasons: e.reasons })),
      hotspots: hotspots.map((h) => ({
        path: h.path,
        complexity: h.complexity,
        churn: h.churn ?? null,
        score: h.score,
      })),
      churnMeasured: git.commits.length > 0,
    };
    while (
      jsonSize(repoAttrs) > 60 * 1024 &&
      (repoAttrs['entryPoints'] as JsonValue[]).length > 0
    ) {
      repoAttrs['entryPoints'] = (repoAttrs['entryPoints'] as JsonValue[]).slice(
        0,
        Math.floor((repoAttrs['entryPoints'] as JsonValue[]).length / 2),
      );
    }
    putNode('Repository', repositoryKey, repoAttrs, scanEvidenceId);

    // Modules
    const moduleIds = new Map<string, string>();
    for (const dir of [...moduleDirs].sort()) {
      const key = moduleKey(dir);
      const filesHere = parsedPaths.filter((p) => moduleOf(p) === key);
      moduleIds.set(
        key,
        putNode(
          'Module',
          key,
          {
            producer: 'atlas',
            category: dirCategory(key),
            files: filesHere.length,
            lines: filesHere.reduce(
              (n, p) => n + (parsed.get(p) as ParsedFile).extraction.lines,
              0,
            ),
            languages: countBy(filesHere, (p) => (parsed.get(p) as ParsedFile).extraction.language),
          },
          scanEvidenceId,
        ),
      );
    }

    // Files
    const fileIds = new Map<string, string>();
    for (const path of parsedPaths) {
      const p = parsed.get(path) as ParsedFile;
      const h = history.get(path);
      const attrs: Record<string, JsonValue> = {
        producer: 'atlas',
        language: p.extraction.language,
        category: p.file.category,
        size: p.file.size,
        lines: p.extraction.lines,
        contentHash: p.hash,
        module: moduleOf(path),
        complexity: p.extraction.complexity,
        symbols: p.extraction.symbols.length,
        parseErrors: p.extraction.parseErrors,
        unsupported: p.extraction.unsupported.length,
        entryPoint: sorted(entryReasons.get(path) ?? new Set<string>()),
      };
      if (h) {
        attrs['churn'] = h.churn;
        attrs['linesAdded'] = h.additions;
        attrs['linesDeleted'] = h.deletions;
        attrs['owners'] = h.owners.map((o) => ({
          name: o.name,
          commits: o.commits,
          share: o.share,
        }));
        if (h.lastCommitDate) attrs['lastCommitDate'] = h.lastCommitDate;
      } else if (git.commits.length > 0) {
        attrs['churn'] = 0;
      }
      fileIds.set(path, putNode('File', path, attrs, scanEvidenceId));
    }

    // Symbols
    for (const ref of allSymbols) {
      putNode(
        ref.nodeType,
        ref.key,
        {
          producer: 'atlas',
          file: ref.filePath,
          name: ref.symbol.name,
          qualifiedName: ref.symbol.qualifiedName,
          kind: ref.symbol.kind,
          exported: ref.symbol.exported,
          ...(ref.symbol.complexity !== undefined && { complexity: ref.symbol.complexity }),
          location: { ...ref.symbol.location },
        },
        scanEvidenceId,
      );
    }

    // Test nodes
    const testIds = new Map<string, string>();
    for (const path of testFiles) {
      testIds.set(
        path,
        putNode(
          'Test',
          path,
          {
            producer: 'atlas',
            file: path,
            language: (parsed.get(path) as ParsedFile).extraction.language,
          },
          scanEvidenceId,
        ),
      );
    }

    // Dependencies (declared and observed)
    interface DepInfo {
      ecosystem: string;
      name: string;
      declared: { manifest: string; versionSpec: string; scope: string }[];
      maybeStdlib: boolean;
    }
    const deps = new Map<string, DepInfo>();
    for (const d of manifests.dependencies) {
      const key = `${d.ecosystem}:${d.name}`;
      const info = deps.get(key) ?? {
        ecosystem: d.ecosystem,
        name: d.name,
        declared: [],
        maybeStdlib: false,
      };
      info.declared.push({ manifest: d.manifestPath, versionSpec: d.versionSpec, scope: d.scope });
      deps.set(key, info);
    }
    for (const [key, ext] of externalNodes) {
      const info = deps.get(key) ?? {
        ecosystem: ext.ecosystem,
        name: ext.name,
        declared: [],
        maybeStdlib: ext.maybeStdlib,
      };
      deps.set(key, info);
    }
    const depIds = new Map<string, string>();
    for (const [key, info] of [...deps].sort(([a], [b]) => a.localeCompare(b))) {
      depIds.set(
        key,
        putNode(
          'Dependency',
          key,
          {
            producer: 'atlas',
            ecosystem: info.ecosystem,
            name: info.name,
            declared: info.declared.slice(0, 50),
            usedInSource: externalNodes.has(key),
            declaredInManifest: info.declared.length > 0,
            ...(info.maybeStdlib &&
              info.declared.length === 0 && {
                note: 'Not declared in a manifest: third-party or standard library',
              }),
          },
          scanEvidenceId,
        ),
      );
    }

    // Commits (history facts: never retired)
    const commitIds = new Map<string, string>();
    if (gitEvidenceId !== undefined) {
      for (const c of git.commits) {
        commitIds.set(
          c.sha,
          putNode(
            'Commit',
            c.sha,
            {
              producer: 'atlas',
              author: c.authorName,
              date: c.date,
              subject: c.subject,
              files: c.files.length,
            },
            gitEvidenceId,
          ),
        );
      }
    }

    // ---- Edges ----
    for (const acc of [...fileImportEdges.values()].sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
    )) {
      putEdge(
        'IMPORTS',
        fileIds.get(acc.from) as string,
        fileIds.get(acc.to) as string,
        acc.confidence,
        edgeAttrs(acc),
      );
    }
    for (const acc of [...moduleImportEdges.values()].sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
    )) {
      const to = moduleIds.get(moduleKey(acc.to));
      if (to)
        putEdge('IMPORTS', fileIds.get(acc.from) as string, to, acc.confidence, edgeAttrs(acc));
    }
    for (const acc of [...externalEdges.values()].sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
    )) {
      putEdge(
        'IMPORTS',
        fileIds.get(acc.from) as string,
        depIds.get(acc.to) as string,
        acc.confidence,
        edgeAttrs(acc),
      );
    }
    for (const acc of [...moduleDeps.values()].sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
    )) {
      const from = moduleIds.get(acc.from);
      const to = moduleIds.get(acc.to);
      if (from && to)
        putEdge('DEPENDS_ON', from, to, acc.confidence, {
          ...edgeAttrs(acc),
          derived: 'aggregated from file imports',
          fileImports: acc.occurrences,
        });
    }
    for (const d of manifests.dependencies) {
      const from = moduleIds.get(moduleKey(directoryOf(d.manifestPath)));
      const to = depIds.get(`${d.ecosystem}:${d.name}`);
      if (from && to) {
        putEdge('DEPENDS_ON', from, to, 1, {
          producer: 'atlas',
          manifest: d.manifestPath,
          versionSpec: d.versionSpec,
          scope: d.scope,
        });
      }
    }
    for (const acc of [...callEdges.values()].sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
    )) {
      putEdge('CALLS', acc.from, acc.to, acc.confidence, {
        ...edgeAttrs(acc),
        heuristic: acc.confidence < 0.8,
      });
    }
    for (const link of [...testLinks.values()].sort(
      (a, b) => a.test.localeCompare(b.test) || a.target.localeCompare(b.target),
    )) {
      putEdge(
        'TESTS',
        testIds.get(link.test) as string,
        fileIds.get(link.target) as string,
        link.confidence,
        {
          producer: 'atlas',
          reasons: sorted(link.reasons),
          locations: link.locations.map((l) => ({ path: l.path, ...l.location })),
        },
      );
    }
    if (gitEvidenceId !== undefined) {
      let modifies = 0;
      for (const c of git.commits) {
        for (const f of c.files) {
          const fileId = fileIds.get(f.path);
          if (!fileId || modifies >= MAX_MODIFIES) continue;
          modifies += 1;
          const result = store.edges.upsert({
            repositoryId,
            type: 'MODIFIES',
            fromId: commitIds.get(c.sha) as string,
            toId: fileId,
            confidence: 1,
            attrs: { producer: 'atlas', additions: f.additions, deletions: f.deletions },
            sourceEvidenceId: gitEvidenceId,
          });
          desiredEdges.add(result.record.id);
          if (!result.changed) edgeChanges.unchanged += 1;
          else if (result.record.version === 1) edgeChanges.added += 1;
          else edgeChanges.updated += 1;
        }
      }
    }

    // ---- Retire what ATLAS wrote earlier but no longer observes ----
    // Edges first: once a node is retired its edges disappear from the current view.
    const RETIRE_EDGE_TYPES: EdgeType[] = ['IMPORTS', 'CALLS', 'DEPENDS_ON', 'TESTS'];
    for (let offset = 0; ;) {
      const page = store.edges.list(repositoryId, {
        types: RETIRE_EDGE_TYPES,
        limit: 10_000,
        offset,
      });
      for (const edge of page) {
        if (edge.attrs['producer'] === 'atlas' && !desiredEdges.has(edge.id)) {
          if (
            store.edges.retire({ repositoryId, edgeId: edge.id, sourceEvidenceId: scanEvidenceId })
              .changed
          )
            edgeChanges.retired += 1;
        }
      }
      if (page.length < 10_000) break;
      // Retiring shrinks the view, so only advance past rows that were kept.
      offset += page.filter(
        (e) => desiredEdges.has(e.id) || e.attrs['producer'] !== 'atlas',
      ).length;
    }
    const RETIRE_NODE_TYPES: NodeType[] = [
      'File',
      'Function',
      'Class',
      'Symbol',
      'Module',
      'Test',
      'Dependency',
    ];
    for (const type of RETIRE_NODE_TYPES) {
      for (let offset = 0; ;) {
        const page = store.nodes.find(repositoryId, { type, limit: 10_000, offset });
        for (const node of page) {
          if (node.attrs['producer'] === 'atlas' && !desiredNodes.has(node.id)) {
            if (
              store.nodes.retire({
                repositoryId,
                nodeId: node.id,
                sourceEvidenceId: scanEvidenceId,
              }).changed
            )
              nodeChanges.retired += 1;
          }
        }
        if (page.length < 10_000) break;
        offset += page.filter(
          (n) => desiredNodes.has(n.id) || n.attrs['producer'] !== 'atlas',
        ).length;
      }
    }
  });

  // Cache is written only after the graph commit succeeded.
  cache.replaceWith(nextCache);
  try {
    cache.save();
  } catch {
    limitations.push(
      'The extraction cache could not be written; the next scan will re-parse every file',
    );
  }

  const frameworks = manifests.frameworks.map((f) => ({
    name: f.name,
    via: f.via,
    manifestPath: f.manifestPath,
  }));
  return {
    repositoryId,
    repositoryKey,
    scanEvidenceId,
    gitEvidenceId,
    head: git.head,
    stats,
    changes: { nodes: nodeChanges, edges: edgeChanges },
    analysis: {
      fileCycles,
      typeOnlyCycles,
      moduleCycles,
      entryPoints,
      hotspots,
      frameworks,
      buildSystems: manifests.buildSystems,
      testLinks: testLinks.size,
    },
    unresolvedImports: unresolvedImports.slice(0, 200),
    skipped,
    excludedDirectories: discovery.excludedDirectories,
    limitations,
    durationMs: Date.now() - started,
  };
}
