import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashArtifact } from '@orbit/core';
import {
  IN_MEMORY,
  createGraphStore,
  openDatabase,
  type GraphStore,
  type OrbitDatabase,
} from '@orbit/database';
import { findNodes, neighbors, shortestPath, traverse } from './queries.js';

let database: OrbitDatabase;
let store: GraphStore;
let repo: string;
let ev: string;

function file(key: string): string {
  return store.nodes.upsert({ repositoryId: repo, type: 'File', key, sourceEvidenceId: ev }).record
    .id;
}
function link(type: string, from: string, to: string): void {
  store.edges.upsert({ repositoryId: repo, type, fromId: from, toId: to, sourceEvidenceId: ev });
}

beforeEach(() => {
  database = openDatabase({ path: IN_MEMORY });
  let n = 0;
  store = createGraphStore(database, {
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++n)).toISOString(),
  });
  repo = store.repositories.register({ key: 'acme/app' }).record.id;
  ev = store.evidence.append({
    repositoryId: repo,
    source: 'parser',
    sourceType: 'parser',
    contentHash: hashArtifact('x'),
    status: 'PASS',
    limitations: [],
    relatedEntityIds: [],
  }).record.id;
});

afterEach(() => database.close());

describe('findNodes', () => {
  it('delegates to the store', () => {
    file('src/a.ts');
    file('lib/b.ts');
    expect(findNodes(store, repo, { keyPrefix: 'src/' }).map((n) => n.key)).toEqual(['src/a.ts']);
  });
});

describe('neighbors', () => {
  it('returns outgoing, incoming or both, in stable order', () => {
    const a = file('a.ts');
    const b = file('b.ts');
    const c = file('c.ts');
    link('IMPORTS', a, b);
    link('IMPORTS', c, a);
    expect(neighbors(store, repo, a).map((x) => x.node.key)).toEqual(['b.ts']);
    expect(neighbors(store, repo, a, { direction: 'in' }).map((x) => x.node.key)).toEqual(['c.ts']);
    const both = neighbors(store, repo, a, { direction: 'both' }).map(
      (x) => `${x.direction}:${x.node.key}`,
    );
    expect([...both].sort()).toEqual(['in:c.ts', 'out:b.ts']);
    // Same call twice gives the same order (stable: edge type, then neighbour ID).
    expect(
      neighbors(store, repo, a, { direction: 'both' }).map((x) => `${x.direction}:${x.node.key}`),
    ).toEqual(both);
  });

  it('filters by edge type and errors on unknown nodes', () => {
    const a = file('a.ts');
    const b = file('b.ts');
    link('IMPORTS', a, b);
    expect(neighbors(store, repo, a, { types: ['CALLS'] })).toEqual([]);
    expect(() => neighbors(store, repo, 'n_nope')).toThrowError(/does not exist/);
  });

  it('stops following retired edges and ignores retired nodes', () => {
    const a = file('a.ts');
    const b = file('b.ts');
    link('IMPORTS', a, b);
    store.nodes.retire({ repositoryId: repo, nodeId: b, sourceEvidenceId: ev });
    expect(neighbors(store, repo, a)).toEqual([]);
  });
});

