import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashArtifact } from '@orbit/core';
import {
  IN_MEMORY,
  createGraphStore,
  openDatabase,
  type GraphStore,
  type OrbitDatabase,
} from './index.js';

const SHA_B = 'b'.repeat(40);

let database: OrbitDatabase;
let store: GraphStore;
let tick = 0;

function clock(): string {
  tick += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString();
}

function raw(statement: string): void {
  database.db.run(sql.raw(statement));
}

function setup(): { repo: string; ev: string } {
  const repo = store.repositories.register({ key: 'github.com/acme/app' }).record.id;
  const ev = store.evidence.append({
    repositoryId: repo,
    source: 'git:parser',
    sourceType: 'parser',
    contentHash: hashArtifact('scan-1'),
    status: 'PASS',
    limitations: [],
    relatedEntityIds: [],
  }).record.id;
  return { repo, ev };
}

beforeEach(() => {
  tick = 0;
  database = openDatabase({ path: IN_MEMORY });
  store = createGraphStore(database, { now: clock });
});

afterEach(() => {
  database.close();
});

describe('repositories', () => {
  it('registers idempotently', () => {
    const first = store.repositories.register({ key: 'github.com/acme/app' });
    const second = store.repositories.register({ key: 'github.com/acme/app' });
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(store.repositories.list()).toHaveLength(1);
  });

  it('rejects an empty key', () => {
    expect(() => store.repositories.register({ key: '' })).toThrowError(/Invalid repository/);
  });
});

describe('evidence', () => {
  it('lists evidence recorded in the same millisecond in insertion order', () => {
    const fixed = '2026-01-01T00:00:00.000Z';
    const tied = createGraphStore(database, { now: () => fixed });
    const repo = tied.repositories.register({ key: 'github.com/acme/tied' }).record.id;
    const sources: string[] = [];
    for (let i = 0; i < 20; i++) {
      sources.push(`test:${i}`);
      tied.evidence.append({
        repositoryId: repo,
        source: `test:${i}`,
        sourceType: 'manual',
        contentHash: hashArtifact(`tie-${i}`),
        status: 'PASS',
        limitations: [],
        relatedEntityIds: [],
      });
    }
    expect(tied.evidence.list(repo, {}).map((e) => e.source)).toEqual(sources);
  });

  it('is content-addressed and idempotent', () => {
    const { repo } = setup();
    const input = {
      repositoryId: repo,
      source: 'ci:run-1',
      sourceType: 'test-report',
      contentHash: hashArtifact('report'),
      status: 'FAIL',
      limitations: [],
      relatedEntityIds: [],
    };
    const a = store.evidence.append(input);
    const b = store.evidence.append({ ...input });
    expect(a.changed).toBe(true);
    expect(b.changed).toBe(false);
    expect(b.record.id).toBe(a.record.id);
  });

  it('pages through evidence with a stable recorded-at and id order', () => {
    const { repo } = setup();
    for (const value of ['report-a', 'report-b', 'report-c']) {
      store.evidence.append({
        repositoryId: repo,
        source: value,
        sourceType: 'test-report',
        contentHash: hashArtifact(value),
        status: 'PASS',
        limitations: [],
        relatedEntityIds: [],
      });
    }

    const page1 = store.evidence.list(repo, { sourceType: 'test-report', limit: 2 });
    const page2 = store.evidence.list(repo, {
      sourceType: 'test-report',
      limit: 2,
      offset: 2,
    });
    expect([...page1, ...page2].map((item) => item.source)).toEqual([
      'report-a',
      'report-b',
      'report-c',
    ]);
    expect(() => store.evidence.list(repo, { offset: -1 })).toThrowError(/offset/);
  });

  it('requires a registered repository', () => {
    expect(() =>
      store.evidence.append({
        repositoryId: 'r_missing',
        source: 's',
        sourceType: 'manual',
        contentHash: hashArtifact('x'),
        status: 'PASS',
        limitations: [],
        relatedEntityIds: [],
      }),
    ).toThrowError(/not registered/);
  });

  it('verifies an artifact against its recorded hash', () => {
    const { repo, ev } = setup();
    expect(store.evidence.verifyArtifact(repo, ev, 'scan-1')).toBe(true);
    expect(store.evidence.verifyArtifact(repo, ev, 'scan-2')).toBe(false);
  });

  it('supersedes at most once and only within a repository', () => {
    const { repo, ev } = setup();
    const base = {
      repositoryId: repo,
      source: 'git:parser',
      sourceType: 'parser',
      contentHash: hashArtifact('scan-2'),
      status: 'PASS',
      limitations: [],
      relatedEntityIds: [],
      supersedes: ev,
    };
    expect(store.evidence.append(base).changed).toBe(true);
    expect(() =>
      store.evidence.append({ ...base, contentHash: hashArtifact('scan-3') }),
    ).toThrowError(/already been superseded/);
    expect(() => store.evidence.append({ ...base, supersedes: 'ev_nope' })).toThrowError(
      /supersedes/,
    );
  });

  it('finds evidence by related entity', () => {
    const { repo, ev } = setup();
    const node = store.nodes.upsert({
      repositoryId: repo,
      type: 'File',
      key: 'src/a.ts',
      sourceEvidenceId: ev,
    }).record;
    store.evidence.append({
      repositoryId: repo,
      source: 'coverage',
      sourceType: 'coverage',
      contentHash: hashArtifact('cov'),
      status: 'PARTIAL',
      limitations: ['branch coverage not collected'],
      relatedEntityIds: [node.id],
    });
    const found = store.evidence.forEntity(repo, node.id);
    expect(found).toHaveLength(1);
    expect(found[0]?.status).toBe('PARTIAL');
  });
});

