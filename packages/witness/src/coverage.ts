import { XmlError, childrenNamed, parseXml, type XmlElement } from '@orbit/atlas';
import type { ChangedFileCoverage } from './types.js';

export type CoverageFormat = 'lcov' | 'cobertura';

export interface CoverageFile {
  /** Path exactly as written in the report. */
  reportedPath: string;
  /** Candidate repository-relative paths derived from it (most specific first). */
  keys: string[];
  /** Line number → execution count, for instrumented lines only. */
  lines: Map<number, number>;
}

export interface CoverageData {
  format: CoverageFormat;
  files: CoverageFile[];
}

export interface CoverageParse {
  data: CoverageData | undefined;
  /** Anything that means data may be missing or wrong. Non-empty ⇒ the evidence is INCOMPLETE. */
  problems: string[];
}

export function normalizeReportPath(path: string, rootPath?: string): string {
  let p = path.replace(/\\/g, '/').trim();
  if (rootPath) {
    const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
    if (p.toLowerCase().startsWith(`${root.toLowerCase()}/`)) p = p.slice(root.length + 1);
  }
  while (p.startsWith('./')) p = p.slice(2);
  return p;
}

const MAX_PROBLEMS = 20;

export function parseLcov(text: string, rootPath?: string): CoverageParse {
  const problems: string[] = [];
  const files: CoverageFile[] = [];
  let current: CoverageFile | undefined;
  let open = false;
  const note = (message: string): void => {
    if (problems.length < MAX_PROBLEMS) problems.push(message);
  };
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = (lines[n] as string).trim();
    if (line === '') continue;
    if (line.startsWith('SF:')) {
      if (open) note(`line ${n + 1}: SF before end_of_record for ${current?.reportedPath ?? '?'}`);
      const reported = line.slice(3);
      current = {
        reportedPath: reported,
        keys: [normalizeReportPath(reported, rootPath)],
        lines: new Map(),
      };
      files.push(current);
      open = true;
    } else if (line === 'end_of_record') {
      if (!open) note(`line ${n + 1}: end_of_record without SF`);
      open = false;
    } else if (line.startsWith('DA:')) {
      if (!current || !open) {
        note(`line ${n + 1}: DA record outside a file record`);
        continue;
      }
      const [lineNo, hits] = line.slice(3).split(',');
      const ln = Number(lineNo);
      const h = Number(hits);
      if (!Number.isInteger(ln) || ln < 1 || !Number.isFinite(h) || h < 0 || !Number.isInteger(h)) {
        note(`line ${n + 1}: malformed DA record "${line.slice(0, 60)}"`);
        continue;
      }
      current.lines.set(ln, (current.lines.get(ln) ?? 0) + h);
    }
    // TN, FN*, BRDA, LF, LH and the rest are not needed for changed-line coverage.
  }
  if (open) note(`file ended inside the record for ${current?.reportedPath ?? '?'} (truncated?)`);
  if (files.length === 0) {
    note('no SF records found: not an LCOV file');
    return { data: undefined, problems };
  }
  return { data: { format: 'lcov', files }, problems };
}

export function parseCobertura(text: string, rootPath?: string): CoverageParse {
  const problems: string[] = [];
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (error) {
    if (error instanceof XmlError)
      return { data: undefined, problems: [`invalid XML: ${error.message}`] };
    throw error;
  }
  if (root.name !== 'coverage')
    return { data: undefined, problems: [`root element is <${root.name}>, expected <coverage>`] };
  const sources = childrenNamed(root, 'sources')
    .flatMap((s) => childrenNamed(s, 'source'))
    .map((s) => s.attrs['path'] ?? '')
    .filter((s) => s !== '');
  const byFile = new Map<string, CoverageFile>();
  let classes = 0;
  const visitClass = (cls: XmlElement): void => {
    classes += 1;
    const filename = cls.attrs['filename'];
    if (!filename) {
      problems.push('a <class> element has no filename attribute');
      return;
    }
    let file = byFile.get(filename);
    if (!file) {
      const keys = [normalizeReportPath(filename, rootPath)];
      for (const s of sources) {
        const joined = normalizeReportPath(
          `${s.replace(/\\/g, '/').replace(/\/+$/, '')}/${filename}`,
          rootPath,
        );
        if (!keys.includes(joined)) keys.push(joined);
      }
      file = { reportedPath: filename, keys, lines: new Map() };
      byFile.set(filename, file);
    }
    for (const container of childrenNamed(cls, 'lines'))
      for (const l of childrenNamed(container, 'line')) {
        const ln = Number(l.attrs['number']);
        const hits = Number(l.attrs['hits']);
        if (!Number.isInteger(ln) || ln < 1 || !Number.isInteger(hits) || hits < 0) {
          if (problems.length < MAX_PROBLEMS)
            problems.push(
              `malformed <line number="${l.attrs['number'] ?? ''}" hits="${l.attrs['hits'] ?? ''}"> in ${filename}`,
            );
          continue;
        }
        file.lines.set(ln, (file.lines.get(ln) ?? 0) + hits);
      }
  };
  const walk = (el: XmlElement): void => {
    for (const child of el.children) {
      if (child.name === 'class') visitClass(child);
      else walk(child);
    }
  };
  walk(root);
  if (classes === 0) {
    problems.push('no <class> elements found');
    return { data: undefined, problems };
  }
  return { data: { format: 'cobertura', files: [...byFile.values()] }, problems };
}

