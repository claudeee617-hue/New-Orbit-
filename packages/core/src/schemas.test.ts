import { describe, expect, it } from 'vitest';
import { hashArtifact } from './canonical.js';
import { edgeIdFor, evidenceIdFor, nodeIdFor, repositoryIdFor } from './ids.js';
import {
  edgeInputSchema,
  evidenceInputSchema,
  nodeInputSchema,
  parseInput,
  repositoryInputSchema,
} from './schemas.js';

const REPO = 'r_test';
const HASH = hashArtifact('artifact');

function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repositoryId: REPO,
    source: 'file:coverage/lcov.info',
    sourceType: 'coverage',
    contentHash: HASH,
    status: 'PASS',
    limitations: [],
    relatedEntityIds: [],
    ...overrides,
  };
}

describe('evidence input', () => {
  it('accepts a minimal record and normalises it', () => {
    const parsed = parseInput(
      evidenceInputSchema,
      evidence({
        contentHash: HASH.toUpperCase(),
        commitSha: 'ABCDEF1234567',
        location: { path: '.\\src\\a.ts', startLine: 3, endLine: 9 },
        relatedEntityIds: ['n_b', 'n_a', 'n_b'],
      }),
      'evidence',
    );
    expect(parsed.contentHash).toBe(HASH);
    expect(parsed.commitSha).toBe('abcdef1234567');
    expect(parsed.location?.path).toBe('src/a.ts');
    expect(parsed.relatedEntityIds).toEqual(['n_a', 'n_b']);
  });

  it('rejects unknown properties (typos and smuggled fields)', () => {
    expect(() => parseInput(evidenceInputSchema, evidence({ extra: 1 }), 'evidence')).toThrowError(
      /Invalid evidence/,
    );
  });

  it.each([
    ['a bad status', { status: 'GREAT' }],
    ['a bad source type', { sourceType: 'rumour' }],
    ['a short hash', { contentHash: 'abc' }],
    ['a non-hex hash', { contentHash: 'z'.repeat(64) }],
    ['a bad commit SHA', { commitSha: 'not-a-sha' }],
    ['a traversal path', { location: { path: '../../etc/passwd' } }],
    ['an absolute path', { location: { path: '/etc/passwd' } }],
    ['an inverted line range', { location: { path: 'a.ts', startLine: 9, endLine: 3 } }],
    ['line zero', { location: { path: 'a.ts', startLine: 0 } }],
    ['a bad timestamp', { timestamp: 'yesterday' }],
    ['an empty source', { source: '' }],
  ])('rejects %s', (_name, overrides) => {
    expect(() => parseInput(evidenceInputSchema, evidence(overrides), 'evidence')).toThrowError();
  });

  it.each(['NOT_MEASURED', 'INCOMPLETE'])('requires a limitation for %s', (status) => {
    expect(() => parseInput(evidenceInputSchema, evidence({ status }), 'evidence')).toThrowError(
      /explain why/,
    );
    expect(() =>
      parseInput(
        evidenceInputSchema,
        evidence({ status, limitations: ['No coverage file supplied'] }),
        'evidence',
      ),
    ).not.toThrow();
  });

  it('never allows an AI note to claim PASS', () => {
    expect(() =>
      parseInput(
        evidenceInputSchema,
        evidence({ sourceType: 'ai-note', status: 'PASS' }),
        'evidence',
      ),
    ).toThrowError(/never have status PASS/);
    expect(() =>
      parseInput(
        evidenceInputSchema,
        evidence({
          sourceType: 'ai-note',
          status: 'PARTIAL',
          limitations: ['Model-generated hypothesis'],
        }),
        'evidence',
      ),
    ).not.toThrow();
  });

  it('does not echo submitted values in error messages', () => {
    try {
      parseInput(evidenceInputSchema, evidence({ contentHash: 'SECRET-TOKEN-VALUE' }), 'evidence');
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('SECRET-TOKEN-VALUE');
      expect(error).toMatchObject({ code: 'INVALID_INPUT' });
    }
  });
});