describe('traverse', () => {
  it('walks breadth-first with depths and is cycle-safe', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((k) => file(`${k}.ts`)) as [
      string,
      string,
      string,
      string,
    ];
    link('IMPORTS', a, b);
    link('IMPORTS', b, c);
    link('IMPORTS', c, a); // cycle
    link('IMPORTS', c, d);
    const result = traverse(store, repo, a, { maxDepth: 10 });
    expect(result.nodes.map((n) => [n.node.key, n.depth])).toEqual([
      ['a.ts', 0],
      ['b.ts', 1],
      ['c.ts', 2],
      ['d.ts', 3],
    ]);
    expect(result.edges).toHaveLength(4);
    expect(result.truncated).toBe(false);
  });

  it('respects maxDepth', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((k) => file(`${k}.ts`)) as [string, string, string];
    link('IMPORTS', a, b);
    link('IMPORTS', b, c);
    const result = traverse(store, repo, a, { maxDepth: 1 });
    expect(result.nodes.map((n) => n.node.key)).toEqual(['a.ts', 'b.ts']);
    expect(traverse(store, repo, a, { maxDepth: 0 }).nodes).toHaveLength(1);
  });

  it('flags truncation when the node budget is hit', () => {
    const hub = file('hub.ts');
    for (let i = 0; i < 5; i += 1) link('IMPORTS', hub, file(`leaf${i}.ts`));
    const result = traverse(store, repo, hub, { maxNodes: 3 });
    expect(result.nodes).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it('follows incoming edges for impact analysis', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((k) => file(`${k}.ts`)) as [string, string, string];
    link('IMPORTS', a, b);
    link('IMPORTS', b, c);
    const result = traverse(store, repo, c, { direction: 'in', maxDepth: 5 });
    expect(result.nodes.map((n) => n.node.key)).toEqual(['c.ts', 'b.ts', 'a.ts']);
  });

  it('is deterministic regardless of insertion order', () => {
    function build(order: string[]): string[] {
      const db = openDatabase({ path: IN_MEMORY });
      let n = 0;
      const s = createGraphStore(db, {
        now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++n)).toISOString(),
      });
      const r = s.repositories.register({ key: 'k' }).record.id;
      const e = s.evidence.append({
        repositoryId: r,
        source: 's',
        sourceType: 'manual',
        contentHash: hashArtifact('x'),
        status: 'PASS',
        limitations: [],
        relatedEntityIds: [],
      }).record.id;
      const ids = new Map(
        order.map((k) => [
          k,
          s.nodes.upsert({ repositoryId: r, type: 'File', key: k, sourceEvidenceId: e }).record.id,
        ]),
      );
      for (const k of order) {
        if (k !== 'root')
          s.edges.upsert({
            repositoryId: r,
            type: 'IMPORTS',
            fromId: ids.get('root')!,
            toId: ids.get(k)!,
            sourceEvidenceId: e,
          });
      }
      const keys = traverse(s, r, ids.get('root')!).nodes.map((x) => x.node.key);
      db.close();
      return keys;
    }
    expect(build(['root', 'x', 'y', 'z'])).toEqual(build(['z', 'root', 'y', 'x']));
  });

  it('validates bounds and start node', () => {
    const a = file('a.ts');
    expect(() => traverse(store, repo, a, { maxDepth: -1 })).toThrowError(/maxDepth/);
    expect(() => traverse(store, repo, 'n_nope')).toThrowError(/does not exist/);
  });

  it('does not cross repositories', () => {
    const a = file('a.ts');
    const other = store.repositories.register({ key: 'other' }).record.id;
    expect(() => traverse(store, other, a)).toThrowError(/does not exist/);
  });
});

describe('shortestPath', () => {
  it('finds the fewest-hop path', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((k) => file(`${k}.ts`)) as [
      string,
      string,
      string,
      string,
    ];
    link('IMPORTS', a, b);
    link('IMPORTS', b, c);
    link('IMPORTS', c, d);
    link('IMPORTS', a, d);
    const path = shortestPath(store, repo, a, d);
    expect(path?.nodeIds).toEqual([a, d]);
    expect(path?.edges).toHaveLength(1);
  });

  it('returns undefined when unreachable, honours direction, and handles same node', () => {
    const [a, b] = ['a', 'b'].map((k) => file(`${k}.ts`)) as [string, string];
    link('IMPORTS', a, b);
    expect(shortestPath(store, repo, b, a)).toBeUndefined();
    expect(shortestPath(store, repo, b, a, { direction: 'both' })?.nodeIds).toEqual([b, a]);
    expect(shortestPath(store, repo, a, a)).toEqual({ nodeIds: [a], edges: [] });
  });

  it('respects maxDepth', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((k) => file(`${k}.ts`)) as [string, string, string];
    link('IMPORTS', a, b);
    link('IMPORTS', b, c);
    expect(shortestPath(store, repo, a, c, { maxDepth: 1 })).toBeUndefined();
    expect(shortestPath(store, repo, a, c, { maxDepth: 2 })?.nodeIds).toEqual([a, b, c]);
  });
});
