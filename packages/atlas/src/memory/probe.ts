import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hashArtifact, nodeIdFor } from '@orbit/core';
import type { GraphStore } from '@orbit/database';
import { normalizeRepoRelativePath } from '@orbit/shared';

/**
 * Answers "what does this file look like right now?".
 * `undefined` means unknown (not in the graph, unreadable, a symlink...). Unknown is never treated
 * as stale: ORBIT only calls something stale when it has evidence that the source changed.
 */
export type FileProbe = (path: string) => { exists: boolean; hash?: string } | undefined;

const MAX_PROBE_BYTES = 8 * 1024 * 1024;

/** Reads the content hash ATLAS recorded for a parsed code file. Cheap, but only as fresh as the last scan. */
export function graphFileProbe(store: GraphStore, repositoryId: string): FileProbe {
  return (path) => {
    const node = store.nodes.get(repositoryId, nodeIdFor(repositoryId, 'File', path));
    if (!node) return undefined;
    const hash = node.attrs['contentHash'];
    return typeof hash === 'string' ? { exists: true, hash } : { exists: true };
  };
}

/** Hashes files straight from disk: always current, works for documents ATLAS does not parse. Never follows symlinks. */
export function diskFileProbe(rootPath: string): FileProbe {
  const root = resolve(rootPath);
  return (path) => {
    let relative: string;
    try {
      relative = normalizeRepoRelativePath(path);
    } catch {
      return undefined;
    }
    const full = join(root, relative);
    try {
      const stat = lstatSync(full);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_PROBE_BYTES) return undefined;
      return { exists: true, hash: hashArtifact(readFileSync(full)) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false };
      return undefined;
    }
  };
}

/** Disk first (authoritative about the working tree), then the graph. */
export function combineProbes(...probes: FileProbe[]): FileProbe {
  return (path) => {
    for (const probe of probes) {
      const answer = probe(path);
      if (answer !== undefined) return answer;
    }
    return undefined;
  };
}
