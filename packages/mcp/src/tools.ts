import {
  buildArchitectureMap,
  checkStaleness,
  findConflicts,
  impactMap,
  moduleSummaries,
  searchMemory,
  MEMORY_CATEGORIES,
  type MemoryItem,
} from '@orbit/atlas';
import { nodeIdFor, type EdgeRecord, type NodeRecord } from '@orbit/core';
import { neighbors } from '@orbit/graph';
import { OrbitError, normalizeRepoRelativePath } from '@orbit/shared';
import { z } from 'zod';
import type { EvidenceSummary, OrbitContext } from './context.js';
import { summarise } from './context.js';

/** Hard caps so a tool result can never flood the model's context. */
export const LIMITS = { defaultResults: 20, maxResults: 100, maxChars: 60_000 } as const;
const PAGE = 5000;

const repository = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe('Repository key. Only needed when several repositories were scanned.');
const limit = z
  .number()
  .int()
  .min(1)
  .max(LIMITS.maxResults)
  .optional()
  .describe(`Maximum results (default ${LIMITS.defaultResults}, max ${LIMITS.maxResults}).`);
const text = (max = 300) => z.string().trim().min(1).max(max);
const repoPath = text(1024).describe('Repository-relative file path, e.g. src/index.ts');

export interface ToolResult {
  /** Everything except the envelope fields below. */
  data: Record<string, unknown>;
  /** Evidence ids behind the data. */
  evidenceIds?: Iterable<string>;
  truncated?: boolean;
  notes?: string[];
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  run(ctx: OrbitContext, args: Record<string, unknown>): ToolResult;
}

function define<S extends z.ZodRawShape>(def: {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  run: (ctx: OrbitContext, args: z.infer<z.ZodObject<S>>) => ToolResult;
}): ToolDefinition {
  return def as unknown as ToolDefinition;
}

// ---- shared helpers --------------------------------------------------------------------------

