import { describe, expect, it } from 'vitest';
import {
  calculateBusinessPipelineSummary,
  emptyBusinessWorkspace,
  normaliseBusinessWorkspace,
  parseBusinessWorkspace,
  serialiseBusinessWorkspace,
  type BusinessOpportunity,
} from './operations.js';

const sample: BusinessOpportunity[] = [
  {
    id: 'acme',
    account: 'Acme Engineering',
    segment: 'product-engineering',
    stage: 'qualified',
    estimatedMonthlyValue: 12000,
    nextAction: 'Schedule technical walkthrough',
    dueDate: '2026-11-12',
    evidence: 'Team reported repeated test-triage work.',
  },
  {
    id: 'embedded-labs',
    account: 'Embedded Labs',
    segment: 'embedded-iot',
    stage: 'pilot',
    estimatedMonthlyValue: 8000,
    nextAction: 'Review pilot outcomes',
    dueDate: '2026-11-20',
    evidence: '',
  },
  {
    id: 'won-team',
    account: 'Won Team',
    segment: 'consultancy',
    stage: 'won',
    estimatedMonthlyValue: 5000,
    nextAction: '',
    dueDate: '',
    evidence: '',
  },
  {
    id: 'lost-team',
    account: 'Lost Team',
    segment: 'enterprise',
    stage: 'lost',
    estimatedMonthlyValue: 9000,
    nextAction: '',
    dueDate: '',
    evidence: '',
  },
];

describe('Business operations workspace', () => {
  it('starts empty and round-trips a validated JSON backup', () => {
    expect(emptyBusinessWorkspace().opportunities).toEqual([]);
    const workspace = { version: 1 as const, opportunities: sample };
    const restored = parseBusinessWorkspace(serialiseBusinessWorkspace(workspace));
    expect(restored).toEqual(workspace);
  });

  it('summarises open pipeline without counting won or lost opportunities', () => {
    const result = calculateBusinessPipelineSummary(
      { version: 1, opportunities: sample },
      '2026-11-12',
    );
    expect(result.activeAccounts).toBe(2);
    expect(result.qualifiedAccounts).toBe(2);
    expect(result.pilotAccounts).toBe(1);
    expect(result.wonAccounts).toBe(1);
    expect(result.dueFollowUps).toBe(1);
    expect(result.openPipelineEstimate).toBe(20000);
  });

  it('rejects unknown versions, invalid stages, duplicate IDs and invalid dates', () => {
    expect(() => normaliseBusinessWorkspace({ version: 2, opportunities: [] })).toThrow(
      'Unsupported Business workspace version',
    );
    expect(() =>
      normaliseBusinessWorkspace({
        version: 1,
        opportunities: [{ ...sample[0], stage: 'maybe' }],
      }),
    ).toThrow('unsupported stage');
    expect(() =>
      normaliseBusinessWorkspace({
        version: 1,
        opportunities: [sample[0], sample[0]],
      }),
    ).toThrow('unique');
    expect(() =>
      normaliseBusinessWorkspace({
        version: 1,
        opportunities: [{ ...sample[0], dueDate: '2026-02-30' }],
      }),
    ).toThrow('YYYY-MM-DD');
  });

  it('rejects workspaces beyond the 250-opportunity limit', () => {
    const tooMany = Array.from({ length: 251 }, (_, index) => ({
      ...sample[0],
      id: `opportunity-${index}`,
    }));
    expect(() =>
      normaliseBusinessWorkspace({ version: 1, opportunities: tooMany }),
    ).toThrow('at most 250 opportunities');
  });

  it('keeps a maximum-size valid workspace below the formatted backup limit', () => {
    const worstCase = Array.from({ length: 250 }, (_, index) => ({
      ...sample[0],
      id: `opportunity-${index}`,
      evidence: '\\u0001'.repeat(1_000),
    }));
    const serialized = serialiseBusinessWorkspace({ version: 1, opportunities: worstCase });
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(2_000_000);
    expect(parseBusinessWorkspace(serialized).opportunities).toHaveLength(250);
  });

  it('rejects excessive values and oversized or malformed backups', () => {
    expect(() =>
      normaliseBusinessWorkspace({
        version: 1,
        opportunities: [{ ...sample[0], estimatedMonthlyValue: Number.POSITIVE_INFINITY }],
      }),
    ).toThrow('estimated monthly value');
    expect(() => parseBusinessWorkspace('{invalid')).toThrow('valid JSON');
    expect(() => parseBusinessWorkspace(' '.repeat(2_000_001))).toThrow('larger than 2 MB');
    expect(() => parseBusinessWorkspace('é'.repeat(1_000_001))).toThrow('larger than 2 MB');
  });
});
