import { describe, expect, it } from 'vitest';
import { EDGE_RULES, assertEdgeAllowed, isEdgeAllowed } from './rules.js';
import { EDGE_TYPES, NODE_TYPES } from './vocabulary.js';

describe('edge rules', () => {
  it('defines a rule for every relationship type', () => {
    expect(Object.keys(EDGE_RULES).sort()).toEqual([...EDGE_TYPES].sort());
  });

  it('only references known node types', () => {
    const known = new Set<string>(NODE_TYPES);
    for (const rule of Object.values(EDGE_RULES)) {
      for (const type of [...rule.from, ...rule.to]) expect(known.has(type)).toBe(true);
    }
  });

  it.each([
    ['IMPORTS', 'File', 'File'],
    ['IMPORTS', 'File', 'Dependency'],
    ['CALLS', 'Function', 'Function'],
    ['TESTS', 'Test', 'Function'],
    ['MODIFIES', 'Commit', 'File'],
    ['RUNS_IN', 'TestRun', 'Environment'],
    ['OBSERVED_ON', 'TelemetrySession', 'Firmware'],
    ['VERIFIED_BY', 'ChangePassport', 'TelemetrySession'],
    ['SUPERSEDES', 'Decision', 'Decision'],
    ['DOCUMENTS', 'Decision', 'Commit'],
    ['DOCUMENTS', 'Decision', 'PullRequest'],
    ['DOCUMENTS', 'Documentation', 'Issue'],
  ] as const)('allows %s from %s to %s', (type, from, to) => {
    expect(isEdgeAllowed(type, from, to)).toBe(true);
    expect(() => assertEdgeAllowed(type, from, to)).not.toThrow();
  });

  it.each([
    ['CALLS', 'File', 'Function'],
    ['TESTS', 'Function', 'Test'],
    ['MODIFIES', 'File', 'Commit'],
    ['FIXES', 'Commit', 'File'],
    ['OBSERVED_ON', 'Commit', 'HardwareDevice'],
    ['VERIFIED_BY', 'File', 'TestRun'],
    ['DOCUMENTS', 'Commit', 'Decision'],
  ] as const)('rejects %s from %s to %s', (type, from, to) => {
    expect(isEdgeAllowed(type, from, to)).toBe(false);
    expect(() => assertEdgeAllowed(type, from, to)).toThrowError(/not allowed/);
  });

  it('requires both ends of SUPERSEDES to have the same type', () => {
    expect(isEdgeAllowed('SUPERSEDES', 'Decision', 'Documentation')).toBe(false);
    expect(isEdgeAllowed('SUPERSEDES', 'ChangePassport', 'ChangePassport')).toBe(true);
  });
});