/** Detect the format from content, not from the file extension. */
export function parseCoverage(text: string, rootPath?: string): CoverageParse {
  const head = text.trimStart().slice(0, 200);
  if (head.startsWith('<')) return parseCobertura(text, rootPath);
  if (/^(TN:|SF:)/m.test(text.slice(0, 2000))) return parseLcov(text, rootPath);
  return {
    data: undefined,
    problems: ['unrecognised coverage format (expected LCOV or Cobertura XML)'],
  };
}

export interface MatchedCoverage {
  file: CoverageFile | undefined;
  matchedAs: string | undefined;
  note: string | undefined;
}

/**
 * Find the coverage entry for each changed file. Exact repository-relative matches win; suffix
 * matches are accepted only when exactly one coverage entry and one changed file claim each other.
 */
export function matchCoverage(
  paths: readonly string[],
  data: CoverageData,
): Map<string, MatchedCoverage> {
  const result = new Map<string, MatchedCoverage>();
  const claims = new Map<CoverageFile, string[]>();
  const exact = new Map<string, CoverageFile>();
  for (const f of data.files) for (const k of f.keys) if (!exact.has(k)) exact.set(k, f);
  const suffix: Record<string, { file: CoverageFile; how: string }[]> = {};
  for (const path of paths) {
    const hit = exact.get(path);
    if (hit) {
      result.set(path, { file: hit, matchedAs: hit.reportedPath, note: undefined });
      claims.set(hit, [...(claims.get(hit) ?? []), path]);
      continue;
    }
    const cands: { file: CoverageFile; how: string }[] = [];
    for (const f of data.files)
      for (const k of f.keys) {
        if (
          k.endsWith(`/${path}`) ||
          (k.includes('/') && path.endsWith(`/${k}`)) ||
          (!k.includes('/') && path.endsWith(`/${k}`))
        ) {
          cands.push({ file: f, how: `path suffix match with "${f.reportedPath}"` });
          break;
        }
      }
    suffix[path] = cands;
  }
  for (const [path, cands] of Object.entries(suffix)) {
    if (cands.length === 1) {
      const c = cands[0] as { file: CoverageFile; how: string };
      claims.set(c.file, [...(claims.get(c.file) ?? []), path]);
      result.set(path, { file: c.file, matchedAs: c.file.reportedPath, note: c.how });
    } else if (cands.length > 1) {
      result.set(path, {
        file: undefined,
        matchedAs: undefined,
        note: `ambiguous: ${cands.length} coverage entries could match this path`,
      });
    }
  }
  // A coverage entry claimed by several changed files is ambiguous for all of them.
  for (const [file, claimants] of claims)
    if (claimants.length > 1)
      for (const p of claimants)
        if (result.get(p)?.file === file)
          result.set(p, {
            file: undefined,
            matchedAs: undefined,
            note: `ambiguous: coverage entry "${file.reportedPath}" matches ${claimants.length} changed files`,
          });
  for (const path of paths)
    if (!result.has(path))
      result.set(path, { file: undefined, matchedAs: undefined, note: undefined });
  return result;
}

/** Classify every changed head line using only the coverage entry for that exact file. */
export function changedLineCoverage(
  path: string,
  changedLines: readonly number[],
  match: MatchedCoverage | undefined,
): ChangedFileCoverage {
  if (!match?.file)
    return {
      path,
      status: 'NOT_MEASURED',
      covered: [],
      uncovered: [],
      nonExecutable: [],
      matchedAs: undefined,
      note: match?.note ?? 'the coverage report has no entry for this file',
    };
  const covered: number[] = [];
  const uncovered: number[] = [];
  const nonExecutable: number[] = [];
  for (const line of changedLines) {
    const hits = match.file.lines.get(line);
    if (hits === undefined) nonExecutable.push(line);
    else if (hits > 0) covered.push(line);
    else uncovered.push(line);
  }
  return {
    path,
    status: uncovered.length > 0 ? 'PARTIAL' : covered.length > 0 ? 'PASS' : 'NOT_MEASURED',
    covered,
    uncovered,
    nonExecutable,
    matchedAs: match.matchedAs,
    note:
      covered.length + uncovered.length === 0
        ? 'none of the changed lines are instrumented in the coverage report'
        : match.note,
  };
}

/** Line coverage ratio of a whole coverage entry (instrumented lines only), or undefined. */
export function fileLineRatio(file: CoverageFile | undefined): number | undefined {
  if (!file || file.lines.size === 0) return undefined;
  let hit = 0;
  for (const h of file.lines.values()) if (h > 0) hit += 1;
  return hit / file.lines.size;
}