describe('nodes', () => {
  it('requires existing evidence', () => {
    const { repo } = setup();
    expect(() =>
      store.nodes.upsert({
        repositoryId: repo,
        type: 'File',
        key: 'a.ts',
        sourceEvidenceId: 'ev_nope',
      }),
    ).toThrowError(/does not exist/);
  });

  it('is idempotent for identical content and versions on change', () => {
    const { repo, ev } = setup();
    const input = {
      repositoryId: repo,
      type: 'File',
      key: 'src/a.ts',
      attrs: { lines: 10 },
      sourceEvidenceId: ev,
    };
    const v1 = store.nodes.upsert(input);
    const same = store.nodes.upsert({ ...input });
    const v2 = store.nodes.upsert({ ...input, attrs: { lines: 12 }, validFromCommit: SHA_B });
    expect(v1.record.version).toBe(1);
    expect(same.changed).toBe(false);
    expect(v2.record.version).toBe(2);
    expect(store.nodes.get(repo, v1.record.id)?.attrs).toEqual({ lines: 12 });
    const history = store.nodes.history(repo, v1.record.id);
    expect(history.map((h) => h.version)).toEqual([1, 2]);
    expect(history[0]?.validToCommit).toBe(SHA_B);
    expect(history[1]?.validToCommit).toBeNull();
  });

  it('retires with a tombstone, keeps history, and can be revived', () => {
    const { repo, ev } = setup();
    const input = { repositoryId: repo, type: 'File', key: 'src/a.ts', sourceEvidenceId: ev };
    const node = store.nodes.upsert(input).record;
    const retired = store.nodes.retire({
      repositoryId: repo,
      nodeId: node.id,
      sourceEvidenceId: ev,
    });
    expect(retired.changed).toBe(true);
    expect(retired.record.deleted).toBe(true);
    expect(store.nodes.get(repo, node.id)).toBeUndefined();
    expect(store.nodes.find(repo)).toHaveLength(0);
    expect(
      store.nodes.retire({ repositoryId: repo, nodeId: node.id, sourceEvidenceId: ev }).changed,
    ).toBe(false);
    expect(store.nodes.history(repo, node.id)).toHaveLength(2);
    const revived = store.nodes.upsert(input);
    expect(revived.changed).toBe(true);
    expect(revived.record.version).toBe(3);
    expect(store.nodes.get(repo, node.id)).toBeDefined();
  });

  it('finds by type and key prefix in deterministic order', () => {
    const { repo, ev } = setup();
    for (const key of ['src/b.ts', 'src/a.ts', 'test/a.test.ts']) {
      store.nodes.upsert({ repositoryId: repo, type: 'File', key, sourceEvidenceId: ev });
    }
    store.nodes.upsert({ repositoryId: repo, type: 'Module', key: 'src', sourceEvidenceId: ev });
    expect(store.nodes.find(repo, { type: 'File', keyPrefix: 'src/' }).map((n) => n.key)).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
    expect(store.nodes.find(repo, { type: 'Module' })).toHaveLength(1);
    expect(() => store.nodes.find(repo, { limit: 0 })).toThrowError(/limit/);
  });

  it('treats keyPrefix literally (no wildcard injection)', () => {
    const { repo, ev } = setup();
    store.nodes.upsert({ repositoryId: repo, type: 'File', key: 'a%b.ts', sourceEvidenceId: ev });
    store.nodes.upsert({ repositoryId: repo, type: 'File', key: 'axxb.ts', sourceEvidenceId: ev });
    expect(store.nodes.find(repo, { keyPrefix: 'a%' })).toHaveLength(1);
  });
});