function pageAll(fetch: (limit: number, offset: number) => NodeRecord[]): NodeRecord[] {
  const out: NodeRecord[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = fetch(PAGE, offset);
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

function atlasNodes(
  ctx: OrbitContext,
  repositoryId: string,
  type: NodeRecord['type'],
): NodeRecord[] {
  return pageAll((l, o) =>
    ctx.store.nodes.find(repositoryId, { type, limit: l, offset: o }),
  ).filter((n) => n.attrs['producer'] === 'atlas');
}

function cleanPath(input: string): string {
  try {
    return normalizeRepoRelativePath(input);
  } catch (error) {
    throw new OrbitError(
      'INVALID_INPUT',
      `Invalid path "${input.slice(0, 80)}": ${(error as Error).message}`,
    );
  }
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

interface SymbolView {
  id: string;
  name: string;
  qualifiedName: string;
  kind: string;
  nodeType: string;
  file: string;
  line: number;
  endLine: number;
  exported: boolean;
  complexity: number | null;
  evidenceId: string;
}

function symbolView(node: NodeRecord): SymbolView {
  const loc = node.attrs['location'] as Record<string, number> | undefined;
  return {
    id: node.key,
    name: str(node.attrs['name']),
    qualifiedName: str(node.attrs['qualifiedName']),
    kind: str(node.attrs['kind']),
    nodeType: node.type,
    file: str(node.attrs['file']) || node.key.split('#')[0] || '',
    line: loc?.['startLine'] ?? 0,
    endLine: loc?.['endLine'] ?? 0,
    exported: node.attrs['exported'] === true,
    complexity: typeof node.attrs['complexity'] === 'number' ? node.attrs['complexity'] : null,
    evidenceId: node.sourceEvidenceId,
  };
}

function allSymbols(ctx: OrbitContext, repositoryId: string): NodeRecord[] {
  return (['Function', 'Class', 'Symbol'] as const).flatMap((t) =>
    atlasNodes(ctx, repositoryId, t),
  );
}

type Resolved =
  { kind: 'found'; node: NodeRecord } | { kind: 'ambiguous'; candidates: SymbolView[] };

/** `path#qualifiedName` resolves exactly; a bare name (optionally with `file`) may be ambiguous. */
function resolveSymbol(
  ctx: OrbitContext,
  repositoryId: string,
  symbol: string,
  file?: string,
): Resolved {
  if (symbol.includes('#')) {
    for (const type of ['Function', 'Class', 'Symbol'] as const) {
      const node = ctx.store.nodes.get(repositoryId, nodeIdFor(repositoryId, type, symbol));
      if (node) return { kind: 'found', node };
    }
  }
  const wantedFile = file === undefined ? undefined : cleanPath(file);
  const matches = allSymbols(ctx, repositoryId).filter((n) => {
    const v = symbolView(n);
    return (
      (v.name === symbol || v.qualifiedName === symbol) &&
      (wantedFile === undefined || v.file === wantedFile)
    );
  });
  if (matches.length === 1 && matches[0]) return { kind: 'found', node: matches[0] };
  if (matches.length > 1) {
    return { kind: 'ambiguous', candidates: matches.map(symbolView).sort(bySymbol).slice(0, 10) };
  }
  const needle = symbol.toLowerCase();
  const near = allSymbols(ctx, repositoryId)
    .map(symbolView)
    .filter((s) => s.qualifiedName.toLowerCase().includes(needle))
    .sort(bySymbol)
    .slice(0, 5)
    .map((s) => s.id);
  throw new OrbitError(
    'NOT_FOUND',
    `No symbol "${symbol}"${near.length ? `. Similar: ${near.join(', ')}` : ''}`,
    {
      details: { symbol },
    },
  );
}

const bySymbol = (a: SymbolView, b: SymbolView): number =>
  a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.id < b.id ? -1 : 1);

function cap<T>(
  items: T[],
  requested: number | undefined,
): { items: T[]; total: number; truncated: boolean } {
  const max = requested ?? LIMITS.defaultResults;
  return { items: items.slice(0, max), total: items.length, truncated: items.length > max };
}

function memoryBrief(item: MemoryItem, stale?: boolean) {
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    authority: item.authority,
    authoritative: item.authoritative,
    status: item.status,
    version: item.version,
    ...(item.decisionStatus !== undefined && { decisionStatus: item.decisionStatus }),
    ...(stale !== undefined && { stale }),
    supersededBy: item.supersededBy,
    evidenceId: item.evidenceId,
  };
}

function edgeLocations(edge: EdgeRecord): unknown {
  const locations = edge.attrs['locations'];
  return Array.isArray(locations) ? locations.slice(0, 5) : [];
}

// ---- the twelve tools ------------------------------------------------------------------------

export const TOOLS: ToolDefinition[] = [
  define({
    name: 'orbit_repository_map',
    title: 'Repository map',
    description:
      'Start here. Summarises a scanned repository: languages, modules, entry points, build systems, ' +
      'dependency cycles, hotspots, memory counts and what the last scan could NOT measure.',
    inputSchema: { repository, maxModules: z.number().int().min(1).max(100).optional() },
    run(ctx, args) {
      const repo = ctx.repository(args.repository);
      const node = atlasNodes(ctx, repo.id, 'Repository')[0];
      const attrs = node?.attrs ?? {};
      const modules = buildArchitectureMap(ctx.store, repo.id).modules;
      const shown = cap(
        [...modules].sort((a, b) => b.files - a.files || (a.module < b.module ? -1 : 1)),
        args.maxModules ?? 25,
      );
      const counts: Record<string, number> = {};
      for (const type of [
        'File',
        'Function',
        'Class',
        'Symbol',
        'Module',
        'Dependency',
        'Test',
        'Commit',
      ] as const) {
        counts[type] =
          type === 'File' ||
          type === 'Function' ||
          type === 'Class' ||
          type === 'Symbol' ||
          type === 'Module' ||
          type === 'Dependency' ||
          type === 'Test'
            ? atlasNodes(ctx, repo.id, type).length
            : pageAll((l, o) => ctx.store.nodes.find(repo.id, { type, limit: l, offset: o }))
                .length;
      }
      const memory = ctx.memory(repo.id).all();
      const memoryByCategory: Record<string, number> = {};
      for (const m of memory.filter((i) => i.status === 'active')) {
        memoryByCategory[m.category] = (memoryByCategory[m.category] ?? 0) + 1;
      }
      const scanEvidence = node
        ? ctx.store.evidence.get(repo.id, node.sourceEvidenceId)
        : undefined;
      const array = (v: unknown, n: number): unknown[] => (Array.isArray(v) ? v.slice(0, n) : []);
      return {
        data: {
          displayName: repo.displayName,
          languages: attrs['languages'] ?? {},
          categories: attrs['categories'] ?? {},
          frameworks: attrs['frameworks'] ?? [],
          buildSystems: attrs['buildSystems'] ?? [],
          counts,
          modules: shown.items.map((m) => ({
            module: m.module,
            category: m.category,
            files: m.files,
            lines: m.lines,
            dependsOn: m.dependsOn.length,
            dependedOnBy: m.dependedOnBy.length,
          })),
          modulesTotal: shown.total,
          entryPoints: array(attrs['entryPoints'], 15),
          cycles: {
            files: array(attrs['fileCycles'], 5),
            modules: array(attrs['moduleCycles'], 5),
            typeOnly: array(attrs['typeOnlyCycles'], 5),
          },
          hotspots: array(attrs['hotspots'], 10),
          churnMeasured: attrs['churnMeasured'] === true,
          memory: {
            active: memory.filter((m) => m.status === 'active').length,
            byCategory: memoryByCategory,
          },
          scanLimitations: scanEvidence?.limitations ?? [],
          nextSteps:
            'Use orbit_search_symbols, orbit_get_architecture, orbit_analyze_impact, orbit_search_memory.',
        },
        evidenceIds: node ? [node.sourceEvidenceId] : [],
        truncated: shown.truncated,
      };
    },
  }),

  define({
    name: 'orbit_search_symbols',
    title: 'Search symbols',
    description:
      'Find functions, classes and other symbols by name. Exact matches rank first, then prefix, then substring.',
    inputSchema: {
      repository,
      query: text(200),
      kind: text(40).optional().describe('Filter by kind, e.g. function, class, method.'),
      file: text(1024).optional().describe('Only symbols in files under this path prefix.'),
      exportedOnly: z.boolean().optional(),
      limit,
    },
    run(ctx, args) {
      const repo = ctx.repository(args.repository);
      const q = args.query.toLowerCase();
      const prefix = args.file === undefined ? undefined : cleanPath(args.file);
      const ranked = allSymbols(ctx, repo.id)
        .map((node) => ({ node, v: symbolView(node) }))
        .filter(
          ({ v }) =>
            (args.kind === undefined || v.kind === args.kind) &&
            (!args.exportedOnly || v.exported) &&
            (prefix === undefined ||
              v.file === prefix ||
              v.file.startsWith(`${prefix}/`) ||
              v.file.startsWith(prefix)),
        )
        .map((entry) => {
          const name = entry.v.name.toLowerCase();
          const qn = entry.v.qualifiedName.toLowerCase();
          const rank =
            name === q || qn === q
              ? 0
              : name.startsWith(q) || qn.startsWith(q)
                ? 1
                : qn.includes(q)
                  ? 2
                  : 3;
          return { ...entry, rank };
        })
        .filter((e) => e.rank < 3)
        .sort((a, b) => a.rank - b.rank || bySymbol(a.v, b.v));
      const page = cap(ranked, args.limit);
      return {
        data: { results: page.items.map(({ v }) => v), total: page.total },
        evidenceIds: page.items.map(({ v }) => v.evidenceId),
        truncated: page.truncated,
      };
    },
  }),

  define({
    name: 'orbit_get_symbol',
    title: 'Get symbol',
    description:
      'Details for one symbol: location, kind, complexity, export status, caller and callee counts. ' +
      'Use the id `path#qualifiedName` from orbit_search_symbols; a bare name may be ambiguous and returns candidates.',
    inputSchema: { repository, symbol: text(400), file: text(1024).optional() },
    run(ctx, args) {
      const repo = ctx.repository(args.repository);
      const resolved = resolveSymbol(ctx, repo.id, args.symbol, args.file);
      if (resolved.kind === 'ambiguous') {
        return {
          data: {
            ambiguous: true,
            candidates: resolved.candidates,
            hint: 'Call again with the full id.',
          },
          evidenceIds: resolved.candidates.map((c) => c.evidenceId),
        };
      }
      const node = resolved.node;
      const callers = neighbors(ctx.store, repo.id, node.id, { direction: 'in', types: ['CALLS'] });
      const callees = neighbors(ctx.store, repo.id, node.id, {
        direction: 'out',
        types: ['CALLS'],
      });
      return {
        data: {
          symbol: symbolView(node),
          callers: callers.length,
          callees: callees.length,
          heuristicCallLinks: [...callers, ...callees].filter(
            (n) => n.edge.attrs['heuristic'] === true,
          ).length,
        },
        evidenceIds: [node.sourceEvidenceId],
      };
    },
  }),

  ...(['callers', 'callees'] as const).map((which) =>
    define({
      name: `orbit_get_${which}`,
      title: `Get ${which}`,
      description:
        which === 'callers'
          ? 'Who calls this symbol. Each link has a confidence and a heuristic flag: static analysis cannot resolve every call.'
          : 'What this symbol calls. Each link has a confidence and a heuristic flag: static analysis cannot resolve every call.',
      inputSchema: {
        repository,
        symbol: text(400),
        file: text(1024).optional(),
        minConfidence: z.number().min(0).max(1).optional(),
        limit,
      },
      run(ctx, args) {
        const repo = ctx.repository(args.repository);
        const resolved = resolveSymbol(ctx, repo.id, args.symbol, args.file);
        if (resolved.kind === 'ambiguous') {
          return {
            data: {
              ambiguous: true,
              candidates: resolved.candidates,
              hint: 'Call again with the full id.',
            },
          };
        }
        const links = neighbors(ctx.store, repo.id, resolved.node.id, {
          direction: which === 'callers' ? 'in' : 'out',
          types: ['CALLS'],
        })
          .filter((n) => (args.minConfidence ?? 0) <= (n.edge.confidence ?? 0))
          .sort(
            (a, b) =>
              (b.edge.confidence ?? 0) - (a.edge.confidence ?? 0) ||
              (a.node.key < b.node.key ? -1 : 1),
          );
        const page = cap(links, args.limit);
        return {
          data: {
            symbol: resolved.node.key,
            results: page.items.map((n) => ({
              symbol: symbolView(n.node),
              confidence: n.edge.confidence ?? null,
              heuristic: n.edge.attrs['heuristic'] === true,
              resolution: n.edge.attrs['resolution'] ?? null,
              locations: edgeLocations(n.edge),
              evidenceId: n.edge.sourceEvidenceId,
            })),
            total: page.total,
          },
          evidenceIds: [
            resolved.node.sourceEvidenceId,
            ...page.items.map((n) => n.edge.sourceEvidenceId),
          ],
          truncated: page.truncated,
          notes: [
            'Call links come from static analysis; dynamic dispatch and reflection are not resolved.',
          ],
        };
      },
    }),
  ),

  define({
    name: 'orbit_analyze_impact',
    title: 'Analyze impact',
    description:
      'If this file changes, what is affected: files that import it (directly or transitively), affected modules, linked tests.',
    inputSchema: {
      repository,
      file: repoPath,
      maxDepth: z.number().int().min(1).max(10).optional(),
      limit,
    },
    run(ctx, args) {
      const repo = ctx.repository(args.repository);
      const path = cleanPath(args.file);
      const impact = impactMap(ctx.store, repo.id, path, {
        maxDepth: args.maxDepth ?? 5,
        maxNodes: 1000,
      });
      const deps = cap(impact.dependents, args.limit ?? 50);
      const tests = cap(impact.tests, args.limit ?? 50);
      const node = ctx.store.nodes.get(repo.id, nodeIdFor(repo.id, 'File', path));
      return {
        data: {
          file: path,
          dependents: deps.items,
          dependentsTotal: deps.total,
          packageLevelDependents: impact.packageLevelDependents.slice(0, 25),
          affectedModules: impact.affectedModules,
          tests: tests.items,
          testsTotal: tests.total,
          noLinkedTests: impact.tests.length === 0,
        },
        evidenceIds: node ? [node.sourceEvidenceId] : [],
        truncated: deps.truncated || tests.truncated || impact.truncated,
        notes: [
          'Import links are static. Test links are inferred from naming and imports and carry a confidence.',
        ],
      };
    },
  }),

  define({
    name: 'orbit_find_related_tests',
    title: 'Find related tests',
    description:
      'Tests linked to a file or symbol, directly or through files that depend on it, with the reason and confidence of each link.',
    inputSchema: { repository, file: repoPath.optional(), symbol: text(400).optional(), limit },
    run(ctx, args) {
      const repo = ctx.repository(args.repository);
      if ((args.file === undefined) === (args.symbol === undefined)) {
        throw new OrbitError('INVALID_INPUT', 'Provide exactly one of "file" or "symbol".');
      }
      let path: string;
      if (args.symbol !== undefined) {
        const resolved = resolveSymbol(ctx, repo.id, args.symbol);
        if (resolved.kind === 'ambiguous')
          return { data: { ambiguous: true, candidates: resolved.candidates } };
        path = symbolView(resolved.node).file;
      } else {
        path = cleanPath(args.file as string);
      }
      const impact = impactMap(ctx.store, repo.id, path, { maxDepth: 5, maxNodes: 1000 });
      const covered = new Set([path, ...impact.dependents.map((d) => d.path)]);
      const rows: {
        test: string;
        covers: string;
        via: 'direct' | 'dependent';
        confidence: number | null;
        reasons: string[];
        evidenceId: string;
      }[] = [];
      for (const t of impact.tests) {
        const edge = ctx.store.edges
          .list(repo.id, {
            toId: nodeIdFor(repo.id, 'File', t.covers),
            types: ['TESTS'],
            limit: 1000,
          })
          .find((e) => ctx.store.nodes.get(repo.id, e.fromId)?.key === t.test);
        rows.push({
          test: t.test,
          covers: t.covers,
          via: t.covers === path ? 'direct' : 'dependent',
          confidence: t.confidence,
          reasons: t.reasons,
          evidenceId: edge?.sourceEvidenceId ?? '',
        });
      }
      rows.sort((a, b) =>
        a.via === b.via
          ? (b.confidence ?? 0) - (a.confidence ?? 0) || (a.test < b.test ? -1 : 1)
          : a.via === 'direct'
            ? -1
            : 1,
      );
      const page = cap(rows, args.limit);
      return {
        data: {
          file: path,
          results: page.items,
          total: page.total,
          filesConsidered: covered.size,
          none: rows.length === 0,
        },
        evidenceIds: page.items.map((r) => r.evidenceId).filter((id) => id !== ''),
        truncated: page.truncated,
        notes:
          rows.length === 0
            ? [
                'No test is linked to this file in the graph. That is not proof it is untested: links are inferred.',
              ]
            : [],
      };
    },
  }),

  define({
    name: 'orbit_search_history',
    title: 'Search history',
    description:
      'Search indexed git commits by subject text, author or file. Only the commit window that was scanned is searched.',
    inputSchema: {
      repository,
      query: text(200).optional(),
      author: text(100).optional(),
      file: repoPath.optional(),
      limit,
    },
    run(ctx, args) {
      const repo = ctx.repository(args.repository);
      let commits = pageAll((l, o) =>
        ctx.store.nodes.find(repo.id, { type: 'Commit', limit: l, offset: o }),
      );
      if (args.file !== undefined) {
        const fileId = nodeIdFor(repo.id, 'File', cleanPath(args.file));
        const ids = new Set(pageEdges(ctx, repo.id, fileId).map((e) => e.fromId));
        commits = commits.filter((c) => ids.has(c.id));
      }
      const terms = (args.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const author = args.author?.toLowerCase();
      commits = commits.filter((c) => {
        const subject = str(c.attrs['subject']).toLowerCase();
        return (
          terms.every((t) => subject.includes(t)) &&
          (author === undefined || str(c.attrs['author']).toLowerCase().includes(author))
        );
      });
      commits.sort((a, b) =>
        str(b.attrs['date']) < str(a.attrs['date'])
          ? -1
          : str(b.attrs['date']) > str(a.attrs['date'])
            ? 1
            : a.key < b.key
              ? -1
              : 1,
      );
      const page = cap(commits, args.limit);
      return {
        data: {
          results: page.items.map((c) => ({
            sha: c.key,
            date: str(c.attrs['date']),
            author: str(c.attrs['author']),
            subject: str(c.attrs['subject']),
            filesChanged: num(c.attrs['files']),
            evidenceId: c.sourceEvidenceId,
          })),
          total: page.total,
        },
        evidenceIds: page.items.map((c) => c.sourceEvidenceId),
        truncated: page.truncated,
        notes: [
          'Only commits inside the scanned window are searched, and only subjects (not message bodies).',
        ],
      };
    },
  }),

  define({
    name: 'orbit_search_memory',
    title: 'Search project memory',
    description:
      'Search recorded decisions, constraints, conventions, known bugs and fixes. Results say who stands behind each item ' +
      '(authority), whether it is authoritative, whether the files it cites changed since (stale), and any conflicts. ' +
      'AI-suggested items are excluded unless includeUnverified is true.',
    inputSchema: {
      repository,
      query: text(300).optional(),
      categories: z.array(z.enum(MEMORY_CATEGORIES)).max(8).optional(),
      file: repoPath.optional().describe('Only memory that cites this file.'),
      includeUnverified: z
        .boolean()
        .optional()
        .describe('Include AI-suggested items (labelled, never authoritative).'),
      includeInvalidated: z.boolean().optional(),
      limit,
    },
    run(ctx, args) {
      const repo = ctx.repository(args.repository);
      const engine = ctx.memory(repo.id);
      const all = engine.all();
      const result = searchMemory(all, {
        ...(args.query !== undefined && { text: args.query }),
        ...(args.categories && { categories: args.categories }),
        ...(args.file !== undefined && { path: cleanPath(args.file) }),
        authoritativeOnly: !args.includeUnverified,
        includeInvalidated: args.includeInvalidated ?? false,
        limit: args.limit ?? LIMITS.defaultResults,
      });
      const staleness = new Map(
        checkStaleness(
          result.hits.map((h) => h.item),
          engine.probe,
        ).map((f) => [f.id, f]),
      );
      const conflicts = findConflicts(all).filter((c) =>
        result.hits.some((h) => c.items.includes(h.item.id)),
      );
      return {
        data: {
          results: result.hits.map((h) => ({
            ...memoryBrief(h.item, staleness.get(h.item.id)?.stale),
            score: h.score,
            matched: h.matched,
            snippet: h.snippet,
            excerpt: h.item.excerpt,
            sourceRefs: h.item.sourceRefs,
            staleReasons: staleness.get(h.item.id)?.reasons ?? [],
            history: `${h.item.version} version(s); full history via the orbit CLI`,
          })),
          total: result.total,
          hiddenUnverified: result.hiddenUnverified,
          conflicts,
        },
        evidenceIds: result.hits.map((h) => h.item.evidenceId),
        truncated: result.truncated,
        notes: [
          'Memory records what people decided. ORBIT did not verify these statements against the code.',
          ...(result.hiddenUnverified > 0
            ? [
                `${result.hiddenUnverified} AI-suggested item(s) hidden; pass includeUnverified to see them.`,
              ]
            : []),
        ],
      };
    },
  }),

  define({
    name: 'orbit_get_architecture',
    title: 'Get architecture',
    description:
      'Module-level architecture: how modules depend on each other, their public surface, owners, and dependency cycles. Pass `module` for one module in detail.',
    inputSchema: { repository, module: text(300).optional(), limit },
    run(ctx, args) {
      const repo = ctx.repository(args.repository);
      const node = atlasNodes(ctx, repo.id, 'Repository')[0];
      const attrs = node?.attrs ?? {};
      const summaries = moduleSummaries(ctx.store, repo.id, args.module ? 15 : 5);
      if (args.module !== undefined) {
        const found = summaries.find((m) => m.module === args.module);
        if (!found) {
          throw new OrbitError(
            'NOT_FOUND',
            `No module "${args.module}". Known: ${summaries
              .slice(0, 15)
              .map((m) => m.module)
              .join(', ')}`,
          );
        }
        return { data: { module: found }, evidenceIds: node ? [node.sourceEvidenceId] : [] };
      }
      const page = cap(
        [...summaries].sort((a, b) => b.files - a.files || (a.module < b.module ? -1 : 1)),
        args.limit,
      );
      const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, 10) : []);
      return {
        data: {
          modules: page.items,
          total: page.total,
          cycles: {
            files: arr(attrs['fileCycles']),
            modules: arr(attrs['moduleCycles']),
            typeOnly: arr(attrs['typeOnlyCycles']),
          },
          entryPoints: arr(attrs['entryPoints']),
          hotspots: arr(attrs['hotspots']),
        },
        evidenceIds: node ? [node.sourceEvidenceId] : [],
        truncated: page.truncated,
      };
    },
  }),

  define({
    name: 'orbit_get_change_context',
    title: 'Get change context',
    description:
      'Before editing: for up to 20 files (or the files of one commit) get owners, churn, hotspot status, recent commits, ' +
      'dependents, linked tests and the project memory that cites them, with stale and conflict warnings.',
    inputSchema: {
      repository,
      files: z.array(repoPath).max(20).optional(),
      commit: text(64)
        .regex(/^[0-9a-fA-F]{7,64}$/)
        .optional()
        .describe('A commit SHA (or unique prefix) whose files to analyse.'),
    },
    run(ctx, args) {
      const repo = ctx.repository(args.repository);
      if ((args.files === undefined) === (args.commit === undefined)) {
        throw new OrbitError('INVALID_INPUT', 'Provide exactly one of "files" or "commit".');
      }
      const evidenceIds: string[] = [];
      let paths: string[];
      if (args.commit !== undefined) {
        const sha = args.commit.toLowerCase();
        const matches = pageAll((l, o) =>
          ctx.store.nodes.find(repo.id, { type: 'Commit', limit: l, offset: o }),
        ).filter((c) => c.key.startsWith(sha));
        if (matches.length !== 1 || !matches[0]) {
          throw new OrbitError(
            'NOT_FOUND',
            matches.length > 1
              ? 'That commit prefix is ambiguous.'
              : 'Commit is not in the scanned history window.',
          );
        }
        evidenceIds.push(matches[0].sourceEvidenceId);
        paths = ctx.store.edges
          .list(repo.id, { fromId: matches[0].id, types: ['MODIFIES'], limit: 500 })
          .map((e) => ctx.store.nodes.get(repo.id, e.toId))
          .filter((n): n is NodeRecord => n?.type === 'File')
          .map((n) => n.key)
          .sort()
          .slice(0, 20);
      } else {
        paths = [...new Set((args.files ?? []).map(cleanPath))];
      }
      const engine = ctx.memory(repo.id);
      const memory = engine.all();
      const stale = new Map(checkStaleness(memory, engine.probe).map((f) => [f.id, f.stale]));
      const hotspots = (ctx.store.nodes
        .find(repo.id, { type: 'Repository', limit: 5 })
        .find((n) => n.attrs['producer'] === 'atlas')?.attrs['hotspots'] ?? []) as {
        path: string;
      }[];
      const files = paths.map((path) => {
        const node = ctx.store.nodes.get(repo.id, nodeIdFor(repo.id, 'File', path));
        if (!node)
          return {
            path,
            inGraph: false,
            signals: ['File is not in the scanned graph (new, ignored or not parsed).'],
          };
        evidenceIds.push(node.sourceEvidenceId);
        const impact = impactMap(ctx.store, repo.id, path, { maxDepth: 3, maxNodes: 300 });
        const recent = ctx.store.edges
          .list(repo.id, { toId: node.id, types: ['MODIFIES'], limit: 500 })
          .map((e) => ctx.store.nodes.get(repo.id, e.fromId))
          .filter((n): n is NodeRecord => n !== undefined)
          .sort((a, b) => (str(b.attrs['date']) < str(a.attrs['date']) ? -1 : 1))
          .slice(0, 5);
        const items = memory.filter(
          (m) =>
            m.status === 'active' && m.sourceRefs.some((r) => r.kind === 'file' && r.path === path),
        );
        const hotspotRank = hotspots.findIndex((h) => h.path === path);
        const signals: string[] = [];
        if (hotspotRank >= 0)
          signals.push(`Hotspot: rank ${hotspotRank + 1} by complexity x churn.`);
        if (impact.tests.length === 0)
          signals.push(
            'No test is linked to this file or its dependents (links are inferred, so this is not proof).',
          );
        if (impact.dependents.length > 0)
          signals.push(
            `${impact.dependents.length} file(s) depend on it${impact.truncated ? ' (at least)' : ''}.`,
          );
        const staleItems = items.filter((i) => stale.get(i.id));
        if (staleItems.length > 0)
          signals.push(
            `${staleItems.length} memory item(s) citing this file may be stale: the file changed since they were written.`,
          );
        for (const m of items) evidenceIds.push(m.evidenceId);
        for (const c of recent) evidenceIds.push(c.sourceEvidenceId);
        return {
          path,
          inGraph: true,
          module: str(node.attrs['module']),
          language: str(node.attrs['language']),
          lines: num(node.attrs['lines']),
          complexity: num(node.attrs['complexity']),
          churn: node.attrs['churn'] ?? null,
          owners: node.attrs['owners'] ?? [],
          recentCommits: recent.map((c) => ({
            sha: c.key,
            date: str(c.attrs['date']),
            author: str(c.attrs['author']),
            subject: str(c.attrs['subject']),
          })),
          dependents: impact.dependents.slice(0, 15),
          dependentsTotal: impact.dependents.length,
          affectedModules: impact.affectedModules,
          tests: impact.tests.slice(0, 10),
          memory: items.map((i) => memoryBrief(i, stale.get(i.id))),
          signals,
        };
      });
      const cited = new Set(paths);
      const conflicts = findConflicts(memory).filter((c) =>
        c.items.some((id) =>
          memory
            .find((m) => m.id === id)
            ?.sourceRefs.some((r) => r.kind === 'file' && cited.has(r.path)),
        ),
      );
      return {
        data: { files, conflicts },
        evidenceIds,
        notes: [
          'Signals are facts from the graph, not a risk score. Churn is only measured when git history was scanned.',
        ],
      };
    },
  }),

  define({
    name: 'orbit_get_evidence',
    title: 'Get evidence',
    description:
      'Look up the evidence behind a claim: by evidence id, by entity (file path, symbol id, memory id) or by commit. ' +
      'Set verifyLedger to re-check the tamper-evident hash chain of the whole repository record.',
    inputSchema: {
      repository,
      evidenceId: text(100).optional(),
      entity: text(1024).optional().describe('A file path, symbol id (path#name) or memory id.'),
      commit: text(64)
        .regex(/^[0-9a-fA-F]{7,64}$/)
        .optional(),
      verifyLedger: z.boolean().optional(),
      limit,
    },
    run(ctx, args) {
      const repo = ctx.repository(args.repository);
      let records = [] as ReturnType<OrbitContext['store']['evidence']['list']>;
      if (args.evidenceId !== undefined) {
        const found = ctx.store.evidence.get(repo.id, args.evidenceId);
        if (!found)
          throw new OrbitError('NOT_FOUND', 'No evidence with that id in this repository.');
        records = [found];
      } else if (args.entity !== undefined) {
        const ids = new Set<string>();
        const candidates: NodeRecord[] = [];
        for (const type of [
          'File',
          'Function',
          'Class',
          'Symbol',
          'Decision',
          'Documentation',
        ] as const) {
          const key = type === 'File' ? safePath(args.entity) : args.entity;
          if (key === undefined) continue;
          const node = ctx.store.nodes.get(repo.id, nodeIdFor(repo.id, type, key));
          if (node) candidates.push(node);
        }
        if (candidates.length === 0)
          throw new OrbitError(
            'NOT_FOUND',
            `Nothing in the graph matches "${args.entity.slice(0, 80)}".`,
          );
        for (const node of candidates) {
          for (const version of ctx.store.nodes.history(repo.id, node.id))
            ids.add(version.sourceEvidenceId);
          for (const e of ctx.store.evidence.forEntity(repo.id, node.id)) ids.add(e.id);
        }
        records = [...ids]
          .map((id) => ctx.store.evidence.get(repo.id, id))
          .filter((e): e is NonNullable<typeof e> => e !== undefined);
      } else if (args.commit !== undefined) {
        records = ctx.store.evidence.list(repo.id, {
          commitSha: args.commit.toLowerCase(),
          limit: 100,
        });
      } else {
        records = ctx.store.evidence.list(repo.id, { limit: 100 });
      }
      records.sort((a, b) =>
        a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : a.id < b.id ? -1 : 1,
      );
      const page = cap(records, args.limit);
      const integrity = args.verifyLedger ? ctx.store.verifyIntegrity(repo.id) : undefined;
      const head = ctx.store.ledger.head(repo.id);
      return {
        data: {
          results: page.items.map((r) => ({
            ...summarise(r),
            relatedEntityIds: r.relatedEntityIds.slice(0, 20),
            timestamp: r.timestamp ?? null,
            supersedes: r.supersedes ?? null,
          })),
          total: page.total,
          ledgerHead: head ? { seq: head.seq, hash: head.hash } : null,
          ...(integrity && {
            integrity: {
              ok: integrity.ok,
              ledgerEntriesChecked: integrity.ledgerEntriesChecked,
              problems: integrity.problems.slice(0, 10),
            },
          }),
        },
        truncated: page.truncated,
        notes: [
          'Evidence status is PASS, FAIL, PARTIAL, NOT_MEASURED or INCOMPLETE. Read "limitations" before relying on a result.',
        ],
      };
    },
  }),
];

function safePath(input: string): string | undefined {
  try {
    return normalizeRepoRelativePath(input);
  } catch {
    return undefined;
  }
}

function pageEdges(ctx: OrbitContext, repositoryId: string, toId: string): EdgeRecord[] {
  const out: EdgeRecord[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = ctx.store.edges.list(repositoryId, {
      toId,
      types: ['MODIFIES'],
      limit: PAGE,
      offset,
    });
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

export type { EvidenceSummary };
