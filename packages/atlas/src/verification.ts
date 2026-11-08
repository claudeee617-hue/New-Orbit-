import { createHash } from 'node:crypto';

export type VerificationStatus = 'PASS' | 'FAIL' | 'PARTIAL' | 'NOT_MEASURED' | 'INCOMPLETE';

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown';
  addedLines: number[];
  binary: boolean;
}

export interface CoverageFile {
  path: string;
  lines: Map<number, number>;
}

export interface CoverageSummary {
  changedLines: number;
  measuredLines: number;
  coveredLines: number;
  uncoveredLines: number[];
  percentage: number | null;
  status: VerificationStatus;
}

export interface VerificationFinding {
  id: string;
  severity: 'info' | 'warning' | 'error';
  rule: string;
  path: string;
  lines: number[];
  message: string;
  evidence: string[];
}

export interface VerificationReport {
  schemaVersion: 1;
  scope: 'coverage-only';
  files: Array<{ path: string; status: DiffFile['status']; coverage: CoverageSummary }>;
  summary: CoverageSummary;
  findings: VerificationFinding[];
  limitations: string[];
}

const MAX_REPORT_BYTES = 10 * 1024 * 1024;

function assertSize(value: string, label: string): void {
  if (Buffer.byteLength(value, 'utf8') > MAX_REPORT_BYTES) {
    throw new Error(`${label} exceeds the 10 MiB parser limit`);
  }
}

/** Normalise a repository-relative path without allowing traversal. */
export function normalizeRepoPath(input: string): string {
  const value = input.trim().split(String.fromCharCode(92)).join('/').replace(/^\.\//, '');
  if (!value || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) {
    throw new Error(`Expected a repository-relative path: ${input}`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '..' || segment === '')) {
    throw new Error(`Unsafe repository path: ${input}`);
  }
  return segments.filter((segment) => segment !== '.').join('/');
}

function parseDiffPath(line: string): string | undefined {
  const match = /^\+\+\+ b\/(.+)$/.exec(line);
  return match?.[1] && match[1] !== '/dev/null' ? normalizeRepoPath(match[1]) : undefined;
}

/** Parse added line numbers from a unified diff. Deleted lines do not enter the denominator. */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  assertSize(diff, 'Unified diff');
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let newLine = 0;
  let inHunk = false;

  const finish = () => {
    if (current) {
      current.addedLines = [...new Set(current.addedLines)].sort((a, b) => a - b);
      files.push(current);
    }
  };

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      finish();
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      const candidate = match?.[2] ?? 'unknown';
      current = {
        path: candidate === 'unknown' ? candidate : normalizeRepoPath(candidate),
        status: 'unknown',
        addedLines: [],
        binary: false,
      };
      inHunk = false;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('new file mode ')) current.status = 'added';
    else if (line.startsWith('deleted file mode ')) current.status = 'deleted';
    else if (line.startsWith('rename from ')) current.status = 'renamed';
    else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.binary = true;
      inHunk = false;
    } else if (line.startsWith('--- a/')) {
      if (current.status === 'unknown') current.status = 'modified';
    } else if (line.startsWith('+++ b/')) {
      const path = parseDiffPath(line);
      if (path) current.path = path;
    } else if (line.startsWith('+++ /dev/null')) {
      current.status = 'deleted';
    } else if (line.startsWith('@@')) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (hunk) {
        newLine = Number(hunk[1]);
        inHunk = true;
      }
    } else if (inHunk && line.startsWith('+') && !line.startsWith('+++')) {
      current.addedLines.push(newLine);
      newLine += 1;
    } else if (inHunk && line.startsWith(' ')) {
      newLine += 1;
    } else if (inHunk && line.startsWith('\\')) {
      // " No newline at end of file" does not change hunk positions.
    } else if (inHunk && line.startsWith('-')) {
      // Removed lines do not advance the new-file line number.
    } else if (line.startsWith('diff --git ')) {
      inHunk = false;
    }
  }
  finish();
  return files;
}

function safeXml(content: string, label: string): void {
  assertSize(content, label);
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) {
    throw new Error(
      `${label} contains a DTD or entity declaration; external entities are not supported`,
    );
  }
}

function xmlAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(pattern)) {
    const raw = match[2] ?? match[3] ?? '';
    attributes[match[1]!] = raw
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }
  return attributes;
}

function addCoverage(
  target: Map<string, Map<number, number>>,
  path: string,
  line: number,
  hits: number,
): void {
  if (!Number.isInteger(line) || line < 1 || !Number.isFinite(hits) || hits < 0) return;
  const lines = target.get(path) ?? new Map<number, number>();
  lines.set(line, Math.max(lines.get(line) ?? 0, hits));
  target.set(path, lines);
}

/** Parse LCOV DA records. SF paths are treated as evidence labels, never opened as filesystem paths. */
export function parseLcov(content: string): CoverageFile[] {
  assertSize(content, 'LCOV report');
  const result = new Map<string, Map<number, number>>();
  let source: string | undefined;
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      const raw = line.slice(3).trim().split(String.fromCharCode(92)).join('/');
      const marker = raw.lastIndexOf('/');
      const relative = raw.replace(/^\.\//, '').replace(/^[A-Za-z]:/, '');
      source = relative.startsWith('/') ? relative.slice(1) : relative;
      if (!source || source.split('/').includes('..')) {
        source = marker >= 0 ? raw.slice(marker + 1) : raw;
      }
      source = source.replace(/^\.\//, '');
    } else if (line.startsWith('DA:') && source) {
      const [lineNo, hits] = line.slice(3).split(',');
      addCoverage(result, source, Number(lineNo), Number(hits));
    } else if (line === 'end_of_record') {
      source = undefined;
    }
  }
  return [...result].map(([path, lines]) => ({ path, lines }));
}