describe('edges', () => {
  function two(): { repo: string; ev: string; a: string; b: string } {
    const { repo, ev } = setup();
    const a = store.nodes.upsert({
      repositoryId: repo,
      type: 'File',
      key: 'src/a.ts',
      sourceEvidenceId: ev,
    }).record.id;
    const b = store.nodes.upsert({
      repositoryId: repo,
      type: 'File',
      key: 'src/b.ts',
      sourceEvidenceId: ev,
    }).record.id;
    return { repo, ev, a, b };
  }

  it('creates, dedupes and lists edges', () => {
    const { repo, ev, a, b } = two();
    const input = {
      repositoryId: repo,
      type: 'IMPORTS',
      fromId: a,
      toId: b,
      confidence: 1,
      sourceEvidenceId: ev,
    };
    const first = store.edges.upsert(input);
    expect(first.changed).toBe(true);
    expect(store.edges.upsert({ ...input }).changed).toBe(false);
    expect(store.edges.list(repo, { fromId: a })).toHaveLength(1);
    expect(store.edges.list(repo, { toId: a })).toHaveLength(0);
    expect(store.edges.list(repo, { types: ['CALLS'] })).toHaveLength(0);
    expect(store.edges.list(repo, { types: [] })).toHaveLength(0);
  });

  it('rejects relationships the rule table forbids', () => {
    const { repo, ev, a, b } = two();
    expect(() =>
      store.edges.upsert({
        repositoryId: repo,
        type: 'TESTS',
        fromId: a,
        toId: b,
        sourceEvidenceId: ev,
      }),
    ).toThrowError(/not allowed/);
  });

  it('rejects self loops, missing endpoints and cross-repository endpoints', () => {
    const { repo, ev, a } = two();
    expect(() =>
      store.edges.upsert({
        repositoryId: repo,
        type: 'IMPORTS',
        fromId: a,
        toId: a,
        sourceEvidenceId: ev,
      }),
    ).toThrowError(/itself/);
    expect(() =>
      store.edges.upsert({
        repositoryId: repo,
        type: 'IMPORTS',
        fromId: a,
        toId: 'n_nope',
        sourceEvidenceId: ev,
      }),
    ).toThrowError(/does not exist/);

    const other = store.repositories.register({ key: 'github.com/acme/other' }).record.id;
    const otherEv = store.evidence.append({
      repositoryId: other,
      source: 'x',
      sourceType: 'manual',
      contentHash: hashArtifact('o'),
      status: 'PASS',
      limitations: [],
      relatedEntityIds: [],
    }).record.id;
    const foreign = store.nodes.upsert({
      repositoryId: other,
      type: 'File',
      key: 'src/a.ts',
      sourceEvidenceId: otherEv,
    }).record.id;
    expect(() =>
      store.edges.upsert({
        repositoryId: repo,
        type: 'IMPORTS',
        fromId: a,
        toId: foreign,
        sourceEvidenceId: ev,
      }),
    ).toThrowError(/does not exist/);
  });

  it('versions on change and retires', () => {
    const { repo, ev, a, b } = two();
    const base = { repositoryId: repo, type: 'IMPORTS', fromId: a, toId: b, sourceEvidenceId: ev };
    const e1 = store.edges.upsert({ ...base, confidence: 0.5 }).record;
    const e2 = store.edges.upsert({ ...base, confidence: 0.9 }).record;
    expect(e2.version).toBe(2);
    expect(store.edges.history(repo, e1.id).map((h) => h.confidence)).toEqual([0.5, 0.9]);
    const retired = store.edges.retire({ repositoryId: repo, edgeId: e1.id, sourceEvidenceId: ev });
    expect(retired.changed).toBe(true);
    expect(store.edges.get(repo, e1.id)).toBeUndefined();
    expect(store.edges.list(repo)).toHaveLength(0);
  });

  it('hides edges whose endpoint is retired, and shows them again when it is revived', () => {
    const { repo, ev, a, b } = two();
    const edge = store.edges.upsert({
      repositoryId: repo,
      type: 'IMPORTS',
      fromId: a,
      toId: b,
      sourceEvidenceId: ev,
    }).record;
    store.nodes.retire({ repositoryId: repo, nodeId: b, sourceEvidenceId: ev });
    expect(store.edges.list(repo)).toHaveLength(0);
    expect(store.edges.get(repo, edge.id)).toBeUndefined();
    store.nodes.upsert({ repositoryId: repo, type: 'File', key: 'src/b.ts', sourceEvidenceId: ev });
    expect(store.edges.list(repo)).toHaveLength(1);
  });

  it('hides edges whose endpoint was retired from further writes', () => {
    const { repo, ev, a, b } = two();
    store.nodes.retire({ repositoryId: repo, nodeId: b, sourceEvidenceId: ev });
    expect(() =>
      store.edges.upsert({
        repositoryId: repo,
        type: 'IMPORTS',
        fromId: a,
        toId: b,
        sourceEvidenceId: ev,
      }),
    ).toThrowError(/does not exist/);
  });
});

