import { createHash } from 'node:crypto';
import type { CoverageFile, VerificationFinding, VerificationReport } from './verification.js';
import { parseUnifiedDiff } from './verification.js';

export interface CoverageFileComparison {
  path: string;
  beforeMeasuredLines: number;
  afterMeasuredLines: number;
  beforePercentage: number | null;
  afterPercentage: number | null;
  percentageDelta: number | null;
  status: 'REGRESSION' | 'IMPROVED' | 'UNCHANGED' | 'NOT_COMPARABLE';
}

export interface ChangedSymbolRef {
  path: string;
  qualifiedName: string;
  startLine: number;
  endLine: number;
}

export interface RelatedTestRef {
  testPath: string;
  sourcePaths: string[];
}

export interface ChangeContext {
  changedFiles: string[];
  changedSymbols: Array<{ path: string; qualifiedName: string; changedLines: number[] }>;
  relatedTests: Array<{ testPath: string; relatedSourcePaths: string[] }>;
  limitations: string[];
}

const SECRET_RULES: Array<{
  id: string;
  severity: VerificationFinding['severity'];
  test: RegExp;
  message: string;
}> = [
  {
    id: 'secrets.environment-file',
    severity: 'error',
    test: /(^|\/)\.env(?:\.[^/]+)?$/i,
    message:
      'A non-template environment file is included in the change. Review it for credentials before publishing.',
  },
  {
    id: 'secrets.private-key',
    severity: 'error',
    test: /(^|\/)(?:id_(?:rsa|dsa|ecdsa|ed25519)|[^/]+\.(?:pem|key|p12|pfx|keystore))$/i,
    message:
      'A private-key or certificate-like file is included in the change. Confirm it contains no private credential material.',
  },
  {
    id: 'secrets.package-token-config',
    severity: 'warning',
    test: /(^|\/)\.npmrc$/i,
    message:
      'An npm configuration file is included. Check that it does not contain an authentication token.',
  },
  {
    id: 'secrets.service-account',
    severity: 'warning',
    test: /(^|\/)(?:service[-_]?account|credentials?)(?:[-_.][^/]*)?\.json$/i,
    message: 'A credentials or service-account JSON file is included. Review it before publishing.',
  },
];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Detects risky file names from diff metadata only; it never reads file contents. */
export function findSensitivePathFindings(diff: string): VerificationFinding[] {
  const findings: VerificationFinding[] = [];
  for (const file of parseUnifiedDiff(diff)) {
    const basename = file.path.split('/').at(-1)?.toLowerCase() ?? '';
    if (/^\.env\.(?:example|sample|template|dist)$/i.test(basename)) continue;
    for (const rule of SECRET_RULES) {
      if (!rule.test.test(file.path)) continue;
      const seed = `${rule.id}\0${file.path}`;
      findings.push({
        id: createHash('sha256').update(seed).digest('hex').slice(0, 16),
        severity: rule.severity,
        rule: rule.id,
        path: file.path,
        lines: file.addedLines,
        message: rule.message,
        evidence: [file.path],
      });
      break;
    }
  }
  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule));
}

function coverageStats(lines: Map<number, number> | undefined): {
  measured: number;
  covered: number;
  percentage: number | null;
} {
  if (!lines || lines.size === 0) return { measured: 0, covered: 0, percentage: null };
  const measured = [...lines.entries()].filter(
    ([line, hits]) => Number.isInteger(line) && line > 0 && Number.isFinite(hits) && hits >= 0,
  );
  const covered = measured.filter(([, hits]) => hits > 0).length;
  return {
    measured: measured.length,
    covered,
    percentage: measured.length ? round((covered / measured.length) * 100) : null,
  };
}

/** Compare two coverage snapshots using exact repository-relative paths; ambiguous suffix matches are never guessed. */
export function compareCoverageSnapshots(
  before: readonly CoverageFile[],
  after: readonly CoverageFile[],
): CoverageFileComparison[] {
  const oldFiles = new Map(before.map((file) => [file.path, file.lines]));
  const newFiles = new Map(after.map((file) => [file.path, file.lines]));
  const paths = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort();
  return paths.map((path) => {
    const oldStats = coverageStats(oldFiles.get(path));
    const newStats = coverageStats(newFiles.get(path));
    const comparable = oldStats.percentage !== null && newStats.percentage !== null;
    const delta = comparable ? round(newStats.percentage! - oldStats.percentage!) : null;
    const status: CoverageFileComparison['status'] = !comparable
      ? 'NOT_COMPARABLE'
      : delta! < 0
        ? 'REGRESSION'
        : delta! > 0
          ? 'IMPROVED'
          : 'UNCHANGED';
    return {
      path,
      beforeMeasuredLines: oldStats.measured,
      afterMeasuredLines: newStats.measured,
      beforePercentage: oldStats.percentage,
      afterPercentage: newStats.percentage,
      percentageDelta: delta,
      status,
    };
  });
}

