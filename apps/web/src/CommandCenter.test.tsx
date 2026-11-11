import { describe, expect, it } from 'vitest';
import { filterGraphNodesByType, sortEvidenceTimeline } from './CommandCenter.js';

describe('Command Center graph and evidence helpers', () => {
  it('filters graph nodes by their exact stored type and preserves all for the all filter', () => {
    const nodes = [
      { id: 'file-1', type: 'File' },
      { id: 'function-1', type: 'Function' },
      { id: 'file-2', type: 'File' },
    ];

    expect(filterGraphNodesByType(nodes, 'all')).toEqual(nodes);
    expect(filterGraphNodesByType(nodes, 'File')).toEqual([nodes[0], nodes[2]]);
    expect(filterGraphNodesByType(nodes, 'Missing')).toEqual([]);
  });

  it('orders timestamped evidence newest-first and keeps undated entries at the end', () => {
    const oldest = { id: 'old', timestamp: '2026-01-01T00:00:00.000Z' };
    const newest = { id: 'new', timestamp: '2026-03-01T00:00:00.000Z' };
    const recorded = { id: 'recorded', recordedAt: '2026-02-01T00:00:00.000Z' };
    const undated = { id: 'undated' };

    expect(sortEvidenceTimeline([oldest, undated, newest, recorded])).toEqual([
      newest,
      recorded,
      oldest,
      undated,
    ]);
  });

  it('preserves original order for equal timestamps and for entries without valid dates', () => {
    const first = { id: 'first', timestamp: 'not-a-date' };
    const second = { id: 'second', timestamp: 'not-a-date' };
    const sameTimeA = { id: 'a', timestamp: '2026-01-01T00:00:00.000Z' };
    const sameTimeB = { id: 'b', timestamp: '2026-01-01T00:00:00.000Z' };

    expect(sortEvidenceTimeline([first, sameTimeA, second, sameTimeB])).toEqual([
      sameTimeA,
      sameTimeB,
      first,
      second,
    ]);
  });
});
