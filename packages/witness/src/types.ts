import type { EvidenceStatus } from '@orbit/core';

export type { EvidenceStatus };

export const WITNESS_VERSION = '0.1.0';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface LineRange {
  start: number;
  end: number;
}

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface Hunk {
  /** Lines on the head side that were added or rewritten (empty for a pure deletion). */
  addedLines: LineRange | undefined;
  /** True when the hunk replaced existing lines (as opposed to adding new ones). */
  modifiedExisting: boolean;
  /** Number of base lines removed by this hunk. */
  removedCount: number;
  /** For a pure deletion: the head line after which the lines were removed (0 = start of file). */
  deletedAfterLine: number | undefined;
}

export interface FileChange {
  path: string;
  oldPath: string | undefined;
  status: ChangeStatus;
  binary: boolean;
  hunks: Hunk[];
  /** Head-side lines that were added or modified, ascending, de-duplicated. */
  changedLines: number[];
  addedLineCount: number;
  removedLineCount: number;
}

export interface Location {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface Finding {
  id: string;
  rule: string;
  severity: Severity;
  title: string;
  explanation: string;
  location: Location | undefined;
  evidence: string[];
  suggestedAction: string;
}

export type LineState = 'covered' | 'uncovered' | 'non-executable';

export interface ChangedFileCoverage {
  path: string;
  /** NOT_MEASURED when the coverage report has no entry for this file. */
  status: EvidenceStatus;
  covered: number[];
  uncovered: number[];
  nonExecutable: number[];
  matchedAs: string | undefined;
  note: string | undefined;
}

export interface ChangedSymbol {
  name: string;
  qualifiedName: string;
  kind: string;
  path: string;
  startLine: number;
  endLine: number;
  /** Changed head lines that fall inside this symbol (innermost symbol wins). */
  changedLines: number[];
  /** `deleted-lines` when only deletions touched the symbol. */
  change: 'changed-lines' | 'deleted-lines';
  covered: number[];
  uncovered: number[];
  nonExecutable: number[];
  coverage: EvidenceStatus;
}

export interface InputRecord {
  kind: 'coverage' | 'base-coverage' | 'test-report' | 'base-test-report' | 'build-result';
  path: string;
  sha256: string;
  status: EvidenceStatus;
  problems: string[];
}

export interface Dimension {
  name: 'coverage' | 'tests' | 'build' | 'test-linkage';
  status: EvidenceStatus;
  /** False when the dimension does not apply to this change (for example no source files changed). */
  applicable: boolean;
  summary: string;
}

export interface FileEntry {
  path: string;
  oldPath: string | undefined;
  status: ChangeStatus;
  category: string;
  language: string | undefined;
  binary: boolean;
  addedLines: number;
  removedLines: number;
  sensitive: { category: string; severity: Severity; reason: string }[];
  coverage: ChangedFileCoverage | undefined;
  linkage:
    | {
        status: EvidenceStatus;
        direct: string[];
        transitive: string[];
        changedTests: string[];
        dependents: string[];
      }
    | undefined;
  baseCoverageRatio: number | undefined;
  headCoverageRatio: number | undefined;
}

export interface TestSection {
  status: EvidenceStatus;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  failures: { id: string; message: string | undefined }[];
  regressions: { id: string; baseStatus: string; headStatus: string }[];
  note: string;
}

export interface BuildSection {
  status: EvidenceStatus;
  command: string | undefined;
  note: string;
}

export interface DecisionRef {
  path: string;
  title: string;
  status: string | undefined;
  matched: string[];
}

export interface VerificationReport {
  witnessVersion: string;
  repository: { key: string | undefined; name: string };
  base: { ref: string; sha: string };
  mergeBase: string;
  head: { ref: string; sha: string };
  overall: EvidenceStatus;
  dimensions: Dimension[];
  totals: {
    filesChanged: number;
    linesAdded: number;
    linesRemoved: number;
    changedExecutableLines: number;
    coveredChangedLines: number;
    uncoveredChangedLines: number;
    filesWithoutCoverage: number;
  };
  files: FileEntry[];
  symbols: ChangedSymbol[];
  tests: TestSection;
  build: BuildSection;
  impactedModules: string[];
  decisions: DecisionRef[];
  findings: Finding[];
  limitations: string[];
  assumptions: string[];
  inputs: InputRecord[];
}