/** Maps explicitly supplied ATLAS symbol/test references to changed files and added line ranges. */
export function mapChangeContext(
  diff: string,
  symbols: readonly ChangedSymbolRef[],
  tests: readonly RelatedTestRef[],
): ChangeContext {
  const files = parseUnifiedDiff(diff).filter((file) => file.status !== 'deleted');
  const changedLines = new Map(files.map((file) => [file.path, new Set(file.addedLines)]));
  const changedFiles = [...changedLines.keys()].sort();
  const changedSymbols = symbols
    .filter((symbol) => {
      const lines = changedLines.get(symbol.path);
      if (!lines) return false;
      for (let line = symbol.startLine; line <= symbol.endLine; line += 1) {
        if (lines.has(line)) return true;
      }
      return false;
    })
    .map((symbol) => ({
      path: symbol.path,
      qualifiedName: symbol.qualifiedName,
      changedLines: [...(changedLines.get(symbol.path) ?? [])]
        .filter((line) => line >= symbol.startLine && line <= symbol.endLine)
        .sort((a, b) => a - b),
    }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.qualifiedName.localeCompare(b.qualifiedName));
  const relatedTests = tests
    .map((test) => ({
      testPath: test.testPath,
      relatedSourcePaths: test.sourcePaths.filter((path) => changedLines.has(path)).sort(),
    }))
    .filter((test) => test.relatedSourcePaths.length > 0)
    .sort((a, b) => a.testPath.localeCompare(b.testPath));
  return {
    changedFiles,
    changedSymbols,
    relatedTests,
    limitations: [
      'Symbol and test relationships are only as complete as the supplied ATLAS mapping; this function does not infer missing call or test edges.',
      'A symbol is considered changed when an added diff line intersects its supplied source range.',
      'Deleted lines and renamed-file history are not inferred beyond the paths represented in the diff.',
    ],
  };
}

export function renderWitnessMarkdown(
  report: VerificationReport,
  additionalFindings: readonly VerificationFinding[] = [],
): string {
  const findings = [...report.findings, ...additionalFindings];
  const rows = report.files.map(
    (file) =>
      `| ${file.path} | ${file.coverage.changedLines} | ${file.coverage.measuredLines} | ${file.coverage.coveredLines} | ${file.coverage.percentage === null ? 'n/a' : `${file.coverage.percentage}%`} | ${file.coverage.status} |`,
  );
  return [
    '# ORBIT WITNESS — Verification report',
    '',
    `**Coverage status:** ${report.summary.status}`,
    `**Changed lines:** ${report.summary.changedLines} · **Measured:** ${report.summary.measuredLines} · **Covered:** ${report.summary.coveredLines} · **Coverage:** ${report.summary.percentage === null ? 'not measured' : `${report.summary.percentage}%`}`,
    '',
    '| File | Changed | Measured | Covered | Coverage | Status |',
    '|---|---:|---:|---:|---:|---|',
    ...rows,
    '',
    '## Findings',
    ...(findings.length
      ? findings.map(
          (item) =>
            `- **${item.severity.toUpperCase()} · ${item.rule}** ${item.path}: ${item.message}`,
        )
      : ['- No findings.']),
    '',
    '## Limitations',
    ...report.limitations.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

/** SARIF 2.1.0 output for CI annotation consumers. Findings remain advisory, not an approval decision. */
export function renderWitnessSarif(
  report: VerificationReport,
  additionalFindings: readonly VerificationFinding[] = [],
): string {
  const findings = [...report.findings, ...additionalFindings];
  const rules = [...new Set(findings.map((finding) => finding.rule))].sort();
  return `${JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'ORBIT WITNESS',
              informationUri: 'https://github.com/claudeee617-hue/New-Orbit-',
              rules: rules.map((id) => ({
                id,
                shortDescription: { text: id.replaceAll('.', ' ') },
              })),
            },
          },
          results: findings.map((finding) => ({
            ruleId: finding.rule,
            level:
              finding.severity === 'error'
                ? 'error'
                : finding.severity === 'info'
                  ? 'note'
                  : 'warning',
            message: { text: finding.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: finding.path },
                  ...(finding.lines[0] !== undefined
                    ? { region: { startLine: finding.lines[0] } }
                    : {}),
                },
              },
            ],
            partialFingerprints: { 'orbit/v1': finding.id },
            properties: { evidence: finding.evidence, affectedLines: finding.lines },
          })),
          properties: {
            coverageStatus: report.summary.status,
            changedLines: report.summary.changedLines,
            measuredLines: report.summary.measuredLines,
            coveredLines: report.summary.coveredLines,
            limitations: report.limitations,
          },
        },
      ],
    },
    null,
    2,
  )}\n`;
}
