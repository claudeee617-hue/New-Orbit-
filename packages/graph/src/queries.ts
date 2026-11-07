import type { EdgeRecord, EdgeType, NodeRecord } from '@orbit/core';
import type { GraphStore, NodeQuery } from '@orbit/database';
import { OrbitError } from '@orbit/shared';

export type Direction = 'out' | 'in' | 'both';

export const TRAVERSAL_LIMITS = {
  defaultMaxDepth: 3,
  hardMaxDepth: 25,
  defaultMaxNodes: 1000,
  hardMaxNodes: 10_000,
  /** Edges read per node. If a node has more, the result is flagged `truncated`. */
  edgesPerNode: 10_000,
} as const;

export interface NeighborOptions {
  direction?: Direction;
  types?: readonly EdgeType[];
}

export interface Neighbor {
  edge: EdgeRecord;
  /** The node on the other end of `edge`, as seen from the starting node. */
  node: NodeRecord;
  direction: 'out' | 'in';
}

export interface TraverseOptions extends NeighborOptions {
  maxDepth?: number;
  maxNodes?: number;
}

export interface TraversalNode {
  node: NodeRecord;
  depth: number;
}

export interface TraversalResult {
  start: NodeRecord;
  nodes: TraversalNode[];
  edges: EdgeRecord[];
  /** True when a bound (node budget or per-node edge cap) stopped the walk early. */
  truncated: boolean;
}

export interface PathResult {
  /** Node IDs from start to end inclusive. */
  nodeIds: string[];
  /** Edges in walking order. */
  edges: EdgeRecord[];
}

function boundedInt(
  value: number | undefined,
  fallback: number,
  hard: number,
  name: string,
): number {
  const v = value ?? fallback;
  if (!Number.isInteger(v) || v < 0)
    throw new OrbitError('INVALID_INPUT', `${name} must be a non-negative integer`);
  return Math.min(v, hard);
}

function requireNode(store: GraphStore, repositoryId: string, nodeId: string): NodeRecord {
  const node = store.nodes.get(repositoryId, nodeId);
  if (!node) {
    throw new OrbitError(
      'NOT_FOUND',
      `Node ${nodeId} does not exist in repository ${repositoryId}`,
      {
        details: { nodeId, repositoryId },
      },
    );
  }
  return node;
}

export function findNodes(
  store: GraphStore,
  repositoryId: string,
  query: NodeQuery = {},
): NodeRecord[] {
  return store.nodes.find(repositoryId, query);
}

interface Step {
  edge: EdgeRecord;
  otherId: string;
  direction: 'out' | 'in';
}

/** Edges leaving/entering a node, in a stable order (type, then edge ID). */
function steps(
  store: GraphStore,
  repositoryId: string,
  nodeId: string,
  options: NeighborOptions,
): { steps: Step[]; capped: boolean } {
  const direction = options.direction ?? 'out';
  const filter = options.types ? { types: options.types } : {};
  const limit = TRAVERSAL_LIMITS.edgesPerNode;
  const result: Step[] = [];
  let capped = false;
  if (direction === 'out' || direction === 'both') {
    const out = store.edges.list(repositoryId, { ...filter, fromId: nodeId, limit });
    capped ||= out.length >= limit;
    for (const edge of out) result.push({ edge, otherId: edge.toId, direction: 'out' });
  }
  if (direction === 'in' || direction === 'both') {
    const incoming = store.edges.list(repositoryId, { ...filter, toId: nodeId, limit });
    capped ||= incoming.length >= limit;
    for (const edge of incoming) result.push({ edge, otherId: edge.fromId, direction: 'in' });
  }
  result.sort(
    (a, b) =>
      a.edge.type.localeCompare(b.edge.type) ||
      a.otherId.localeCompare(b.otherId) ||
      a.edge.id.localeCompare(b.edge.id),
  );
  return { steps: result, capped };
}

