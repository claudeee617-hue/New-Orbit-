import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ATLAS_VERSION, type FileExtraction } from './types.js';

export interface CachedFile {
  hash: string;
  extraction: FileExtraction;
}

interface CacheFile {
  atlasVersion: string;
  callsIncluded: boolean;
  files: Record<string, CachedFile>;
}

/**
 * Per-file extraction cache. It is purely an optimisation: deleting it (or any mismatch of ATLAS
 * version or call setting) only means files are parsed again. The graph never depends on it.
 */
export class ExtractionCache {
  private readonly entries = new Map<string, CachedFile>();
  private readonly path: string | undefined;
  private readonly callsIncluded: boolean;

  constructor(cacheDir: string | undefined, repositoryId: string, callsIncluded: boolean) {
    this.callsIncluded = callsIncluded;
    this.path = cacheDir === undefined ? undefined : join(cacheDir, `atlas-${repositoryId}.json`);
    if (this.path === undefined) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as CacheFile;
      if (
        parsed.atlasVersion === ATLAS_VERSION &&
        parsed.callsIncluded === callsIncluded &&
        parsed.files
      ) {
        for (const [file, entry] of Object.entries(parsed.files)) this.entries.set(file, entry);
      }
    } catch {
      // Missing or corrupt cache: start empty.
    }
  }

  get(path: string, hash: string): FileExtraction | undefined {
    const entry = this.entries.get(path);
    return entry !== undefined && entry.hash === hash ? entry.extraction : undefined;
  }

  /** Replace the cache contents with exactly the files seen in this scan (drops deleted files). */
  replaceWith(current: ReadonlyMap<string, CachedFile>): void {
    this.entries.clear();
    for (const [path, entry] of current) this.entries.set(path, entry);
  }

  save(): void {
    if (this.path === undefined) return;
    const files: Record<string, CachedFile> = {};
    for (const [path, entry] of [...this.entries].sort(([a], [b]) => a.localeCompare(b)))
      files[path] = entry;
    const body: CacheFile = {
      atlasVersion: ATLAS_VERSION,
      callsIncluded: this.callsIncluded,
      files,
    };
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(body));
    renameSync(temporary, this.path);
  }
}