describe('derived identifiers', () => {
  it('derives the same evidence ID for the same content, regardless of key order', () => {
    const a = parseInput(evidenceInputSchema, evidence(), 'evidence');
    const b = parseInput(
      evidenceInputSchema,
      {
        relatedEntityIds: [],
        limitations: [],
        status: 'PASS',
        contentHash: HASH,
        sourceType: 'coverage',
        source: 'file:coverage/lcov.info',
        repositoryId: REPO,
      },
      'evidence',
    );
    expect(evidenceIdFor(a)).toBe(evidenceIdFor(b));
  });

  it('derives a different evidence ID when any identifying field changes', () => {
    const base = parseInput(evidenceInputSchema, evidence(), 'evidence');
    const changed = parseInput(evidenceInputSchema, evidence({ status: 'FAIL' }), 'evidence');
    const other = parseInput(
      evidenceInputSchema,
      evidence({ source: 'file:other.info' }),
      'evidence',
    );
    expect(new Set([evidenceIdFor(base), evidenceIdFor(changed), evidenceIdFor(other)]).size).toBe(
      3,
    );
  });

  it('derives stable, distinct node, edge and repository IDs', () => {
    expect(repositoryIdFor('a')).toBe(repositoryIdFor('a'));
    expect(repositoryIdFor('a')).not.toBe(repositoryIdFor('b'));
    const file = nodeIdFor(REPO, 'File', 'a.ts');
    expect(file).toBe(nodeIdFor(REPO, 'File', 'a.ts'));
    expect(file).not.toBe(nodeIdFor(REPO, 'Module', 'a.ts'));
    expect(file).not.toBe(nodeIdFor('r_other', 'File', 'a.ts'));
    expect(edgeIdFor(REPO, 'IMPORTS', 'n_a', 'n_b')).not.toBe(
      edgeIdFor(REPO, 'IMPORTS', 'n_b', 'n_a'),
    );
    expect(file).toMatch(/^n_[0-9a-f]{32}$/);
  });
});

describe('node input', () => {
  const node = (overrides: Record<string, unknown> = {}) => ({
    repositoryId: REPO,
    type: 'File',
    key: 'src/a.ts',
    sourceEvidenceId: 'ev_1',
    ...overrides,
  });

  it('defaults attrs to an empty object and normalises File paths', () => {
    const parsed = parseInput(nodeInputSchema, node({ key: '.\\src\\a.ts' }), 'node');
    expect(parsed.key).toBe('src/a.ts');
    expect(parsed.attrs).toEqual({});
  });

  it('lower-cases Commit SHAs and rejects non-hex keys', () => {
    expect(parseInput(nodeInputSchema, node({ type: 'Commit', key: 'ABCDEF1' }), 'node').key).toBe(
      'abcdef1',
    );
    expect(() =>
      parseInput(nodeInputSchema, node({ type: 'Commit', key: 'main' }), 'node'),
    ).toThrowError();
  });

  it('rejects traversal in File keys but allows arbitrary keys for other types', () => {
    expect(() => parseInput(nodeInputSchema, node({ key: '../x' }), 'node')).toThrowError();
    expect(parseInput(nodeInputSchema, node({ type: 'Symbol', key: '../x#y' }), 'node').key).toBe(
      '../x#y',
    );
  });

  it('rejects non-JSON attrs and oversized attrs', () => {
    expect(() =>
      parseInput(nodeInputSchema, node({ attrs: { f: () => 1 } }), 'node'),
    ).toThrowError();
    expect(() =>
      parseInput(nodeInputSchema, node({ attrs: { big: 'x'.repeat(70 * 1024) } }), 'node'),
    ).toThrowError(/at most/);
  });

  it('rejects unknown node types and missing evidence', () => {
    expect(() => parseInput(nodeInputSchema, node({ type: 'Widget' }), 'node')).toThrowError();
    const { sourceEvidenceId: _omit, ...withoutEvidence } = node();
    expect(() => parseInput(nodeInputSchema, withoutEvidence, 'node')).toThrowError();
  });
});

describe('edge and repository input', () => {
  it('accepts an edge and bounds confidence to [0, 1]', () => {
    const base = {
      repositoryId: REPO,
      type: 'IMPORTS',
      fromId: 'n_a',
      toId: 'n_b',
      sourceEvidenceId: 'ev_1',
    };
    expect(parseInput(edgeInputSchema, { ...base, confidence: 0.8 }, 'edge').confidence).toBe(0.8);
    expect(() => parseInput(edgeInputSchema, { ...base, confidence: 1.5 }, 'edge')).toThrowError();
    expect(() => parseInput(edgeInputSchema, { ...base, type: 'LOVES' }, 'edge')).toThrowError();
  });

  it('requires a repository key', () => {
    expect(() => parseInput(repositoryInputSchema, { key: '' }, 'repository')).toThrowError();
    expect(
      parseInput(repositoryInputSchema, { key: 'github.com/acme/app' }, 'repository').key,
    ).toBe('github.com/acme/app');
  });
});