/** Parse the line-level subset of Cobertura XML without enabling DTDs or external entities. */
export function parseCobertura(content: string): CoverageFile[] {
  safeXml(content, 'Cobertura report');
  const result = new Map<string, Map<number, number>>();
  const classPattern = /<class\b([^>]*)>([\s\S]*?)<\/class>/gi;
  for (const classMatch of content.matchAll(classPattern)) {
    const attributes = xmlAttributes(classMatch[1] ?? '');
    const filename = attributes.filename;
    if (!filename) continue;
    const path = filename
      .split(String.fromCharCode(92))
      .join('/')
      .replace(/^\.\//, '')
      .replace(/^\//, '');
    if (!path || path.split('/').includes('..')) continue;
    const linePattern = /<line\b([^>]*?)\/?\s*>/gi;
    for (const lineMatch of (classMatch[2] ?? '').matchAll(linePattern)) {
      const lineAttributes = xmlAttributes(lineMatch[1] ?? '');
      addCoverage(result, path, Number(lineAttributes.number), Number(lineAttributes.hits));
    }
  }
  return [...result].map(([path, lines]) => ({ path, lines }));
}

function coverageForPath(files: CoverageFile[], path: string): Map<number, number> | undefined {
  const exact = files.find((file) => file.path === path);
  if (exact) return exact.lines;
  const suffix = files.filter((file) => file.path.endsWith(`/${path}`));
  return suffix.length === 1 ? suffix[0]!.lines : undefined;
}

function statusFor(changed: number, measured: number, covered: number): VerificationStatus {
  if (changed === 0) return 'NOT_MEASURED';
  if (measured === 0) return 'INCOMPLETE';
  if (covered === measured && measured === changed) return 'PASS';
  return 'PARTIAL';
}

/** Coverage report for added lines only. This is not a correctness or security verdict. */
export function verifyChangedLineCoverage(
  diff: string,
  coverage: readonly CoverageFile[],
): VerificationReport {
  const diffFiles = parseUnifiedDiff(diff).filter((file) => file.status !== 'deleted');
  const allAdded = diffFiles.flatMap((file) =>
    file.addedLines.map((line) => ({ path: file.path, line })),
  );
  const coveredFiles = diffFiles.map((file) => {
    const map = coverageForPath([...coverage], file.path);
    const measured = map ? file.addedLines.filter((line) => map.has(line)) : [];
    const covered = map ? measured.filter((line) => (map.get(line) ?? 0) > 0) : [];
    const uncovered = map ? measured.filter((line) => (map.get(line) ?? 0) === 0) : file.addedLines;
    const summary: CoverageSummary = {
      changedLines: file.addedLines.length,
      measuredLines: measured.length,
      coveredLines: covered.length,
      uncoveredLines: uncovered,
      percentage: measured.length
        ? Math.round((covered.length / measured.length) * 10000) / 100
        : null,
      status: statusFor(file.addedLines.length, measured.length, covered.length),
    };
    return { path: file.path, status: file.status, coverage: summary };
  });
  const measured = coveredFiles.reduce((sum, file) => sum + file.coverage.measuredLines, 0);
  const covered = coveredFiles.reduce((sum, file) => sum + file.coverage.coveredLines, 0);
  const changed = allAdded.length;
  const uncoveredLines = coveredFiles.flatMap((file) => file.coverage.uncoveredLines);
  const summary: CoverageSummary = {
    changedLines: changed,
    measuredLines: measured,
    coveredLines: covered,
    uncoveredLines,
    percentage: measured ? Math.round((covered / measured) * 10000) / 100 : null,
    status: statusFor(changed, measured, covered),
  };
  const findings: VerificationFinding[] = coveredFiles
    .filter(
      (file) => file.coverage.uncoveredLines.length > 0 || file.coverage.status === 'INCOMPLETE',
    )
    .map((file) => {
      const lines = file.coverage.uncoveredLines;
      const rule =
        file.coverage.status === 'INCOMPLETE' ? 'coverage.missing' : 'coverage.uncovered';
      const seed = `${rule}\0${file.path}\0${lines.join(',')}`;
      return {
        id: createHash('sha256').update(seed).digest('hex').slice(0, 16),
        severity: 'warning' as const,
        rule,
        path: file.path,
        lines,
        message:
          rule === 'coverage.missing'
            ? 'No matching line-coverage evidence was found for this changed file.'
            : `${lines.length} changed line(s) have zero reported hits.`,
        evidence: coverage.map((item) => item.path),
      };
    });
  return {
    schemaVersion: 1,
    scope: 'coverage-only',
    files: coveredFiles,
    summary,
    findings,
    limitations: [
      'Coverage shows whether instrumentation reported a line as executed; it does not prove correctness.',
      'Only added lines in unified-diff hunks are counted; deleted lines and non-line coverage are excluded.',
      'File paths are matched exactly or by a unique suffix. Ambiguous paths are not guessed.',
      'A PASS status means every changed line was measured and reported as hit; it is not an overall PR approval.',
    ],
  };
}
