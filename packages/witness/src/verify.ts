import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  classifyFile,
  detectLanguage,
  extractFile,
  impactMap,
  scanRepository,
  type ExtractedSymbol,
} from '@orbit/atlas';
import { hashArtifact, hashValue, nodeIdFor, repositoryIdFor } from '@orbit/core';
import { IN_MEMORY, createGraphStore, openDatabase, type GraphStore } from '@orbit/database';
import { OrbitError } from '@orbit/shared';
import {
  changedLineCoverage,
  fileLineRatio,
  matchCoverage,
  parseCoverage,
  type CoverageData,
} from './coverage.js';
import { diffCommits, git, resolveCommit } from './diff.js';
import { FindingSet, formatLines, lineRanges } from './findings.js';
import { parseJUnit, summarizeTests, type TestReport } from './junit.js';
import { detectSensitive } from './sensitive.js';
import {
  WITNESS_VERSION,
  type BuildSection,
  type ChangedFileCoverage,
  type ChangedSymbol,
  type DecisionRef,
  type Dimension,
  type EvidenceStatus,
  type FileChange,
  type FileEntry,
  type InputRecord,
  type TestSection,
  type VerificationReport,
} from './types.js';

export interface VerifyOptions {
  rootPath: string;
  base: string;
  head: string;
  /** Persist evidence and findings here. Without it, nothing is written anywhere. */
  store?: GraphStore;
  repositoryKey?: string;
  cacheDir?: string;
  /** `auto` scans the working tree for test linkage when it is exactly at `head`. */
  scan?: 'auto' | 'never';
  coverage?: string[];
  baseCoverage?: string[];
  testReport?: string[];
  baseTestReport?: string[];
  buildResult?: string;
  /** Commit the coverage run was produced from, when known. A mismatch makes coverage INCOMPLETE. */
  coverageCommit?: string;
  /** Changed-line coverage (0..1) below which coverage FAILS. Unset: uncovered lines give PARTIAL. */
  minChangedLineCoverage?: number;
  /** File-level coverage drop (0..1) that counts as a regression. Default 0.01. */
  coverageDropThreshold?: number;
  maxFiles?: number;
}

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

function readInput(path: string): { text: string; sha256: string } {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new OrbitError('NOT_FOUND', `Input file not found: ${path}`);
  const stat = statSync(abs);
  if (!stat.isFile()) throw new OrbitError('INVALID_INPUT', `Not a regular file: ${path}`);
  if (stat.size > MAX_INPUT_BYTES)
    throw new OrbitError(
      'INVALID_INPUT',
      `Input file is larger than ${MAX_INPUT_BYTES} bytes: ${path}`,
    );
  const buf = readFileSync(abs);
  return { text: buf.toString('utf8'), sha256: hashArtifact(buf) };
}

function worst(statuses: readonly EvidenceStatus[]): EvidenceStatus {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('INCOMPLETE')) return 'INCOMPLETE';
  if (statuses.includes('PARTIAL') || statuses.includes('NOT_MEASURED')) return 'PARTIAL';
  return 'PASS';
}

interface LoadedCoverage {
  data: CoverageData[];
  records: InputRecord[];
  problems: string[];
}

function loadCoverage(
  paths: readonly string[] | undefined,
  kind: 'coverage' | 'base-coverage',
  rootPath: string,
): LoadedCoverage {
  const out: LoadedCoverage = { data: [], records: [], problems: [] };
  for (const path of paths ?? []) {
    const { text, sha256 } = readInput(path);
    const parsed = parseCoverage(text, rootPath);
    if (parsed.data) out.data.push(parsed.data);
    const status: EvidenceStatus =
      parsed.problems.length > 0 || !parsed.data ? 'INCOMPLETE' : 'PASS';
    out.records.push({ kind, path: basename(path), sha256, status, problems: parsed.problems });
    for (const p of parsed.problems) out.problems.push(`${basename(path)}: ${p}`);
  }
  return out;
}

function mergeCoverage(list: readonly CoverageData[]): CoverageData | undefined {
  if (list.length === 0) return undefined;
  const files = list.flatMap((d) => d.files);
  return { format: list[0]?.format ?? 'lcov', files };
}

function loadTests(
  paths: readonly string[] | undefined,
  kind: 'test-report' | 'base-test-report',
): { report: TestReport | undefined; records: InputRecord[]; problems: string[] } {
  const cases: TestReport['cases'] = [];
  const records: InputRecord[] = [];
  const problems: string[] = [];
  for (const path of paths ?? []) {
    const { text, sha256 } = readInput(path);
    const parsed = parseJUnit(text);
    if (parsed.report) cases.push(...parsed.report.cases);
    records.push({
      kind,
      path: basename(path),
      sha256,
      status: parsed.problems.length > 0 || !parsed.report ? 'INCOMPLETE' : 'PASS',
      problems: parsed.problems,
    });
    for (const p of parsed.problems) problems.push(`${basename(path)}: ${p}`);
  }
  return { report: cases.length > 0 ? { cases } : undefined, records, problems };
}

