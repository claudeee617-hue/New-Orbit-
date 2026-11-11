import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OrbitError } from '@orbit/shared';
import type { ChangeStatus, FileChange, Hunk, LineRange } from './types.js';

const run = promisify(execFile);

// Read-only plumbing. Anything in the repository's config that could run a program is neutralised
// because the repository under review is untrusted.
const SAFE_ARGS = [
  '--no-pager',
  '--literal-pathspecs',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.pager=cat',
  '-c',
  'diff.external=',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.quotepath=false',
  '-c',
  'diff.renames=true',
];
const SAFE_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };

export async function git(
  cwd: string,
  args: readonly string[],
  maxBuffer = 64 * 1024 * 1024,
): Promise<string> {
  try {
    const { stdout } = await run('git', [...SAFE_ARGS, ...args], {
      cwd,
      env: SAFE_ENV,
      maxBuffer,
      encoding: 'utf8',
    });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    throw new OrbitError(
      'INVALID_INPUT',
      `git ${args[0] ?? ''} failed: ${stderr.trim().slice(0, 300)}`,
      {
        cause: error,
      },
    );
  }
}

/** Resolve a user-supplied ref to a commit SHA. Refs starting with `-` are refused. */
export async function resolveCommit(cwd: string, ref: string): Promise<string> {
  if (ref.length === 0 || ref.startsWith('-') || /[\0\n]/.test(ref))
    throw new OrbitError('INVALID_INPUT', `Not a valid git ref: ${JSON.stringify(ref)}`);
  const out = await git(cwd, [
    'rev-parse',
    '--verify',
    '--quiet',
    '--end-of-options',
    `${ref}^{commit}`,
  ]);
  const sha = out.trim();
  if (!/^[0-9a-f]{40}$/.test(sha))
    throw new OrbitError('NOT_FOUND', `Ref ${ref} does not resolve to a commit`);
  return sha;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parse the hunks of a `--unified=0` diff for one file. Tolerates garbage lines. */
export function parseHunks(diffText: string): Hunk[] {
  const hunks: Hunk[] = [];
  for (const line of diffText.split('\n')) {
    const m = HUNK.exec(line);
    if (!m) continue;
    const oldCount = m[2] === undefined ? 1 : Number(m[2]);
    const newStart = Number(m[3]);
    const newCount = m[4] === undefined ? 1 : Number(m[4]);
    const addedLines: LineRange | undefined =
      newCount > 0 ? { start: newStart, end: newStart + newCount - 1 } : undefined;
    hunks.push({
      addedLines,
      modifiedExisting: newCount > 0 && oldCount > 0,
      removedCount: oldCount,
      // With --unified=0, a pure deletion reports the line *before* the removal as newStart.
      deletedAfterLine: newCount === 0 ? newStart : undefined,
    });
  }
  return hunks;
}

export function changedLinesOf(hunks: readonly Hunk[]): number[] {
  const set = new Set<number>();
  for (const h of hunks)
    if (h.addedLines) for (let l = h.addedLines.start; l <= h.addedLines.end; l++) set.add(l);
  return [...set].sort((a, b) => a - b);
}

interface RawEntry {
  status: string;
  path: string;
  oldPath: string | undefined;
}

export function parseRawZ(output: string): RawEntry[] {
  const parts = output.split('\0');
  const entries: RawEntry[] = [];
  for (let i = 0; i < parts.length;) {
    const header = parts[i] ?? '';
    if (!header.startsWith(':')) {
      i += 1;
      continue;
    }
    const status = header.split(' ').pop() ?? '';
    const letter = status[0] ?? '';
    if (letter === 'R' || letter === 'C') {
      const oldPath = parts[i + 1];
      const path = parts[i + 2];
      if (oldPath !== undefined && path !== undefined)
        entries.push({ status: letter, path, oldPath });
      i += 3;
    } else {
      const path = parts[i + 1];
      if (path !== undefined) entries.push({ status: letter, path, oldPath: undefined });
      i += 2;
    }
  }
  return entries;
}

function toStatus(letter: string): ChangeStatus {
  switch (letter) {
    case 'A':
    case 'C':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    default:
      return 'modified';
  }
}

export interface DiffResult {
  files: FileChange[];
  truncated: boolean;
  totalFiles: number;
}

/** Diff `base..head` (both full SHAs) into per-file changes with head-side changed line numbers. */
export async function diffCommits(
  cwd: string,
  base: string,
  head: string,
  maxFiles = 500,
): Promise<DiffResult> {
  const raw = await git(cwd, [
    'diff',
    '--raw',
    '-z',
    '-M',
    '--no-abbrev',
    '--no-ext-diff',
    '--no-textconv',
    base,
    head,
  ]);
  const entries = parseRawZ(raw).sort((a, b) => a.path.localeCompare(b.path));
  const selected = entries.slice(0, maxFiles);
  const files: FileChange[] = [];
  for (const entry of selected) {
    const pathspecs = entry.oldPath ? [entry.oldPath, entry.path] : [entry.path];
    const text = await git(cwd, [
      'diff',
      '--unified=0',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '-M',
      base,
      head,
      '--',
      ...pathspecs,
    ]);
    const binary = /^Binary files .* differ$/m.test(text) || /^GIT binary patch$/m.test(text);
    const hunks = binary ? [] : parseHunks(text);
    let added = 0;
    let removed = 0;
    for (const h of hunks) {
      removed += h.removedCount;
      if (h.addedLines) added += h.addedLines.end - h.addedLines.start + 1;
    }
    files.push({
      path: entry.path,
      oldPath: entry.oldPath,
      status: toStatus(entry.status),
      binary,
      hunks,
      changedLines: changedLinesOf(hunks),
      addedLineCount: added,
      removedLineCount: removed,
    });
  }
  return { files, truncated: entries.length > selected.length, totalFiles: entries.length };
}
