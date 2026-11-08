import { hashArtifact } from '@orbit/core';
import { neighbors } from '@orbit/graph';
import { IN_MEMORY, openDatabase, createGraphStore } from '@orbit/database';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assessMemoryFreshness,
  detectMemoryConflicts,
  getMemory,
  importMarkdownMemory,
  invalidateMemory,
  rememberMemory,
  searchMemories,
} from './memory.js';

const databases: ReturnType<typeof openDatabase>[] = [];
function setup() {
  const database = openDatabase({ path: IN_MEMORY });
  databases.push(database);
  const store = createGraphStore(database, { now: () => '2026-11-08T00:00:00.000Z' });
  const repository = store.repositories.register({
    key: 'test/memory',
    displayName: 'Memory Test',
  }).record;
  return { store, repository };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('ATLAS persistent memory', () => {
  it('creates a graph-backed fact and retrieves it lexically', () => {
    const { store, repository } = setup();
    const record = rememberMemory(store, {
      repositoryId: repository.id,
      key: 'architecture:api-boundary',
      kind: 'architecture',
      title: 'API boundary',
      summary: 'The API binds to loopback by default.',
      tags: ['Security', 'API'],
    });
    expect(record.version).toBe(1);
    expect(record.tags).toEqual(['api', 'security']);
    expect(searchMemories(store, repository.id, { query: 'loopback' })).toHaveLength(1);
    expect(getMemory(store, repository.id, record.key)?.id).toBe(record.id);
    expect(store.evidence.get(repository.id, record.evidenceId)?.status).toBe('NOT_MEASURED');
  });

  it('appends updates as new versions instead of replacing the old record', () => {
    const { store, repository } = setup();
    const input = {
      repositoryId: repository.id,
      key: 'decision:storage',
      kind: 'decision' as const,
      title: 'Storage',
      summary: 'Use SQLite.',
    };
    const first = rememberMemory(store, input);
    const second = rememberMemory(store, { ...input, summary: 'Use SQLite with WAL.' });
    expect(second.id).toBe(first.id);
    expect(second.version).toBe(2);
    expect(store.nodes.history(repository.id, first.id)).toHaveLength(2);
    expect(getMemory(store, repository.id, input.key)?.summary).toContain('WAL');
  });

  it('imports ADR markdown and reports explicit conflict declarations', () => {
    const { store, repository } = setup();
    const prior = importMarkdownMemory(store, {
      repositoryId: repository.id,
      path: 'docs/ADR-0003.md',
      content:
        '# ADR-0003: Use a file store\n\n## Context\nA document store was proposed.\n\n## Decision\nUse a file store.',
    });
    const adr = [
      '# ADR-0012: Use SQLite',
      '',
      '**Status:** Accepted',
      '**Tags:** storage, persistence',
      '**Supersedes:** ADR-0003',
      '**Conflicts with:** document:docs/ADR-0003.md',
      '',
      '## Context',
      'A local-first database is required.',
      '',
      '## Decision',
      'Use SQLite for the local graph store.',
    ].join('\n');
    const memory = importMarkdownMemory(store, {
      repositoryId: repository.id,
      path: 'docs/ADR-0012.md',
      content: adr,
    });
    expect(memory.kind).toBe('decision');
    expect(memory.title).toBe('ADR-0012: Use SQLite');
    expect(memory.tags).toContain('persistence');
    expect(memory.decisionStatus).toBe('Accepted');
    expect(
      neighbors(store, repository.id, memory.id, { direction: 'out', types: ['SUPERSEDES'] }).map(
        (item) => item.node.id,
      ),
    ).toContain(prior.id);
    expect(detectMemoryConflicts(store, repository.id)[0]).toMatchObject({
      relation: 'explicit-conflict',
      referencedKey: 'document:docs/ADR-0003.md',
    });
  });

  it('compares imported source hashes and marks freshness as current or stale', () => {
    const { store, repository } = setup();
    const content = '# Architecture\n\n## Summary\nA stable graph.';
    const memory = importMarkdownMemory(store, {
      repositoryId: repository.id,
      path: 'docs/ARCH.md',
      content,
    });
    const same = assessMemoryFreshness(store, repository.id, [
      { path: 'docs/ARCH.md', sha256: hashArtifact(content) },
    ]);
    const changed = assessMemoryFreshness(store, repository.id, [
      { path: 'docs/ARCH.md', sha256: 'a'.repeat(64) },
    ]);
    expect(same.items.find((item) => item.id === memory.id)?.stale).toBe('current');
    expect(changed.items.find((item) => item.id === memory.id)?.stale).toBe('stale');
    expect(changed.stale).toBe(1);
  });

  it('invalidates with a tombstone while retaining historical versions', () => {
    const { store, repository } = setup();
    const memory = rememberMemory(store, {
      repositoryId: repository.id,
      key: 'fact:temporary',
      kind: 'fact',
      title: 'Temporary note',
      summary: 'This note will be invalidated.',
    });
    expect(invalidateMemory(store, repository.id, memory.key, 'Source was incorrect')).toBe(true);
    expect(getMemory(store, repository.id, memory.key)).toBeUndefined();
    expect(store.nodes.history(repository.id, memory.id)).toHaveLength(2);
    expect(store.nodes.history(repository.id, memory.id).at(-1)?.deleted).toBe(true);
  });
});
