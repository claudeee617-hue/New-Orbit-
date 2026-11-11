import { describe, expect, it } from 'vitest';
import { edgeIdFor, hashArtifact, nodeIdFor } from '@orbit/core';
import { IN_MEMORY, createGraphStore, openDatabase } from './index.js';

/** Small deterministic PRNG so failures are reproducible from the seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ModelNode {
  attrs: Record<string, number>;
  deleted: boolean;
  version: number;
}
interface ModelEdge {
  confidence: number | null;
  deleted: boolean;
  version: number;
}

describe.each([1, 7, 42, 2026])('graph store behaves like a simple model (seed %i)', (seed) => {
  it('matches the model after 400 random operations and stays verifiable', () => {
    const rand = mulberry32(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
    const db = openDatabase({ path: IN_MEMORY });
    let tick = 0;
    const store = createGraphStore(db, {
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString(),
    });
    const repo = store.repositories.register({ key: 'fuzz' }).record.id;
    const ev = store.evidence.append({
      repositoryId: repo,
      source: 's',
      sourceType: 'manual',
      contentHash: hashArtifact('x'),
      status: 'PASS',
      limitations: [],
      relatedEntityIds: [],
    }).record.id;

    const keys = Array.from({ length: 8 }, (_, i) => `f${i}.ts`);
    const nodes = new Map<string, ModelNode>();
    const edges = new Map<string, ModelEdge>();
    const edgeEnds = new Map<string, [string, string]>();
    const nodeId = (key: string): string => nodeIdFor(repo, 'File', key);

    for (let step = 0; step < 400; step += 1) {
      const op = rand();
      if (op < 0.35) {
        const key = pick(keys);
        const attrs = { n: Math.floor(rand() * 3) };
        const model = nodes.get(nodeId(key));
        const result = store.nodes.upsert({
          repositoryId: repo,
          type: 'File',
          key,
          attrs,
          sourceEvidenceId: ev,
        });
        const same = model !== undefined && !model.deleted && model.attrs['n'] === attrs.n;
        expect(result.changed).toBe(!same);
        if (!same)
          nodes.set(nodeId(key), { attrs, deleted: false, version: (model?.version ?? 0) + 1 });
      } else if (op < 0.5) {
        const key = pick(keys);
        const model = nodes.get(nodeId(key));
        if (!model) {
          expect(() =>
            store.nodes.retire({ repositoryId: repo, nodeId: nodeId(key), sourceEvidenceId: ev }),
          ).toThrowError();
        } else {
          const result = store.nodes.retire({
            repositoryId: repo,
            nodeId: nodeId(key),
            sourceEvidenceId: ev,
          });
          expect(result.changed).toBe(!model.deleted);
          if (!model.deleted)
            nodes.set(nodeId(key), { ...model, deleted: true, version: model.version + 1 });
        }
      } else if (op < 0.85) {
        const a = pick(keys);
        const b = pick(keys);
        const confidence = pick([null, 0.5, 1]);
        const from = nodes.get(nodeId(a));
        const to = nodes.get(nodeId(b));
        const input = {
          repositoryId: repo,
          type: 'IMPORTS',
          fromId: nodeId(a),
          toId: nodeId(b),
          sourceEvidenceId: ev,
          ...(confidence !== null && { confidence }),
        };
        if (a === b || !from || from.deleted || !to || to.deleted) {
          expect(() => store.edges.upsert(input)).toThrowError();
        } else {
          const id = edgeIdFor(repo, 'IMPORTS', nodeId(a), nodeId(b));
          const model = edges.get(id);
          const result = store.edges.upsert(input);
          const same = model !== undefined && !model.deleted && model.confidence === confidence;
          expect(result.changed).toBe(!same);
          if (!same)
            edges.set(id, { confidence, deleted: false, version: (model?.version ?? 0) + 1 });
          edgeEnds.set(id, [nodeId(a), nodeId(b)]);
        }
      } else {
        const entries = [...edges.entries()];
        if (entries.length === 0) continue;
        const [id, model] = pick(entries);
        const result = store.edges.retire({ repositoryId: repo, edgeId: id, sourceEvidenceId: ev });
        expect(result.changed).toBe(!model.deleted);
        if (!model.deleted) edges.set(id, { ...model, deleted: true, version: model.version + 1 });
      }

      if (step % 50 === 0 || step === 399) {
        const liveNodes = [...nodes]
          .filter(([, m]) => !m.deleted)
          .map(([id]) => id)
          .sort();
        expect(
          store.nodes
            .find(repo, { type: 'File' })
            .map((n) => n.id)
            .sort(),
        ).toEqual(liveNodes);
        for (const [id, m] of nodes) {
          const got = store.nodes.get(repo, id);
          if (m.deleted) expect(got).toBeUndefined();
          else expect(got).toMatchObject({ version: m.version, attrs: m.attrs });
          expect(store.nodes.history(repo, id)).toHaveLength(m.version);
        }
        const visible = [...edges]
          .filter(
            ([id, m]) =>
              !m.deleted &&
              !nodes.get((edgeEnds.get(id) as [string, string])[0])?.deleted &&
              !nodes.get((edgeEnds.get(id) as [string, string])[1])?.deleted,
          )
          .map(([id]) => id)
          .sort();
        expect(
          store.edges
            .list(repo)
            .map((e) => e.id)
            .sort(),
        ).toEqual(visible);
      }
    }
    const report = store.verifyIntegrity(repo);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    db.close();
  });
});