function loadBuild(path: string | undefined): {
  section: BuildSection;
  record: InputRecord | undefined;
} {
  if (path === undefined)
    return {
      section: {
        status: 'NOT_MEASURED',
        command: undefined,
        note: 'No build result was supplied.',
      },
      record: undefined,
    };
  const { text, sha256 } = readInput(path);
  const bad = (why: string): { section: BuildSection; record: InputRecord } => ({
    section: { status: 'INCOMPLETE', command: undefined, note: `Build result unreadable: ${why}` },
    record: {
      kind: 'build-result',
      path: basename(path),
      sha256,
      status: 'INCOMPLETE',
      problems: [why],
    },
  });
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return bad('not valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return bad('expected a JSON object');
  const v = value as Record<string, unknown>;
  const result = typeof v['status'] === 'string' ? v['status'].toLowerCase() : '';
  const command = typeof v['command'] === 'string' ? v['command'].slice(0, 300) : undefined;
  if (!['success', 'passed', 'failure', 'failed'].includes(result))
    return bad('"status" must be one of success, passed, failure, failed');
  const ok = result === 'success' || result === 'passed';
  return {
    section: {
      status: ok ? 'PASS' : 'FAIL',
      command,
      note: ok
        ? 'Build reported success (as recorded in the supplied file).'
        : 'Build reported failure.',
    },
    record: {
      kind: 'build-result',
      path: basename(path),
      sha256,
      status: ok ? 'PASS' : 'FAIL',
      problems: [],
    },
  };
}

async function fileAtHead(root: string, head: string, path: string): Promise<string | undefined> {
  try {
    const text = await git(
      root,
      ['show', '--no-textconv', `${head}:${path}`],
      MAX_SOURCE_BYTES + 1024,
    );
    return text.length > MAX_SOURCE_BYTES ? undefined : text;
  } catch {
    return undefined;
  }
}

function innermost(symbols: readonly ExtractedSymbol[], line: number): ExtractedSymbol | undefined {
  let best: ExtractedSymbol | undefined;
  for (const s of symbols) {
    if (line < s.location.startLine || line > s.location.endLine) continue;
    if (
      !best ||
      s.location.endLine - s.location.startLine < best.location.endLine - best.location.startLine
    )
      best = s;
  }
  return best;
}

async function findDecisions(
  root: string,
  head: string,
  changed: readonly string[],
  limitations: string[],
): Promise<DecisionRef[]> {
  let listing: string;
  try {
    listing = await git(root, ['ls-tree', '-r', '--name-only', head]);
  } catch {
    return [];
  }
  const docs = listing
    .split('\n')
    .filter((p) => /(^|\/)(adr|adrs|decisions?)\/.+\.md$/i.test(p))
    .sort()
    .slice(0, 200);
  const out: DecisionRef[] = [];
  const dirs = new Set<string>();
  for (const p of changed) {
    const parts = p.split('/');
    for (let n = 2; n < parts.length; n++) dirs.add(parts.slice(0, n).join('/'));
  }
  for (const doc of docs) {
    const text = await fileAtHead(root, head, doc);
    if (text === undefined) continue;
    const matched = new Set<string>();
    for (const p of changed) if (text.includes(p)) matched.add(p);
    for (const d of dirs)
      if (text.includes(`${d}/`) || text.includes(`\`${d}\``)) matched.add(`${d}/`);
    if (matched.size === 0) continue;
    const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? basename(doc);
    const status = /^\**status\**\s*[:|-]\s*\**\s*([A-Za-z ]+)/im.exec(text)?.[1]?.trim();
    out.push({ path: doc, title, status, matched: [...matched].sort().slice(0, 10) });
  }
  if (out.length > 0)
    limitations.push(
      'Relevant architecture decisions are found by textual mention of changed paths (heuristic); a decision may apply without naming the path.',
    );
  return out.slice(0, 25);
}

export async function verifyChange(options: VerifyOptions): Promise<VerificationReport> {
  const root = resolve(options.rootPath);
  const limitations: string[] = [];
  const assumptions: string[] = [];
  if (
    options.minChangedLineCoverage !== undefined &&
    !(options.minChangedLineCoverage >= 0 && options.minChangedLineCoverage <= 1)
  )
    throw new OrbitError('INVALID_INPUT', 'minChangedLineCoverage must be between 0 and 1');

  const baseSha = await resolveCommit(root, options.base);
  const headSha = await resolveCommit(root, options.head);
  let mergeBase = baseSha;
  try {
    const mb = (await git(root, ['merge-base', baseSha, headSha])).trim();
    if (/^[0-9a-f]{40}$/.test(mb)) mergeBase = mb;
  } catch {
    limitations.push(
      'base and head share no merge base; the diff compares base directly with head.',
    );
  }

  const diff = await diffCommits(root, mergeBase, headSha, options.maxFiles ?? 500);
  if (diff.truncated)
    limitations.push(
      `Only the first ${diff.files.length} of ${diff.totalFiles} changed files were analysed (maxFiles).`,
    );

  const findings = new FindingSet(mergeBase, headSha);

  // Coverage / tests / build inputs ----------------------------------------------------------
  const inputs: InputRecord[] = [];
  const cov = loadCoverage(options.coverage, 'coverage', root);
  const baseCov = loadCoverage(options.baseCoverage, 'base-coverage', root);
  inputs.push(...cov.records, ...baseCov.records);
  const coverageData = mergeCoverage(cov.data);
  const baseCoverageData = mergeCoverage(baseCov.data);
  const testsHead = loadTests(options.testReport, 'test-report');
  const testsBase = loadTests(options.baseTestReport, 'base-test-report');
  inputs.push(...testsHead.records, ...testsBase.records);
  const build = loadBuild(options.buildResult);
  if (build.record) inputs.push(build.record);

  let coverageStale = false;
  if (options.coverage && options.coverage.length > 0) {
    if (options.coverageCommit === undefined)
      assumptions.push(
        'The coverage report is assumed to have been produced from the head commit; ORBIT cannot verify that from the report itself.',
      );
    else if (options.coverageCommit !== headSha && !headSha.startsWith(options.coverageCommit)) {
      coverageStale = true;
      limitations.push(
        `Coverage was produced from ${options.coverageCommit.slice(0, 10)}, not head ${headSha.slice(0, 10)}; line numbers may not match.`,
      );
    }
  }

  // Working tree / graph for test linkage ----------------------------------------------------
  let graphStore: GraphStore | undefined;
  let ephemeral: ReturnType<typeof openDatabase> | undefined;
  const repositoryKey = options.repositoryKey ?? `local/${basename(root)}`;
  const repositoryId = repositoryIdFor(repositoryKey);
  let graphAtHead = false;
  const headNow = (await git(root, ['rev-parse', 'HEAD']).catch(() => '')).trim();
  const dirty =
    (await git(root, ['status', '--porcelain', '--untracked-files=no']).catch(() => 'x')).trim() !==
    '';
  const canScan = (options.scan ?? 'auto') === 'auto' && headNow === headSha && !dirty;
  try {
    if (canScan) {
      if (!options.store) {
        ephemeral = openDatabase({ path: IN_MEMORY });
        graphStore = createGraphStore(ephemeral);
      } else graphStore = options.store;
      await scanRepository({
        rootPath: root,
        store: graphStore,
        repositoryKey,
        ...(options.cacheDir !== undefined && { cacheDir: options.cacheDir }),
        config: { skipGit: true },
      });
      graphAtHead = true;
    } else if (options.store) {
      graphStore = options.store;
      graphAtHead = graphStore.evidence
        .list(repositoryId, { sourceType: 'parser', commitSha: headSha })
        .some((e) => e.source.startsWith('atlas:'));
      if (!graphAtHead)
        limitations.push(
          'Test linkage is NOT_MEASURED: the working tree is not clean at the head commit and the graph holds no ATLAS scan of it.',
        );
    } else {
      limitations.push(
        'Test linkage is NOT_MEASURED: the working tree is not clean at the head commit (check out head, or pass a database that holds an ATLAS scan of it).',
      );
    }

    // Per-file analysis ----------------------------------------------------------------------
    const changedPaths = diff.files.filter((f) => f.status !== 'deleted').map((f) => f.path);
    const covMatches = coverageData ? matchCoverage(changedPaths, coverageData) : undefined;
    const baseMatches = baseCoverageData
      ? matchCoverage(
          diff.files.filter((f) => f.status !== 'added').map((f) => f.oldPath ?? f.path),
          baseCoverageData,
        )
      : undefined;
    const changedTestFiles = new Set(
      diff.files.filter((f) => classifyFile(f.path) === 'test').map((f) => f.path),
    );

    const files: FileEntry[] = [];
    const symbols: ChangedSymbol[] = [];
    const impacted = new Set<string>();
    let linesAdded = 0;
    let linesRemoved = 0;
    let executable = 0;
    let coveredTotal = 0;
    let uncoveredTotal = 0;
    let noCoverageFiles = 0;
    let sourceChanged = 0;

    for (const change of diff.files) {
      linesAdded += change.addedLineCount;
      linesRemoved += change.removedLineCount;
      const category = classifyFile(change.path);
      const language = detectLanguage(change.path);
      const isSource = category === 'source' && change.status !== 'deleted' && !change.binary;
      const sensitive = detectSensitive(change.path);
      for (const s of sensitive)
        findings.add({
          rule: 'SENSITIVE-FILE',
          key: [change.path, s.category],
          severity: s.severity,
          title: `Sensitive file changed: ${change.path}`,
          explanation: `${s.reason}. Category: ${s.category}.`,
          location: { path: change.path },
          evidence: [
            `git diff ${mergeBase.slice(0, 10)}..${headSha.slice(0, 10)} touches this path (${change.status})`,
          ],
          suggestedAction:
            s.category === 'secret'
              ? 'Confirm no credential is committed; rotate it if one was, and remove it from history.'
              : 'Have an owner of this area review the change explicitly.',
        });
      if (change.binary)
        findings.add({
          rule: 'BINARY-CHANGED',
          key: [change.path],
          severity: 'info',
          title: `Binary file changed: ${change.path}`,
          explanation: 'Binary content cannot be line-diffed or covered, so it is not verified.',
          location: { path: change.path },
          evidence: ['git reports "Binary files differ"'],
          suggestedAction: 'Review the binary change manually.',
        });

      let coverage: ChangedFileCoverage | undefined;
      if (isSource) {
        sourceChanged += 1;
        const lines = change.changedLines;
        if (coverageData) {
          coverage = changedLineCoverage(change.path, lines, covMatches?.get(change.path));
          if (coverageStale)
            coverage = {
              ...coverage,
              status: 'INCOMPLETE',
              note: 'coverage commit differs from head',
            };
        } else {
          coverage = {
            path: change.path,
            status: 'NOT_MEASURED',
            covered: [],
            uncovered: [],
            nonExecutable: [],
            matchedAs: undefined,
            note: 'no coverage report was supplied',
          };
        }
        if (coverage.status !== 'INCOMPLETE') {
          executable += coverage.covered.length + coverage.uncovered.length;
          coveredTotal += coverage.covered.length;
          uncoveredTotal += coverage.uncovered.length;
        }
        if (
          coverage.status === 'NOT_MEASURED' &&
          coverage.covered.length + coverage.uncovered.length === 0
        )
          noCoverageFiles += coverageData ? 1 : 0;
        if (coverage.uncovered.length > 0) {
          for (const r of lineRanges(coverage.uncovered))
            findings.add({
              rule: 'UNCOVERED-LINES',
              key: [change.path, r.start, r.end],
              severity: 'high',
              title: `Changed lines not executed by tests: ${change.path}:${r.start}${r.end > r.start ? `-${r.end}` : ''}`,
              explanation:
                'These lines were added or modified in this change and the coverage report records zero executions for them.',
              location: { path: change.path, startLine: r.start, endLine: r.end },
              evidence: [
                `coverage entry "${coverage.matchedAs ?? change.path}" reports hits=0 for lines ${formatLines(lineRangeLines(r))}`,
              ],
              suggestedAction:
                'Add or extend a test that executes these lines, then regenerate coverage.',
            });
        } else if (coverage.status === 'NOT_MEASURED' && coverageData)
          findings.add({
            rule: 'NO-COVERAGE',
            key: [change.path],
            severity: 'medium',
            title: `No coverage data for changed file: ${change.path}`,
            explanation: `Coverage could not be measured for this file: ${coverage.note ?? 'unknown reason'}. A changed file is not assumed to be tested.`,
            location: { path: change.path },
            evidence: [coverage.note ?? 'no entry in the coverage report'],
            suggestedAction:
              'Include this file in coverage instrumentation, or confirm it cannot be executed by tests.',
          });

        // Symbols
        const content = await fileAtHead(root, headSha, change.path);
        if (content !== undefined && language !== undefined) {
          const extraction = await extractFile(language, change.path, content);
          if (extraction === undefined)
            limitations.push(`${change.path}: parsing timed out; changed symbols were not mapped.`);
          else {
            if (extraction.parseErrors > 0)
              limitations.push(
                `${change.path}: ${extraction.parseErrors} syntax error(s); symbol ranges may be imprecise.`,
              );
            const groups = new Map<
              string,
              { sym: ExtractedSymbol; lines: number[]; deleted: boolean }
            >();
            for (const line of lines) {
              const sym = innermost(extraction.symbols, line);
              if (!sym) continue;
              const g = groups.get(sym.qualifiedName + sym.location.startLine) ?? {
                sym,
                lines: [],
                deleted: false,
              };
              g.lines.push(line);
              groups.set(sym.qualifiedName + sym.location.startLine, g);
            }
            for (const h of change.hunks)
              if (h.deletedAfterLine !== undefined) {
                const sym = innermost(extraction.symbols, Math.max(1, h.deletedAfterLine));
                if (
                  sym &&
                  h.deletedAfterLine >= sym.location.startLine &&
                  h.deletedAfterLine < sym.location.endLine
                ) {
                  const key = sym.qualifiedName + sym.location.startLine;
                  if (!groups.has(key)) groups.set(key, { sym, lines: [], deleted: true });
                }
              }
            for (const g of [...groups.values()].sort(
              (a, b) => a.sym.location.startLine - b.sym.location.startLine,
            )) {
              const cs = coverage ?? undefined;
              const set = (a: number[] | undefined): number[] =>
                g.lines.filter((l) => a?.includes(l));
              const covered = set(cs?.covered);
              const uncovered = set(cs?.uncovered);
              const nonExec = set(cs?.nonExecutable);
              const status: EvidenceStatus =
                !cs || cs.status === 'NOT_MEASURED' || cs.status === 'INCOMPLETE'
                  ? (cs?.status ?? 'NOT_MEASURED')
                  : covered.length + uncovered.length === 0
                    ? 'NOT_MEASURED'
                    : uncovered.length > 0
                      ? 'PARTIAL'
                      : 'PASS';
              const sym: ChangedSymbol = {
                name: g.sym.name,
                qualifiedName: g.sym.qualifiedName,
                kind: g.sym.kind,
                path: change.path,
                startLine: g.sym.location.startLine,
                endLine: g.sym.location.endLine,
                changedLines: g.lines,
                change: g.lines.length > 0 ? 'changed-lines' : 'deleted-lines',
                covered,
                uncovered,
                nonExecutable: nonExec,
                coverage: g.lines.length === 0 ? 'NOT_MEASURED' : status,
              };
              symbols.push(sym);
              if (
                coverageData &&
                g.lines.length > 0 &&
                covered.length === 0 &&
                uncovered.length > 0
              )
                findings.add({
                  rule: 'UNTESTED-SYMBOL',
                  key: [change.path, sym.qualifiedName],
                  severity: 'high',
                  title: `${sym.kind} ${sym.qualifiedName} changed with no executed changed line`,
                  explanation: `None of the executable changed lines in ${sym.qualifiedName} (${change.path}:${sym.startLine}-${sym.endLine}) were executed. File-level coverage is not used to infer that this symbol is tested.`,
                  location: { path: change.path, startLine: sym.startLine, endLine: sym.endLine },
                  evidence: [`uncovered changed lines: ${formatLines(uncovered)}`],
                  suggestedAction: `Add a test that calls ${sym.qualifiedName}.`,
                });
            }
          }
        } else if (content === undefined)
          limitations.push(
            `${change.path}: could not be read at head (missing or larger than ${MAX_SOURCE_BYTES} bytes); symbols were not mapped.`,
          );
      }

      // Regression: base vs head coverage of the whole file
      let baseRatio: number | undefined;
      let headRatio: number | undefined;
      if (isSource && baseMatches && coverageData && coverage?.matchedAs !== undefined) {
        const headFile = covMatches?.get(change.path)?.file;
        const baseFile = baseMatches.get(change.oldPath ?? change.path)?.file;
        headRatio = fileLineRatio(headFile);
        baseRatio = fileLineRatio(baseFile);
        const drop = options.coverageDropThreshold ?? 0.01;
        if (headRatio !== undefined && baseRatio !== undefined && baseRatio - headRatio >= drop)
          findings.add({
            rule: 'COVERAGE-REGRESSION',
            key: [change.path],
            severity: 'medium',
            title: `Coverage of ${change.path} dropped from ${(baseRatio * 100).toFixed(1)}% to ${(headRatio * 100).toFixed(1)}%`,
            explanation:
              'Whole-file line coverage is lower at head than at base (instrumented lines only).',
            location: { path: change.path },
            evidence: [
              `base ${(baseRatio * 100).toFixed(1)}% → head ${(headRatio * 100).toFixed(1)}%, threshold ${(drop * 100).toFixed(1)} points`,
            ],
            suggestedAction:
              'Cover the new or changed behaviour, or explain why coverage legitimately decreased.',
          });
      }

      // Test linkage
      let linkage: FileEntry['linkage'];
      if (isSource) {
        if (graphStore && graphAtHead) {
          const fileNode = graphStore.nodes.get(
            repositoryId,
            nodeIdFor(repositoryId, 'File', change.path),
          );
          if (!fileNode)
            linkage = {
              status: 'NOT_MEASURED',
              direct: [],
              transitive: [],
              changedTests: [],
              dependents: [],
            };
          else {
            const im = impactMap(graphStore, repositoryId, change.path);
            const direct = [
              ...new Set(im.tests.filter((t) => t.covers === change.path).map((t) => t.test)),
            ].sort();
            const transitive = [
              ...new Set(im.tests.filter((t) => t.covers !== change.path).map((t) => t.test)),
            ]
              .filter((t) => !direct.includes(t))
              .sort();
            for (const m of im.affectedModules) impacted.add(m);
            linkage = {
              status: direct.length > 0 ? 'PASS' : 'PARTIAL',
              direct,
              transitive,
              changedTests: [...direct, ...transitive].filter((t) => changedTestFiles.has(t)),
              dependents: im.dependents.map((d) => d.path).slice(0, 20),
            };
          }
        } else
          linkage = {
            status: 'NOT_MEASURED',
            direct: [],
            transitive: [],
            changedTests: [],
            dependents: [],
          };
        if (linkage.status === 'PARTIAL')
          findings.add({
            rule: 'NO-RELATED-TEST',
            key: [change.path],
            severity: linkage.transitive.length > 0 ? 'low' : 'medium',
            title: `No test directly linked to ${change.path}`,
            explanation:
              linkage.transitive.length > 0
                ? `Only tests of files that depend on it are linked (${linkage.transitive.slice(0, 3).join(', ')}). Links come from static imports and naming conventions and are not proof of coverage.`
                : 'ATLAS found no test file that imports or is conventionally named for this file.',
            location: { path: change.path },
            evidence: ['ATLAS TESTS edges and reverse-import walk found no direct test'],
            suggestedAction:
              'Add a test that imports this file, or confirm an existing test exercises it.',
          });
      }

      files.push({
        path: change.path,
        oldPath: change.oldPath,
        status: change.status,
        category,
        language,
        binary: change.binary,
        addedLines: change.addedLineCount,
        removedLines: change.removedLineCount,
        sensitive,
        coverage,
        linkage,
        baseCoverageRatio: baseRatio,
        headCoverageRatio: headRatio,
      });
    }

    // Tests -----------------------------------------------------------------------------------
    const tests = testSection(testsHead, testsBase, findings);

    // Coverage dimension ----------------------------------------------------------------------
    const covEntries = files
      .map((f) => f.coverage)
      .filter((c): c is ChangedFileCoverage => c !== undefined);
    const coverageDim = coverageDimension({
      supplied: (options.coverage?.length ?? 0) > 0,
      parsedOk: cov.data.length > 0,
      problems: cov.problems,
      stale: coverageStale,
      entries: covEntries,
      executable,
      covered: coveredTotal,
      min: options.minChangedLineCoverage,
    });
    if ((options.coverage?.length ?? 0) > 0 && cov.problems.length > 0)
      findings.add({
        rule: 'COVERAGE-MALFORMED',
        key: cov.problems.slice(0, 3),
        severity: 'high',
        title: 'Coverage input is malformed or incomplete',
        explanation:
          'Some coverage data could not be read, so coverage results below are INCOMPLETE rather than a pass.',
        evidence: cov.problems.slice(0, 5),
        suggestedAction: 'Regenerate the coverage report and make sure the file is complete.',
      });
    if (sourceChanged > 0 && !(options.coverage?.length ?? 0))
      findings.add({
        rule: 'COVERAGE-NOT-MEASURED',
        key: [],
        severity: 'medium',
        title: 'Changed-line coverage was not measured',
        explanation:
          'No coverage report was supplied, so ORBIT cannot say whether any changed line is executed by tests.',
        evidence: [`${sourceChanged} changed source file(s) have no coverage evidence`],
        suggestedAction:
          'Run tests with coverage and pass the LCOV or Cobertura report with --coverage.',
      });

    // Build -----------------------------------------------------------------------------------
    if (build.section.status === 'FAIL')
      findings.add({
        rule: 'BUILD-FAILED',
        key: [],
        severity: 'critical',
        title: 'Build failed',
        explanation: build.section.note,
        evidence: [
          build.section.command ? `command: ${build.section.command}` : 'build result file',
        ],
        suggestedAction: 'Fix the build before merging.',
      });
    else if (build.section.status === 'NOT_MEASURED')
      findings.add({
        rule: 'BUILD-NOT-MEASURED',
        key: [],
        severity: 'low',
        title: 'Build result not supplied',
        explanation: build.section.note,
        evidence: ['no --build-result input'],
        suggestedAction:
          'Pass a build result file (JSON with "status") from your CI or local build.',
      });
    else if (build.section.status === 'INCOMPLETE')
      findings.add({
        rule: 'BUILD-UNREADABLE',
        key: [],
        severity: 'medium',
        title: 'Build result could not be read',
        explanation: build.section.note,
        evidence: [build.section.note],
        suggestedAction: 'Provide JSON like {"status":"success","command":"pnpm build"}.',
      });

    // Linkage dimension -------------------------------------------------------------------------
    const linkEntries = files.filter((f) => f.linkage);
    const linkageDim: Dimension = {
      name: 'test-linkage',
      applicable: linkEntries.length > 0,
      status:
        linkEntries.length === 0
          ? 'PASS'
          : linkEntries.every((f) => f.linkage?.status === 'NOT_MEASURED')
            ? 'NOT_MEASURED'
            : worst(linkEntries.map((f) => f.linkage?.status ?? 'NOT_MEASURED')),
      summary:
        linkEntries.length === 0
          ? 'No changed source files.'
          : `${linkEntries.filter((f) => f.linkage?.status === 'PASS').length} of ${linkEntries.length} changed source files have a directly linked test (static links, not proof of coverage).`,
    };

    const testsDim: Dimension = {
      name: 'tests',
      applicable: true,
      status: tests.status,
      summary: tests.note,
    };
    const buildDim: Dimension = {
      name: 'build',
      applicable: true,
      status: build.section.status,
      summary: build.section.note,
    };
    const dimensions = [coverageDim, testsDim, buildDim, linkageDim];
    const considered = dimensions.filter((d) => d.applicable);
    const overall = worst(considered.map((d) => d.status));

    const decisions = await findDecisions(
      root,
      headSha,
      diff.files.map((f) => f.path),
      limitations,
    );
    if (linkEntries.length > 0 && graphAtHead)
      limitations.push(
        'Test linkage uses static imports and naming conventions; calls through dynamic dispatch or reflection are not seen.',
      );

    const report: VerificationReport = {
      witnessVersion: WITNESS_VERSION,
      repository: { key: options.store ? repositoryKey : undefined, name: basename(root) },
      base: { ref: options.base, sha: baseSha },
      mergeBase,
      head: { ref: options.head, sha: headSha },
      overall,
      dimensions,
      totals: {
        filesChanged: diff.totalFiles,
        linesAdded,
        linesRemoved,
        changedExecutableLines: executable,
        coveredChangedLines: coveredTotal,
        uncoveredChangedLines: uncoveredTotal,
        filesWithoutCoverage: noCoverageFiles,
      },
      files,
      symbols,
      tests,
      build: build.section,
      impactedModules: [...impacted].sort(),
      decisions,
      findings: findings.sorted(),
      limitations: [
        ...new Set([
          ...limitations,
          ...cov.problems.map((p) => `coverage: ${p}`),
          ...testsHead.problems.map((p) => `test report: ${p}`),
        ]),
      ],
      assumptions,
      inputs,
    };

    if (options.store)
      persist(options.store, repositoryId, repositoryKey, root, report, diff.files, diff.truncated);
    return report;
  } finally {
    ephemeral?.close();
  }
}

function lineRangeLines(r: { start: number; end: number }): number[] {
  const out: number[] = [];
  for (let l = r.start; l <= r.end && out.length < 200; l++) out.push(l);
  return out;
}

function testSection(
  head: ReturnType<typeof loadTests>,
  base: ReturnType<typeof loadTests>,
  findings: FindingSet,
): TestSection {
  const empty = {
    total: 0,
    passed: 0,
    failed: 0,
    errored: 0,
    skipped: 0,
    failures: [],
    regressions: [],
  };
  if (head.records.length === 0) {
    findings.add({
      rule: 'TESTS-NOT-MEASURED',
      key: [],
      severity: 'medium',
      title: 'Test results not supplied',
      explanation:
        'No JUnit XML report was supplied, so ORBIT has no evidence that tests were run.',
      evidence: ['no --test-report input'],
      suggestedAction:
        'Run the test suite with a JUnit reporter and pass the file with --test-report.',
    });
    return { status: 'NOT_MEASURED', ...empty, note: 'No test report was supplied.' };
  }
  if (!head.report || head.problems.length > 0) {
    findings.add({
      rule: 'TEST-REPORT-MALFORMED',
      key: head.problems.slice(0, 3),
      severity: 'high',
      title: 'Test report is malformed or incomplete',
      explanation: 'The test report could not be fully read, so test results are INCOMPLETE.',
      evidence: head.problems.slice(0, 5),
      suggestedAction: 'Regenerate the JUnit XML report.',
    });
    if (!head.report)
      return { status: 'INCOMPLETE', ...empty, note: 'Test report could not be read.' };
  }
  const report = head.report as TestReport;
  const s = summarizeTests(report);
  const failures = report.cases
    .filter((c) => c.status === 'failed' || c.status === 'error')
    .map((c) => ({ id: c.id, message: c.message }));
  for (const f of failures)
    findings.add({
      rule: 'TEST-FAILURE',
      key: [f.id],
      severity: 'high',
      title: `Test failed: ${f.id}`,
      explanation: f.message ?? 'The test report records a failure for this test.',
      evidence: ['JUnit report'],
      suggestedAction: 'Fix the failing test or the code it exercises.',
    });
  const regressions: TestSection['regressions'] = [];
  if (base.report) {
    const headById = new Map(report.cases.map((c) => [c.id, c]));
    for (const b of base.report.cases) {
      if (b.status !== 'passed') continue;
      const h = headById.get(b.id);
      if (!h) regressions.push({ id: b.id, baseStatus: 'passed', headStatus: 'missing' });
      else if (h.status === 'failed' || h.status === 'error')
        regressions.push({ id: b.id, baseStatus: 'passed', headStatus: h.status });
    }
    for (const r of regressions)
      findings.add({
        rule: 'TEST-REGRESSION',
        key: [r.id],
        severity: r.headStatus === 'missing' ? 'medium' : 'high',
        title:
          r.headStatus === 'missing'
            ? `Test passed at base but is missing at head: ${r.id}`
            : `Test passed at base and fails at head: ${r.id}`,
        explanation:
          r.headStatus === 'missing'
            ? 'A test that passed on the base is absent from the head report. It may have been renamed or deleted, or it did not run.'
            : 'This is a regression relative to the base test report.',
        evidence: [`base: passed, head: ${r.headStatus}`],
        suggestedAction: 'Restore the test, or confirm it was intentionally removed or renamed.',
      });
  }
  const status: EvidenceStatus =
    failures.length > 0 || regressions.some((r) => r.headStatus !== 'missing')
      ? 'FAIL'
      : head.problems.length > 0
        ? 'INCOMPLETE'
        : s.total - s.skipped === 0
          ? 'NOT_MEASURED'
          : regressions.length > 0 || s.skipped > 0
            ? 'PARTIAL'
            : 'PASS';
  const note =
    status === 'PASS'
      ? `${s.passed} of ${s.total} tests passed. Passing tests show the suite did not fail, not that the change is correct.`
      : `${s.passed} passed, ${s.failed + s.errored} failed, ${s.skipped} skipped of ${s.total}.`;
  return {
    status,
    total: s.total,
    passed: s.passed,
    failed: s.failed,
    errored: s.errored,
    skipped: s.skipped,
    failures,
    regressions,
    note,
  };
}

function coverageDimension(a: {
  supplied: boolean;
  parsedOk: boolean;
  problems: string[];
  stale: boolean;
  entries: ChangedFileCoverage[];
  executable: number;
  covered: number;
  min: number | undefined;
}): Dimension {
  if (a.entries.length === 0)
    return {
      name: 'coverage',
      applicable: false,
      status: 'PASS',
      summary: 'No changed source files to cover.',
    };
  if (!a.supplied)
    return {
      name: 'coverage',
      applicable: true,
      status: 'NOT_MEASURED',
      summary: 'No coverage report was supplied.',
    };
  if (!a.parsedOk || a.stale || a.problems.length > 0)
    return {
      name: 'coverage',
      applicable: true,
      status: 'INCOMPLETE',
      summary: a.stale
        ? 'Coverage was produced from a different commit than head.'
        : 'The coverage report is malformed or incomplete.',
    };
  const unmeasured = a.entries.filter((e) => e.status === 'NOT_MEASURED').length;
  const uncovered = a.entries.reduce((n, e) => n + e.uncovered.length, 0);
  const pct = a.executable > 0 ? a.covered / a.executable : undefined;
  const text = `${a.covered} of ${a.executable} executable changed lines covered${pct !== undefined ? ` (${(pct * 100).toFixed(1)}%)` : ''}; ${unmeasured} of ${a.entries.length} changed source files have no measurable changed lines.`;
  if (a.min !== undefined && pct !== undefined && pct < a.min)
    return {
      name: 'coverage',
      applicable: true,
      status: 'FAIL',
      summary: `${text} Below the required ${(a.min * 100).toFixed(1)}%.`,
    };
  if (a.executable === 0)
    return { name: 'coverage', applicable: true, status: 'NOT_MEASURED', summary: text };
  return {
    name: 'coverage',
    applicable: true,
    status: uncovered > 0 || unmeasured > 0 ? 'PARTIAL' : 'PASS',
    summary: text,
  };
}

function persist(
  store: GraphStore,
  repositoryId: string,
  repositoryKey: string,
  root: string,
  report: VerificationReport,
  files: readonly FileChange[],
  truncated: boolean,
): void {
  store.transaction(() => {
    store.repositories.register({ key: repositoryKey, displayName: basename(root) });
    const common = { repositoryId, commitSha: report.head.sha, relatedEntityIds: [] as string[] };
    const gitEvidence = store.evidence.append({
      ...common,
      source: `witness:${WITNESS_VERSION}:git-diff`,
      sourceType: 'git',
      contentHash: hashValue({
        base: report.mergeBase,
        head: report.head.sha,
        files: files.map((f) => [f.path, f.changedLines]),
      }),
      status: truncated ? 'PARTIAL' : 'PASS',
      limitations: truncated ? ['the file list was truncated by maxFiles'] : [],
    }).record.id;
    for (const input of report.inputs) {
      const type =
        input.kind === 'coverage' || input.kind === 'base-coverage'
          ? 'coverage'
          : input.kind === 'build-result'
            ? 'build'
            : 'test-report';
      // Base-side inputs describe another commit, so they carry no commitSha for head.
      const isBase = input.kind === 'base-coverage' || input.kind === 'base-test-report';
      store.evidence.append({
        repositoryId,
        ...(isBase ? {} : { commitSha: report.head.sha }),
        source: `witness:${WITNESS_VERSION}:${input.kind}:${input.path}`,
        sourceType: type,
        contentHash: input.sha256,
        status: input.status,
        limitations:
          input.status === 'PASS'
            ? []
            : input.problems.length > 0
              ? input.problems.slice(0, 20)
              : ['reported failure'],
        relatedEntityIds: [],
      });
    }
    for (const finding of report.findings) {
      const fileNodeId = finding.location
        ? nodeIdFor(repositoryId, 'File', finding.location.path)
        : undefined;
      const result = store.nodes.upsert({
        repositoryId,
        type: 'Finding',
        key: finding.id,
        attrs: {
          producer: 'witness',
          rule: finding.rule,
          severity: finding.severity,
          title: finding.title,
          explanation: finding.explanation,
          evidence: finding.evidence,
          suggestedAction: finding.suggestedAction,
          baseSha: report.mergeBase,
          headSha: report.head.sha,
          ...(finding.location && { location: { ...finding.location } }),
        },
        sourceEvidenceId: gitEvidence,
      });
      if (fileNodeId && store.nodes.get(repositoryId, fileNodeId))
        store.edges.upsert({
          repositoryId,
          type: 'AFFECTS',
          fromId: result.record.id,
          toId: fileNodeId,
          confidence: 1,
          attrs: { producer: 'witness' },
          sourceEvidenceId: gitEvidence,
        });
    }
  });
}
