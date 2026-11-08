import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { classifyFile, compileGlobs, DEFAULT_EXCLUDES, detectLanguage } from './classify.js';
import type { FileCategory, Language, ResolvedScanConfig, SkippedFile } from './types.js';

export interface DiscoveredFile {
  /** POSIX path relative to the repository root. */
  path: string;
  size: number;
  category: FileCategory;
  language: Language | undefined;
}

export interface Discovery {
  files: DiscoveredFile[];
  skipped: SkippedFile[];
  /** Directories skipped by exclude rules (reported so exclusions are visible). */
  excludedDirectories: string[];
}

/**
 * Walk a repository without following symlinks and without executing anything. Output order is
 * sorted so scans are reproducible.
 */
export function discoverFiles(root: string, config: ResolvedScanConfig): Discovery {
  const excluded = compileGlobs(
    config.noDefaultExcludes ? config.exclude : [...DEFAULT_EXCLUDES, ...config.exclude],
  );
  const included = config.include.length > 0 ? compileGlobs(config.include) : undefined;
  const files: DiscoveredFile[] = [];
  const skipped: SkippedFile[] = [];
  const excludedDirectories: string[] = [];

  const visit = (relativeDir: string): void => {
    let names: string[];
    try {
      names = readdirSync(join(root, relativeDir)).sort();
    } catch {
      skipped.push({ path: relativeDir || '.', reason: 'unreadable' });
      return;
    }
    for (const name of names) {
      const relative = relativeDir === '' ? name : `${relativeDir}/${name}`;
      let stat;
      try {
        stat = lstatSync(join(root, relative));
      } catch {
        skipped.push({ path: relative, reason: 'unreadable' });
        continue;
      }
      if (stat.isSymbolicLink()) {
        skipped.push({ path: relative, reason: 'excluded-symlink' });
        continue;
      }
      if (stat.isDirectory()) {
        // Probe with a child path so `**/node_modules/**` style patterns match the directory itself.
        if (excluded(`${relative}/x`)) {
          excludedDirectories.push(relative);
          continue;
        }
        visit(relative);
        continue;
      }
      if (!stat.isFile() || excluded(relative)) continue;
      if (included && !included(relative)) continue;
      if (files.length >= config.maxFiles) {
        skipped.push({ path: relative, reason: 'max-files' });
        continue;
      }
      files.push({
        path: relative,
        size: stat.size,
        category: classifyFile(relative),
        language: detectLanguage(relative),
      });
    }
  };
  visit('');
  return { files, skipped, excludedDirectories };
}

export interface ReadFile {
  content: string;
  hash: string;
}

/** Read a file as UTF-8 text. Returns undefined (with a reason) for binary or oversized files. */
export function readSourceFile(
  root: string,
  file: DiscoveredFile,
  maxBytes: number,
): { ok: true; value: ReadFile } | { ok: false; reason: SkippedFile['reason'] } {
  if (file.size > maxBytes) return { ok: false, reason: 'too-large' };
  let buffer: Buffer;
  try {
    buffer = readFileSync(join(root, file.path));
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (buffer.subarray(0, 8000).includes(0)) return { ok: false, reason: 'binary' };
  return {
    ok: true,
    value: {
      content: buffer.toString('utf8'),
      hash: createHash('sha256').update(buffer).digest('hex'),
    },
  };
}
