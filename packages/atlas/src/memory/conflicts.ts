import { tokenize, truncate } from './text.js';
import { NORMATIVE_CATEGORIES, type MemoryItem } from './types.js';

export interface MemoryConflict {
  kind: 'same-topic-different-choice' | 'opposing-statements';
  /** False when both items state structured topic/choice fields, true when inferred from wording. */
  heuristic: boolean;
  items: [string, string];
  explanation: string;
  sharedTerms: string[];
  sharedScope: string[];
}

const PROHIBITIVE =
  /\b(never|must not|mustn't|do not|don't|shall not|avoid|forbidden|prohibit(?:ed)?|no longer|not allowed|disallow(?:ed)?)\b/i;
const PRESCRIPTIVE = /\b(always|must|should|shall|required?|use|prefer|adopt|mandatory)\b/i;
const MIN_SHARED_TERMS = 3;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function scope(item: MemoryItem): string[] {
  return [
    ...(item.topic !== undefined ? [`topic:${item.topic}`] : []),
    ...item.tags.map((t) => `tag:${t}`),
    ...item.sourceRefs.flatMap((r) => (r.kind === 'file' ? [`file:${r.path}`] : [])),
  ];
}

const norm = (value: string): string => tokenize(value).join(' ');

/**
 * Find decisions that disagree. Only items that count as authoritative are compared: an AI
 * suggestion, a proposed/rejected ADR, an invalidated or superseded memory cannot conflict with
 * anything. ORBIT reports conflicts for a person to resolve; it never picks a winner.
 *
 * 1. Structured: same `topic`, different `choice`. Exact, not heuristic.
 * 2. Wording: items share scope (topic, tag or cited file) and one has a prohibitive sentence
 *    that overlaps heavily with a prescriptive sentence in the other. Heuristic, and labelled so.
 */
export function findConflicts(items: readonly MemoryItem[]): MemoryConflict[] {
  const pool = items
    .filter((i) => i.authoritative && NORMATIVE_CATEGORIES.has(i.category))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const conflicts: MemoryConflict[] = [];

  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const a = pool[i] as MemoryItem;
      const b = pool[j] as MemoryItem;
      const sharedScope = scope(a).filter((s) => scope(b).includes(s));

      if (
        a.topic !== undefined &&
        a.topic === b.topic &&
        a.choice &&
        b.choice &&
        norm(a.choice) !== norm(b.choice)
      ) {
        conflicts.push({
          kind: 'same-topic-different-choice',
          heuristic: false,
          items: [a.id, b.id],
          explanation: `Both set the "${a.topic}" decision but choose different options: "${a.choice}" vs "${b.choice}". Invalidate one or supersede it.`,
          sharedTerms: [],
          sharedScope: sharedScope.sort(),
        });
        continue;
      }
      if (sharedScope.length === 0) continue;

      const found = opposing(a, b) ?? opposing(b, a);
      if (found) {
        conflicts.push({
          kind: 'opposing-statements',
          heuristic: true,
          items: [a.id, b.id],
          explanation: `Possible conflict (inferred from wording): "${truncate(found.prohibits, 140)}" vs "${truncate(found.prescribes, 140)}". Review and invalidate or supersede one.`,
          sharedTerms: found.terms,
          sharedScope: sharedScope.sort(),
        });
      }
    }
  }
  return conflicts;
}

function opposing(
  restrictive: MemoryItem,
  other: MemoryItem,
): { prohibits: string; prescribes: string; terms: string[] } | undefined {
  const ours = sentences(`${restrictive.title}. ${restrictive.body}`).filter((s) =>
    PROHIBITIVE.test(s),
  );
  const theirs = sentences(`${other.title}. ${other.body}`).filter(
    (s) => !PROHIBITIVE.test(s) && PRESCRIPTIVE.test(s),
  );
  for (const p of ours) {
    const pt = new Set(tokenize(p, 3));
    for (const s of theirs) {
      const shared = [...new Set(tokenize(s, 3))].filter((t) => pt.has(t)).sort();
      if (shared.length >= MIN_SHARED_TERMS) return { prohibits: p, prescribes: s, terms: shared };
    }
  }
  return undefined;
}