export function neighbors(
  store: GraphStore,
  repositoryId: string,
  nodeId: string,
  options: NeighborOptions = {},
): Neighbor[] {
  requireNode(store, repositoryId, nodeId);
  const out: Neighbor[] = [];
  for (const step of steps(store, repositoryId, nodeId, options).steps) {
    const node = store.nodes.get(repositoryId, step.otherId);
    if (node) out.push({ edge: step.edge, node, direction: step.direction });
  }
  return out;
}

/**
 * Breadth-first walk from `startId`. Bounded by depth and node count, deterministic (stable
 * neighbour order), and cycle-safe (every node is visited once, at its shallowest depth).
 */
export function traverse(
  store: GraphStore,
  repositoryId: string,
  startId: string,
  options: TraverseOptions = {},
): TraversalResult {
  const maxDepth = boundedInt(
    options.maxDepth,
    TRAVERSAL_LIMITS.defaultMaxDepth,
    TRAVERSAL_LIMITS.hardMaxDepth,
    'maxDepth',
  );
  const maxNodes = Math.max(
    1,
    boundedInt(
      options.maxNodes,
      TRAVERSAL_LIMITS.defaultMaxNodes,
      TRAVERSAL_LIMITS.hardMaxNodes,
      'maxNodes',
    ),
  );
  const start = requireNode(store, repositoryId, startId);
  const visited = new Map<string, number>([[startId, 0]]);
  const nodes: TraversalNode[] = [{ node: start, depth: 0 }];
  const edges = new Map<string, EdgeRecord>();
  let truncated = false;
  let frontier = [startId];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0 && !truncated; depth += 1) {
    const next: string[] = [];
    for (const currentId of frontier) {
      const { steps: found, capped } = steps(store, repositoryId, currentId, options);
      if (capped) truncated = true;
      for (const step of found) {
        if (!visited.has(step.otherId)) {
          if (nodes.length >= maxNodes) {
            truncated = true;
            continue;
          }
          const node = store.nodes.get(repositoryId, step.otherId);
          if (!node) continue;
          visited.set(step.otherId, depth);
          nodes.push({ node, depth });
          next.push(step.otherId);
        }
        // Record the edge only when both ends are inside the result.
        if (visited.has(step.otherId)) edges.set(step.edge.id, step.edge);
      }
    }
    frontier = next;
  }

  return {
    start,
    nodes,
    edges: [...edges.values()].sort(
      (a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id),
    ),
    truncated,
  };
}

/** Fewest-hops path (BFS). Ties broken by the stable neighbour order, so the answer is reproducible. */
export function shortestPath(
  store: GraphStore,
  repositoryId: string,
  fromId: string,
  toId: string,
  options: TraverseOptions = {},
): PathResult | undefined {
  const maxDepth = boundedInt(
    options.maxDepth,
    TRAVERSAL_LIMITS.hardMaxDepth,
    TRAVERSAL_LIMITS.hardMaxDepth,
    'maxDepth',
  );
  const maxNodes = Math.max(
    1,
    boundedInt(
      options.maxNodes,
      TRAVERSAL_LIMITS.defaultMaxNodes,
      TRAVERSAL_LIMITS.hardMaxNodes,
      'maxNodes',
    ),
  );
  requireNode(store, repositoryId, fromId);
  requireNode(store, repositoryId, toId);
  if (fromId === toId) return { nodeIds: [fromId], edges: [] };

  const parent = new Map<string, { from: string; edge: EdgeRecord }>();
  const seen = new Set<string>([fromId]);
  let frontier = [fromId];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const currentId of frontier) {
      for (const step of steps(store, repositoryId, currentId, options).steps) {
        if (seen.has(step.otherId)) continue;
        if (seen.size >= maxNodes) continue;
        seen.add(step.otherId);
        parent.set(step.otherId, { from: currentId, edge: step.edge });
        if (step.otherId === toId) {
          const nodeIds = [toId];
          const path: EdgeRecord[] = [];
          for (let cursor = toId; cursor !== fromId;) {
            const link = parent.get(cursor);
            if (!link) break;
            path.unshift(link.edge);
            nodeIds.unshift(link.from);
            cursor = link.from;
          }
          return { nodeIds, edges: path };
        }
        next.push(step.otherId);
      }
    }
    frontier = next;
  }
  return undefined;
}
