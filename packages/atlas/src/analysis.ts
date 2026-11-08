import { posix } from 'node:path';

/**
 * Strongly connected components with more than one member (or a self-loop), via an iterative
 * Tarjan so very long import chains cannot overflow the stack. Output is sorted for reproducibility.
 */
export function findCycles(adjacency: ReadonlyMap<string, readonly string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  const nodes = [...adjacency.keys()].sort();
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: { node: string; next: number }[] = [{ node: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1] as { node: string; next: number };
      const neighbours = adjacency.get(frame.node) ?? [];
      if (frame.next < neighbours.length) {
        const target = neighbours[frame.next] as string;
        frame.next += 1;
        if (!adjacency.has(target)) continue;
        if (!index.has(target)) {
          index.set(target, counter);
          low.set(target, counter);
          counter += 1;
          stack.push(target);
          onStack.add(target);
          work.push({ node: target, next: 0 });
        } else if (onStack.has(target)) {
          low.set(frame.node, Math.min(low.get(frame.node) as number, index.get(target) as number));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent)
        low.set(
          parent.node,
          Math.min(low.get(parent.node) as number, low.get(frame.node) as number),
        );
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const member = stack.pop() as string;
          onStack.delete(member);
          component.push(member);
          if (member === frame.node) break;
        }
        const selfLoop =
          component.length === 1 &&
          (adjacency.get(component[0] as string) ?? []).includes(component[0] as string);
        if (component.length > 1 || selfLoop) result.push(component.sort());
      }
    }
  }
  return result.sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
}

/** Candidate source base names a test file conventionally covers (`foo.test.ts` → `foo`). */
export function conventionalTargetNames(testPath: string): string[] {
  const base = posix.basename(testPath);
  const stem = base.replace(/\.[^.]+$/, '');
  const names = new Set<string>();
  const add = (n: string): void => {
    if (n !== '' && n !== stem) names.add(n);
  };
  add(stem.replace(/\.(test|spec)$/, ''));
  add(stem.replace(/^test_/, ''));
  add(stem.replace(/_test$/, ''));
  add(stem.replace(/(Tests?|IT)$/, ''));
  return [...names];
}

export interface HotspotInput {
  path: string;
  complexity: number;
  churn: number | undefined;
}

export interface Hotspot {
  path: string;
  complexity: number;
  /** Commits touching the file in the indexed window; undefined when history was not measured. */
  churn: number | undefined;
  /** `complexity × max(churn, 1)`. Transparent on purpose: both inputs are reported. */
  score: number;
}

export function rankHotspots(inputs: readonly HotspotInput[], limit: number): Hotspot[] {
  return inputs
    .filter((f) => f.complexity > 0)
    .map((f) => ({
      path: f.path,
      complexity: f.complexity,
      churn: f.churn,
      score: f.complexity * Math.max(f.churn ?? 1, 1),
    }))
    .sort(
      (a, b) => b.score - a.score || b.complexity - a.complexity || a.path.localeCompare(b.path),
    )
    .slice(0, limit);
}

export function directoryOf(path: string): string {
  const dir = posix.dirname(path);
  return dir === '.' ? '.' : dir;
}
