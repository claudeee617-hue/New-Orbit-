import {
  nodeIdFor,
  type EdgeRecord,
  type JsonValue,
  type NodeRecord,
  type NodeType,
} from '@orbit/core';
import type { GraphStore } from '@orbit/database';
import { traverse } from '@orbit/graph';
import { OrbitError } from '@orbit/shared';

const PAGE = 10_000;

function allNodes(store: GraphStore, repositoryId: string, type: NodeType): NodeRecord[] {
  const out: NodeRecord[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = store.nodes.find(repositoryId, { type, limit: PAGE, offset });
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

function allEdges(store: GraphStore, repositoryId: string, type: EdgeRecord['type']): EdgeRecord[] {
  const out: EdgeRecord[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = store.edges.list(repositoryId, { types: [type], limit: PAGE, offset });
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

const atlasOnly = <T extends { attrs: Record<string, JsonValue> }>(items: T[]): T[] =>
  items.filter((i) => i.attrs['producer'] === 'atlas');
const num = (v: JsonValue | undefined): number => (typeof v === 'number' ? v : 0);
const str = (v: JsonValue | undefined): string => (typeof v === 'string' ? v : '');

function requireRepository(store: GraphStore, repositoryId: string): void {
  if (!store.repositories.get(repositoryId)) {
    throw new OrbitError('NOT_FOUND', `Repository ${repositoryId} is not registered`, {
      details: { repositoryId },
    });
  }
}

// ---------------------------------------------------------------------------------------------

export interface ModuleLink {
  module: string;
  fileImports: number;
  confidence: number | null;
}

export interface ArchitectureModule {
  module: string;
  category: string;
  files: number;
  lines: number;
  languages: Record<string, number>;
  dependsOn: ModuleLink[];
  dependedOnBy: ModuleLink[];
  externalDependencies: string[];
}

export interface ArchitectureMap {
  modules: ArchitectureModule[];
  cycles: string[][];
}

/** Module-level architecture graph (directories and package roots, aggregated from file imports). */
export function buildArchitectureMap(store: GraphStore, repositoryId: string): ArchitectureMap {
  requireRepository(store, repositoryId);
  const modules = atlasOnly(allNodes(store, repositoryId, 'Module'));
  const byId = new Map(modules.map((m) => [m.id, m]));
  const deps = atlasOnly(allEdges(store, repositoryId, 'DEPENDS_ON'));
  const dependencyNodes = new Map(
    allNodes(store, repositoryId, 'Dependency').map((d) => [d.id, d]),
  );
  const out = new Map<string, ModuleLink[]>();
  const incoming = new Map<string, ModuleLink[]>();
  const external = new Map<string, Set<string>>();
  for (const e of deps) {
    const from = byId.get(e.fromId);
    if (!from) continue;
    const to = byId.get(e.toId);
    if (to) {
      const link = { fileImports: num(e.attrs['fileImports']), confidence: e.confidence };
      out.set(from.key, [...(out.get(from.key) ?? []), { module: to.key, ...link }]);
      incoming.set(to.key, [...(incoming.get(to.key) ?? []), { module: from.key, ...link }]);
    } else {
      const dep = dependencyNodes.get(e.toId);
      if (dep)
        external.set(from.key, (external.get(from.key) ?? new Set()).add(str(dep.attrs['name'])));
    }
  }
  const byModule = (a: ModuleLink, b: ModuleLink): number => a.module.localeCompare(b.module);
  const repo = allNodes(store, repositoryId, 'Repository').find(
    (n) => n.attrs['producer'] === 'atlas',
  );
  const cycles = Array.isArray(repo?.attrs['moduleCycles'])
    ? (repo?.attrs['moduleCycles'] as string[][])
    : [];
  return {
    modules: modules
      .map((m) => ({
        module: m.key,
        category: str(m.attrs['category']),
        files: num(m.attrs['files']),
        lines: num(m.attrs['lines']),
        languages: (m.attrs['languages'] ?? {}) as Record<string, number>,
        dependsOn: (out.get(m.key) ?? []).sort(byModule),
        dependedOnBy: (incoming.get(m.key) ?? []).sort(byModule),
        externalDependencies: [...(external.get(m.key) ?? [])].sort(),
      }))
      .sort((a, b) => a.module.localeCompare(b.module)),
    cycles,
  };
}

// ---------------------------------------------------------------------------------------------

export interface SymbolEntry {
  name: string;
  qualifiedName: string;
  kind: string;
  nodeType: string;
  file: string;
  line: number;
  endLine: number;
  exported: boolean;
  complexity: number | null;
}

export interface SymbolQuery {
  name?: string;
  kind?: string;
  file?: string;
  exportedOnly?: boolean;
}

export function symbolIndex(
  store: GraphStore,
  repositoryId: string,
  query: SymbolQuery = {},
): SymbolEntry[] {
  requireRepository(store, repositoryId);
  const entries: SymbolEntry[] = [];
  for (const type of ['Function', 'Class', 'Symbol'] as const) {
    for (const node of atlasOnly(allNodes(store, repositoryId, type))) {
      const location = node.attrs['location'] as Record<string, number> | undefined;
      entries.push({
        name: str(node.attrs['name']),
        qualifiedName: str(node.attrs['qualifiedName']),
        kind: str(node.attrs['kind']),
        nodeType: type,
        file: str(node.attrs['file']),
        line: location?.['startLine'] ?? 0,
        endLine: location?.['endLine'] ?? 0,
        exported: node.attrs['exported'] === true,
        complexity: typeof node.attrs['complexity'] === 'number' ? node.attrs['complexity'] : null,
      });
    }
  }
  return entries
    .filter(
      (e) =>
        (query.name === undefined || e.name === query.name || e.qualifiedName === query.name) &&
        (query.kind === undefined || e.kind === query.kind) &&
        (query.file === undefined || e.file === query.file) &&
        (query.exportedOnly !== true || e.exported),
    )
    .sort(
      (a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file) || a.line - b.line,
    );
}

// ---------------------------------------------------------------------------------------------

export interface ModuleSummary {
  module: string;
  category: string;
  files: number;
  lines: number;
  languages: Record<string, number>;
  symbolsByKind: Record<string, number>;
  /** Exported functions/classes, most complex first (capped). */
  publicSurface: {
    name: string;
    kind: string;
    file: string;
    line: number;
    complexity: number | null;
  }[];
  totalComplexity: number;
  topOwners: { name: string; commits: number }[];
  dependsOn: string[];
  dependedOnBy: string[];
}

export function moduleSummaries(
  store: GraphStore,
  repositoryId: string,
  surfaceLimit = 10,
): ModuleSummary[] {
  const architecture = buildArchitectureMap(store, repositoryId);
  const files = atlasOnly(allNodes(store, repositoryId, 'File'));
  const symbols = symbolIndex(store, repositoryId);
  const filesByModule = new Map<string, NodeRecord[]>();
  for (const f of files)
    filesByModule.set(str(f.attrs['module']), [
      ...(filesByModule.get(str(f.attrs['module'])) ?? []),
      f,
    ]);
  const moduleOfFile = new Map(files.map((f) => [f.key, str(f.attrs['module'])]));
  const symbolsByModule = new Map<string, SymbolEntry[]>();
  for (const s of symbols) {
    const m = moduleOfFile.get(s.file);
    if (m !== undefined) symbolsByModule.set(m, [...(symbolsByModule.get(m) ?? []), s]);
  }
  return architecture.modules.map((m) => {
    const here = symbolsByModule.get(m.module) ?? [];
    const owners = new Map<string, number>();
    for (const f of filesByModule.get(m.module) ?? []) {
      for (const o of (f.attrs['owners'] as { name: string; commits: number }[] | undefined) ?? [])
        owners.set(o.name, (owners.get(o.name) ?? 0) + o.commits);
    }
    return {
      module: m.module,
      category: m.category,
      files: m.files,
      lines: m.lines,
      languages: m.languages,
      symbolsByKind: here.reduce<Record<string, number>>(
        (acc, s) => ({ ...acc, [s.kind]: (acc[s.kind] ?? 0) + 1 }),
        {},
      ),
      publicSurface: here
        .filter((s) => s.exported && s.nodeType !== 'Symbol')
        .sort((a, b) => (b.complexity ?? 0) - (a.complexity ?? 0) || a.name.localeCompare(b.name))
        .slice(0, surfaceLimit)
        .map((s) => ({
          name: s.qualifiedName,
          kind: s.kind,
          file: s.file,
          line: s.line,
          complexity: s.complexity,
        })),
      totalComplexity: (filesByModule.get(m.module) ?? []).reduce(
        (n, f) => n + num(f.attrs['complexity']),
        0,
      ),
      topOwners: [...owners]
        .map(([name, commits]) => ({ name, commits }))
        .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
        .slice(0, 3),
      dependsOn: m.dependsOn.map((d) => d.module),
      dependedOnBy: m.dependedOnBy.map((d) => d.module),
    };
  });
}

// ---------------------------------------------------------------------------------------------

export interface ImpactOptions {
  maxDepth?: number;
  maxNodes?: number;
}

export interface ImpactedFile {
  path: string;
  depth: number;
}

export interface ImpactMap {
  file: string;
  /** Files that import this file directly or transitively (file-level imports). */
  dependents: ImpactedFile[];
  /**
   * Files that import a workspace package containing this file. Coarser than file-level imports:
   * the importer may not use this particular file.
   */
  packageLevelDependents: string[];
  affectedModules: string[];
  tests: { test: string; covers: string; confidence: number | null; reasons: string[] }[];
  truncated: boolean;
}

/** "If I change this file, what else is affected?" Walks reverse imports and test links. */
export function impactMap(
  store: GraphStore,
  repositoryId: string,
  filePath: string,
  options: ImpactOptions = {},
): ImpactMap {
  requireRepository(store, repositoryId);
  const fileId = nodeIdFor(repositoryId, 'File', filePath);
  const start = store.nodes.get(repositoryId, fileId);
  if (!start)
    throw new OrbitError('NOT_FOUND', `File ${filePath} is not in the graph for this repository`, {
      details: { filePath },
    });

  const walk = traverse(store, repositoryId, fileId, {
    direction: 'in',
    types: ['IMPORTS'],
    maxDepth: options.maxDepth ?? 10,
    maxNodes: options.maxNodes ?? 1000,
  });
  const dependents = walk.nodes
    .filter((n) => n.node.type === 'File' && n.depth > 0)
    .map((n) => ({ path: n.node.key, depth: n.depth }));
  const affectedFiles = [filePath, ...dependents.map((d) => d.path)];

  // Package-level importers: modules that contain this file and are imported by other files.
  const packageDependents = new Set<string>();
  for (const module of atlasOnly(allNodes(store, repositoryId, 'Module'))) {
    const prefix = module.key === '.' ? '' : `${module.key}/`;
    if (prefix !== '' && !filePath.startsWith(prefix)) continue;
    for (const edge of store.edges.list(repositoryId, {
      toId: module.id,
      types: ['IMPORTS'],
      limit: PAGE,
    })) {
      const importer = store.nodes.get(repositoryId, edge.fromId);
      if (importer?.type === 'File' && importer.key !== filePath)
        packageDependents.add(importer.key);
    }
  }

  const tests: ImpactMap['tests'] = [];
  for (const path of affectedFiles) {
    const targetId = nodeIdFor(repositoryId, 'File', path);
    for (const edge of store.edges.list(repositoryId, {
      toId: targetId,
      types: ['TESTS'],
      limit: PAGE,
    })) {
      const test = store.nodes.get(repositoryId, edge.fromId);
      if (test)
        tests.push({
          test: test.key,
          covers: path,
          confidence: edge.confidence,
          reasons: (edge.attrs['reasons'] as string[] | undefined) ?? [],
        });
    }
  }
  tests.sort((a, b) => a.test.localeCompare(b.test) || a.covers.localeCompare(b.covers));

  const modules = new Set<string>();
  for (const path of [...affectedFiles, ...packageDependents]) {
    const node = store.nodes.get(repositoryId, nodeIdFor(repositoryId, 'File', path));
    if (node) modules.add(str(node.attrs['module']));
  }
  return {
    file: filePath,
    dependents: dependents.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path)),
    packageLevelDependents: [...packageDependents].sort(),
    affectedModules: [...modules].sort(),
    tests,
    truncated: walk.truncated,
  };
}

// ---------------------------------------------------------------------------------------------

export interface AtlasExport {
  formatVersion: 1;
  repository: { id: string; key: string; displayName: string; attrs: Record<string, JsonValue> };
  evidence: { id: string; status: string; limitations: string[]; commitSha: string | null }[];
  ledger: { entries: number; headHash: string | null };
  modules: ArchitectureModule[];
  files: {
    path: string;
    language: string;
    category: string;
    lines: number;
    complexity: number;
    entryPoint: string[];
    churn: number | null;
    owners: JsonValue;
    module: string;
  }[];
  symbols: SymbolEntry[];
  dependencies: {
    key: string;
    ecosystem: string;
    name: string;
    declaredInManifest: boolean;
    usedInSource: boolean;
  }[];
  relationships: {
    type: string;
    from: string;
    to: string;
    confidence: number | null;
    locations: JsonValue;
    resolution: JsonValue;
  }[];
  tests: { test: string; covers: string; confidence: number | null; reasons: string[] }[];
}

/** Machine-readable export of everything ATLAS knows. Deterministic: same graph, same bytes. */
export function exportAtlas(store: GraphStore, repositoryId: string): AtlasExport {
  const repository = store.repositories.get(repositoryId);
  if (!repository)
    throw new OrbitError('NOT_FOUND', `Repository ${repositoryId} is not registered`, {
      details: { repositoryId },
    });
  const repoNode = allNodes(store, repositoryId, 'Repository').find(
    (n) => n.attrs['producer'] === 'atlas',
  );
  const idToLabel = new Map<string, string>();
  const files = atlasOnly(allNodes(store, repositoryId, 'File'));
  const symbolNodes = (['Function', 'Class', 'Symbol'] as const).flatMap((t) =>
    atlasOnly(allNodes(store, repositoryId, t)),
  );
  const modules = atlasOnly(allNodes(store, repositoryId, 'Module'));
  const deps = atlasOnly(allNodes(store, repositoryId, 'Dependency'));
  const tests = atlasOnly(allNodes(store, repositoryId, 'Test'));
  for (const n of [...files, ...symbolNodes, ...modules, ...deps, ...tests])
    idToLabel.set(n.id, `${n.type}:${n.key}`);

  const relationships: AtlasExport['relationships'] = [];
  for (const type of ['IMPORTS', 'DEPENDS_ON', 'CALLS'] as const) {
    for (const e of atlasOnly(allEdges(store, repositoryId, type))) {
      const from = idToLabel.get(e.fromId);
      const to = idToLabel.get(e.toId);
      if (!from || !to) continue;
      relationships.push({
        type,
        from,
        to,
        confidence: e.confidence,
        locations: e.attrs['locations'] ?? [],
        resolution: e.attrs['resolution'] ?? [],
      });
    }
  }
  relationships.sort(
    (a, b) =>
      a.type.localeCompare(b.type) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );

  const testLinks: AtlasExport['tests'] = [];
  for (const e of atlasOnly(allEdges(store, repositoryId, 'TESTS'))) {
    const from = idToLabel.get(e.fromId);
    const to = idToLabel.get(e.toId);
    if (from && to)
      testLinks.push({
        test: from.slice(from.indexOf(':') + 1),
        covers: to.slice(to.indexOf(':') + 1),
        confidence: e.confidence,
        reasons: (e.attrs['reasons'] as string[] | undefined) ?? [],
      });
  }
  testLinks.sort((a, b) => a.test.localeCompare(b.test) || a.covers.localeCompare(b.covers));

  const evidenceIds = new Set<string>();
  for (const n of [...(repoNode ? [repoNode] : []), ...files.slice(0, 1)])
    evidenceIds.add(n.sourceEvidenceId);
  const head = store.ledger.head(repositoryId);
  return {
    formatVersion: 1,
    repository: {
      id: repository.id,
      key: repository.key,
      displayName: repository.displayName,
      attrs: repoNode?.attrs ?? {},
    },
    evidence: [...evidenceIds].sort().flatMap((id) => {
      const ev = store.evidence.get(repositoryId, id);
      return ev
        ? [{ id, status: ev.status, limitations: ev.limitations, commitSha: ev.commitSha ?? null }]
        : [];
    }),
    ledger: { entries: head?.seq ?? 0, headHash: head?.hash ?? null },
    modules: buildArchitectureMap(store, repositoryId).modules,
    files: files
      .map((f) => ({
        path: f.key,
        language: str(f.attrs['language']),
        category: str(f.attrs['category']),
        lines: num(f.attrs['lines']),
        complexity: num(f.attrs['complexity']),
        entryPoint: (f.attrs['entryPoint'] as string[] | undefined) ?? [],
        churn: typeof f.attrs['churn'] === 'number' ? f.attrs['churn'] : null,
        owners: f.attrs['owners'] ?? [],
        module: str(f.attrs['module']),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    symbols: symbolIndex(store, repositoryId),
    dependencies: deps
      .map((d) => ({
        key: d.key,
        ecosystem: str(d.attrs['ecosystem']),
        name: str(d.attrs['name']),
        declaredInManifest: d.attrs['declaredInManifest'] === true,
        usedInSource: d.attrs['usedInSource'] === true,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    relationships,
    tests: testLinks,
  };
}
