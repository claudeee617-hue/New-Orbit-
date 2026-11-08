import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface GitFileChange {
  path: string;
  additions: number;
  deletions: number;
}

export interface GitCommit {
  sha: string;
  authorName: string;
  /** ISO 8601 author date. */
  date: string;
  subject: string;
  files: GitFileChange[];
}

export interface GitIndex {
  available: boolean;
  head: string | undefined;
  commits: GitCommit[];
  /** True when history was cut off by the `maxCommits` window. */
  truncated: boolean;
  shallow: boolean;
  limitations: string[];
}

// Read-only plumbing only. Config that could run external programs is neutralised because the
// repository being scanned is untrusted.
const SAFE_ARGS = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.pager=cat',
  '-c',
  'diff.external=',
  '-c',
  'core.hooksPath=/dev/null',
  '--no-pager',
];
const SAFE_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_PAGER: 'cat',
};

async function git(root: string, args: string[], maxBuffer = 64 * 1024 * 1024): Promise<string> {
  const { stdout } = await run('git', [...SAFE_ARGS, '-C', root, ...args], {
    env: SAFE_ENV,
    maxBuffer,
    timeout: 120_000,
  });
  return stdout;
}

const RECORD = '\u001e';
const FIELD = '\u001f';

export function parseGitLog(output: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const record of output.split(RECORD)) {
    if (record.trim() === '') continue;
    const [header, ...rest] = record.split('\n');
    const [sha, authorName, date, subject] = (header ?? '').split(FIELD);
    if (!sha || !/^[0-9a-f]{40,64}$/.test(sha)) continue;
    const files: GitFileChange[] = [];
    for (const line of rest) {
      const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!match) continue;
      files.push({
        path: (match[3] as string).trim(),
        additions: match[1] === '-' ? 0 : Number(match[1]),
        deletions: match[2] === '-' ? 0 : Number(match[2]),
      });
    }
    commits.push({
      sha,
      authorName: authorName ?? 'unknown',
      date: date ?? '',
      subject: (subject ?? '').slice(0, 200),
      files,
    });
  }
  return commits;
}

/** Index recent history. Never throws: failures become `limitations`. */
export async function indexGit(root: string, maxCommits: number): Promise<GitIndex> {
  const empty: GitIndex = {
    available: false,
    head: undefined,
    commits: [],
    truncated: false,
    shallow: false,
    limitations: [],
  };
  try {
    const inside = (await git(root, ['rev-parse', '--is-inside-work-tree'])).trim();
    if (inside !== 'true')
      return {
        ...empty,
        limitations: ['Not inside a git work tree; history, churn and ownership were not measured'],
      };
  } catch {
    return {
      ...empty,
      limitations: [
        'git is unavailable or this is not a git repository; history, churn and ownership were not measured',
      ],
    };
  }

  const limitations: string[] = [];
  let head: string | undefined;
  try {
    head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  } catch {
    return { ...empty, available: true, limitations: ['Repository has no commits yet'] };
  }
  let shallow = false;
  try {
    shallow = (await git(root, ['rev-parse', '--is-shallow-repository'])).trim() === 'true';
  } catch {
    // Older git versions lack this flag; treat as unknown.
  }
  if (shallow)
    limitations.push(
      'Shallow clone: history before the clone depth is missing, so churn and ownership are partial',
    );

  let commits: GitCommit[];
  try {
    const out = await git(root, [
      'log',
      `-n`,
      String(maxCommits + 1),
      '--no-merges',
      '--no-renames',
      '--relative',
      `--format=${RECORD}%H${FIELD}%an${FIELD}%aI${FIELD}%s`,
      '--numstat',
    ]);
    commits = parseGitLog(out);
  } catch {
    limitations.push('git log failed; history was not indexed');
    return { available: true, head, commits: [], truncated: false, shallow, limitations };
  }
  const truncated = commits.length > maxCommits;
  if (truncated) {
    commits = commits.slice(0, maxCommits);
    limitations.push(
      `Only the most recent ${maxCommits} non-merge commits were indexed; older history is not reflected in churn or ownership`,
    );
  }
  limitations.push('Renames are not followed, so history is attributed to the current path only');
  return { available: true, head, commits, truncated, shallow, limitations };
}

export interface OwnerShare {
  name: string;
  commits: number;
  /** Fraction of this file's recorded commits (0–1). */
  share: number;
}

export interface FileHistory {
  churn: number;
  additions: number;
  deletions: number;
  owners: OwnerShare[];
  lastCommitDate: string | undefined;
}

/** Per-file churn and commit-share ownership from indexed commits. Ownership is by commits, not by surviving lines. */
export function summarizeHistory(commits: readonly GitCommit[]): Map<string, FileHistory> {
  const perFile = new Map<
    string,
    {
      commits: number;
      additions: number;
      deletions: number;
      authors: Map<string, number>;
      last: string | undefined;
    }
  >();
  for (const commit of commits) {
    for (const file of commit.files) {
      let entry = perFile.get(file.path);
      if (!entry) {
        entry = { commits: 0, additions: 0, deletions: 0, authors: new Map(), last: undefined };
        perFile.set(file.path, entry);
      }
      entry.commits += 1;
      entry.additions += file.additions;
      entry.deletions += file.deletions;
      entry.authors.set(commit.authorName, (entry.authors.get(commit.authorName) ?? 0) + 1);
      if (entry.last === undefined || commit.date > entry.last) entry.last = commit.date;
    }
  }
  const out = new Map<string, FileHistory>();
  for (const [path, entry] of perFile) {
    const owners = [...entry.authors.entries()]
      .map(([name, count]) => ({
        name,
        commits: count,
        share: Math.round((count / entry.commits) * 1000) / 1000,
      }))
      .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
      .slice(0, 5);
    out.set(path, {
      churn: entry.commits,
      additions: entry.additions,
      deletions: entry.deletions,
      owners,
      lastCommitDate: entry.last,
    });
  }
  return out;
}