describe('repository isolation', () => {
  it('never returns another repository’s data', () => {
    const { repo, ev } = setup();
    const node = store.nodes.upsert({
      repositoryId: repo,
      type: 'File',
      key: 'a.ts',
      sourceEvidenceId: ev,
    }).record;
    const other = store.repositories.register({ key: 'github.com/acme/other' }).record.id;
    expect(store.nodes.get(other, node.id)).toBeUndefined();
    expect(store.nodes.find(other)).toHaveLength(0);
    expect(store.evidence.get(other, ev)).toBeUndefined();
    expect(store.evidence.list(other)).toHaveLength(0);
    expect(store.nodes.history(other, node.id)).toHaveLength(0);
    expect(() =>
      store.nodes.retire({ repositoryId: other, nodeId: node.id, sourceEvidenceId: ev }),
    ).toThrowError();
  });
});

describe('ledger', () => {
  it('chains entries per repository from a genesis hash', () => {
    const { repo, ev } = setup();
    store.nodes.upsert({ repositoryId: repo, type: 'File', key: 'a.ts', sourceEvidenceId: ev });
    const entries = store.ledger.entries(repo);
    expect(entries.map((e) => e.op)).toEqual([
      'repository.register',
      'evidence.append',
      'node.version',
    ]);
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(entries[0]?.prevHash).toBe('0'.repeat(64));
    expect(entries[1]?.prevHash).toBe(entries[0]?.hash);
    expect(store.ledger.head(repo)?.seq).toBe(3);
    expect(store.ledger.entries(repo, { afterSeq: 2 })).toHaveLength(1);
  });

  it('does not write ledger entries for no-op writes', () => {
    const { repo, ev } = setup();
    const input = { repositoryId: repo, type: 'File', key: 'a.ts', sourceEvidenceId: ev };
    store.nodes.upsert(input);
    const before = store.ledger.head(repo)?.seq;
    store.nodes.upsert({ ...input });
    expect(store.ledger.head(repo)?.seq).toBe(before);
  });

  it('is deterministic with a fixed clock', () => {
    function build(): string[] {
      const db = openDatabase({ path: IN_MEMORY });
      let n = 0;
      const s = createGraphStore(db, {
        now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++n)).toISOString(),
      });
      const repo = s.repositories.register({ key: 'k' }).record.id;
      const ev = s.evidence.append({
        repositoryId: repo,
        source: 's',
        sourceType: 'manual',
        contentHash: hashArtifact('x'),
        status: 'PASS',
        limitations: [],
        relatedEntityIds: [],
      }).record.id;
      s.nodes.upsert({ repositoryId: repo, type: 'File', key: 'a.ts', sourceEvidenceId: ev });
      const hashes = s.ledger.entries(repo).map((e) => e.hash);
      db.close();
      return hashes;
    }
    expect(build()).toEqual(build());
  });
});

