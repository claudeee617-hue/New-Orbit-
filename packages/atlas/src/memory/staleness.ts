import type { FileProbe } from './probe.js';
import type { MemoryItem } from './types.js';

export interface StaleReason {
  kind: 'file-removed' | 'file-changed';
  path: string;
  recordedHash?: string;
  currentHash?: string;
}

export interface StalenessFinding {
  id: string;
  /** True only when a cited file was removed or changed since the memory was written or last updated. */
  stale: boolean;
  reasons: StaleReason[];
  /** File references ORBIT could not check (no recorded hash, or the file is unknown right now). */
  unverifiable: string[];
  /** The item cites no file at all, so staleness cannot be judged. */
  noFileSources: boolean;
}

/**
 * Decide whether memory may be out of date. The rule is deliberately narrow and explainable:
 * a memory is stale when a file it cites has been removed or its content hash differs from the
 * one recorded when the memory was written or last updated. Anything ORBIT cannot check is
 * listed as unverifiable, never guessed stale or fresh.
 */
export function checkStaleness(items: readonly MemoryItem[], probe: FileProbe): StalenessFinding[] {
  const findings: StalenessFinding[] = [];
  for (const item of items) {
    if (item.status !== 'active') continue;
    const reasons: StaleReason[] = [];
    const unverifiable: string[] = [];
    let files = 0;
    for (const ref of item.sourceRefs) {
      if (ref.kind !== 'file') continue;
      files += 1;
      const now = probe(ref.path);
      if (now === undefined) {
        unverifiable.push(ref.path);
        continue;
      }
      if (!now.exists) {
        reasons.push({
          kind: 'file-removed',
          path: ref.path,
          ...(ref.contentHash !== undefined && { recordedHash: ref.contentHash }),
        });
        continue;
      }
      if (ref.contentHash === undefined || now.hash === undefined) {
        unverifiable.push(ref.path);
        continue;
      }
      if (ref.contentHash !== now.hash) {
        reasons.push({
          kind: 'file-changed',
          path: ref.path,
          recordedHash: ref.contentHash,
          currentHash: now.hash,
        });
      }
    }
    findings.push({
      id: item.id,
      stale: reasons.length > 0,
      reasons,
      unverifiable: [...new Set(unverifiable)].sort(),
      noFileSources: files === 0,
    });
  }
  return findings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
