import { hashValue } from '@orbit/core';
import type { Finding, Location, Severity } from './types.js';

export function findingId(
  rule: string,
  parts: readonly (string | number | undefined)[],
  base: string,
  head: string,
): string {
  const hash = hashValue([rule, ...parts.map((p) => p ?? ''), base, head]).slice(0, 8);
  return `WIT-${rule}-${hash}`;
}

export class FindingSet {
  private readonly items = new Map<string, Finding>();
  constructor(
    private readonly base: string,
    private readonly head: string,
  ) {}

  add(input: {
    rule: string;
    key: (string | number | undefined)[];
    severity: Severity;
    title: string;
    explanation: string;
    location?: Location | undefined;
    evidence: string[];
    suggestedAction: string;
  }): void {
    const id = findingId(input.rule, input.key, this.base, this.head);
    if (this.items.has(id)) return;
    this.items.set(id, {
      id,
      rule: input.rule,
      severity: input.severity,
      title: input.title,
      explanation: input.explanation,
      location: input.location,
      evidence: input.evidence,
      suggestedAction: input.suggestedAction,
    });
  }

  sorted(): Finding[] {
    const rank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return [...this.items.values()].sort(
      (a, b) =>
        rank[a.severity] - rank[b.severity] ||
        (a.location?.path ?? '').localeCompare(b.location?.path ?? '') ||
        (a.location?.startLine ?? 0) - (b.location?.startLine ?? 0) ||
        a.id.localeCompare(b.id),
    );
  }
}

/** Compress sorted line numbers to ranges: [1,2,3,7] → "1-3, 7". */
export function formatLines(lines: readonly number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < lines.length;) {
    let j = i;
    while (j + 1 < lines.length && (lines[j + 1] as number) === (lines[j] as number) + 1) j += 1;
    parts.push(i === j ? `${lines[i]}` : `${lines[i]}-${lines[j]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

export function lineRanges(lines: readonly number[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (last && l === last.end + 1) last.end = l;
    else out.push({ start: l, end: l });
  }
  return out;
}