describe('immutability and integrity', () => {
  it('blocks UPDATE and DELETE on append-only tables', () => {
    const { repo } = setup();
    const causeOf = (statement: string): string => {
      try {
        raw(statement);
      } catch (error) {
        return String((error as { cause?: unknown }).cause ?? error);
      }
      return 'NO ERROR';
    };
    expect(causeOf(`update evidence set status = 'FAIL' where repository_id = '${repo}'`)).toMatch(
      /ORBIT_IMMUTABLE/,
    );
    expect(causeOf(`delete from ledger where repository_id = '${repo}'`)).toMatch(
      /ORBIT_IMMUTABLE/,
    );
    expect(causeOf(`update repositories set key = 'x'`)).toMatch(/ORBIT_IMMUTABLE/);
  });

  it('reports a clean store as ok', () => {
    const { repo, ev } = setup();
    const a = store.nodes.upsert({
      repositoryId: repo,
      type: 'File',
      key: 'a.ts',
      sourceEvidenceId: ev,
    }).record.id;
    const b = store.nodes.upsert({
      repositoryId: repo,
      type: 'File',
      key: 'b.ts',
      sourceEvidenceId: ev,
    }).record.id;
    store.edges.upsert({
      repositoryId: repo,
      type: 'IMPORTS',
      fromId: a,
      toId: b,
      sourceEvidenceId: ev,
    });
    const report = store.verifyIntegrity(repo);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.ledgerEntriesChecked).toBe(5);
  });

  it('detects tampering made by bypassing the triggers', () => {
    const { repo, ev } = setup();
    store.nodes.upsert({
      repositoryId: repo,
      type: 'File',
      key: 'a.ts',
      attrs: { lines: 1 },
      sourceEvidenceId: ev,
    });
    raw('drop trigger node_versions_no_update');
    raw(`update node_versions set attrs_json = '{"lines":999}'`);
    const report = store.verifyIntegrity(repo);
    expect(report.ok).toBe(false);
    expect(report.problems.map((p) => p.code)).toContain('ATTRS_HASH_MISMATCH');
  });

  it('detects a rewritten ledger entry', () => {
    const { repo, ev } = setup();
    store.nodes.upsert({ repositoryId: repo, type: 'File', key: 'a.ts', sourceEvidenceId: ev });
    raw('drop trigger ledger_no_update');
    raw(`update ledger set ts = '1999-01-01T00:00:00.000Z' where seq = 2`);
    const report = store.verifyIntegrity(repo);
    expect(report.ok).toBe(false);
    expect(report.problems.map((p) => p.code)).toContain('LEDGER_HASH_MISMATCH');
  });

  it('detects a deleted ledger entry', () => {
    const { repo, ev } = setup();
    store.nodes.upsert({ repositoryId: repo, type: 'File', key: 'a.ts', sourceEvidenceId: ev });
    raw('drop trigger ledger_no_delete');
    raw(`delete from ledger where seq = 2`);
    const codes = store.verifyIntegrity(repo).problems.map((p) => p.code);
    expect(codes).toContain('LEDGER_GAP');
  });

  it('detects altered evidence', () => {
    const { repo } = setup();
    raw('drop trigger evidence_no_update');
    raw(`update evidence set status = 'FAIL'`);
    const codes = store.verifyIntegrity(repo).problems.map((p) => p.code);
    expect(codes).toContain('EVIDENCE_ID_MISMATCH');
  });

  it('detects records inserted behind the ledger', () => {
    const { repo, ev } = setup();
    raw(
      `insert into nodes (id, repository_id, type, key, created_at) values ('n_rogue', '${repo}', 'File', 'rogue.ts', 't')`,
    );
    raw(
      `insert into node_versions (node_id, version, attrs_json, attrs_hash, deleted, evidence_id, recorded_at) values ('n_rogue', 1, '{}', 'h', 0, '${ev}', 't')`,
    );
    const codes = store.verifyIntegrity(repo).problems.map((p) => p.code);
    expect(codes).toContain('MISSING_LEDGER_ENTRY');
  });
});

describe('paging and transactions', () => {
  it('pages through nodes and edges with offset', () => {
    const { repo, ev } = setup();
    const ids = ['a', 'b', 'c', 'd'].map(
      (k) =>
        store.nodes.upsert({
          repositoryId: repo,
          type: 'File',
          key: `${k}.ts`,
          sourceEvidenceId: ev,
        }).record.id,
    );
    store.edges.upsert({
      repositoryId: repo,
      type: 'IMPORTS',
      fromId: ids[0]!,
      toId: ids[1]!,
      sourceEvidenceId: ev,
    });
    store.edges.upsert({
      repositoryId: repo,
      type: 'IMPORTS',
      fromId: ids[0]!,
      toId: ids[2]!,
      sourceEvidenceId: ev,
    });
    const page1 = store.nodes.find(repo, { limit: 3 });
    const page2 = store.nodes.find(repo, { limit: 3, offset: 3 });
    expect([...page1, ...page2].map((n) => n.key)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
    expect(store.edges.list(repo, { limit: 1, offset: 1 })).toHaveLength(1);
    expect(() => store.nodes.find(repo, { offset: -1 })).toThrowError(/offset/);
  });

  it('rolls back every write, including ledger entries, when the callback throws', () => {
    const { repo, ev } = setup();
    const before = store.ledger.head(repo)?.seq;
    expect(() =>
      store.transaction(() => {
        store.nodes.upsert({ repositoryId: repo, type: 'File', key: 'a.ts', sourceEvidenceId: ev });
        throw new Error('boom');
      }),
    ).toThrowError('boom');
    expect(store.nodes.find(repo)).toHaveLength(0);
    expect(store.ledger.head(repo)?.seq).toBe(before);
    expect(store.verifyIntegrity(repo).ok).toBe(true);
  });

  it('commits nested writes together', () => {
    const { repo, ev } = setup();
    store.transaction(() => {
      store.nodes.upsert({ repositoryId: repo, type: 'File', key: 'a.ts', sourceEvidenceId: ev });
      store.nodes.upsert({ repositoryId: repo, type: 'File', key: 'b.ts', sourceEvidenceId: ev });
    });
    expect(store.nodes.find(repo)).toHaveLength(2);
    expect(store.verifyIntegrity(repo).ok).toBe(true);
  });
});
