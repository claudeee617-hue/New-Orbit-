import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  renderJson,
  renderMarkdown,
  renderSarif,
  verifyChange,
  type EvidenceStatus,
  type VerificationReport,
} from '@orbit/witness';
import { createGraphStore, openDatabase } from '@orbit/database';
import { InvalidArgumentError } from 'commander';
import { OrbitError } from '@orbit/shared';

export interface VerifyCommandOptions {
  repo: string;
  base: string;
  head: string;
  coverage?: string[];
  baseCoverage?: string[];
  testReport?: string[];
  baseTestReport?: string[];
  buildResult?: string;
  coverageCommit?: string;
  minCoverage?: number;
  format: 'md' | 'json' | 'sarif';
  out?: string;
  force?: boolean;
  record?: boolean;
  db: string;
  failOn?: EvidenceStatus;
  key?: string;
}

export async function runVerify(options: VerifyCommandOptions): Promise<{
  report: VerificationReport;
  text: string;
}> {
  const store = options.record ? openDatabase({ path: resolve(options.db) }) : undefined;
  try {
    const report = await verifyChange({
      rootPath: options.repo,
      base: options.base,
      head: options.head,
      ...(store && { store: createGraphStore(store) }),
      ...(options.key !== undefined && { repositoryKey: options.key }),
      ...(options.record && { cacheDir: resolve(dirname(resolve(options.db)), 'cache') }),
      ...(options.coverage && { coverage: options.coverage }),
      ...(options.baseCoverage && { baseCoverage: options.baseCoverage }),
      ...(options.testReport && { testReport: options.testReport }),
      ...(options.baseTestReport && { baseTestReport: options.baseTestReport }),
      ...(options.buildResult !== undefined && { buildResult: options.buildResult }),
      ...(options.coverageCommit !== undefined && { coverageCommit: options.coverageCommit }),
      ...(options.minCoverage !== undefined && { minChangedLineCoverage: options.minCoverage }),
    });
    const text =
      options.format === 'json'
        ? renderJson(report)
        : options.format === 'sarif'
          ? renderSarif(report)
          : renderMarkdown(report);
    if (options.out !== undefined) {
      const target = resolve(options.out);
      if (existsSync(target) && !options.force)
        throw new OrbitError(
          'INVALID_INPUT',
          `${options.out} already exists; pass --force to overwrite it`,
        );
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    return { report, text };
  } finally {
    store?.close();
  }
}

const RANK: Record<EvidenceStatus, number> = {
  PASS: 0,
  PARTIAL: 1,
  NOT_MEASURED: 1,
  INCOMPLETE: 2,
  FAIL: 3,
};

/** True when `overall` is at least as bad as the threshold. */
export function meetsFailThreshold(overall: EvidenceStatus, threshold: EvidenceStatus): boolean {
  return RANK[overall] >= RANK[threshold];
}

export const collectValues = (value: string, previous: string[] = []): string[] => [
  ...previous,
  value,
];

export function parseFraction(value: string): number {
  const n = Number(value);
  if (!(n >= 0 && n <= 1)) throw new InvalidArgumentError('must be a number between 0 and 1');
  return n;
}

export function parseFailOn(value: string): 'PARTIAL' | 'INCOMPLETE' | 'FAIL' {
  if (value !== 'PARTIAL' && value !== 'INCOMPLETE' && value !== 'FAIL')
    throw new InvalidArgumentError('must be one of: PARTIAL, INCOMPLETE, FAIL');
  return value;
}

export function resolveGitFormat(value: string | undefined): 'md' | 'json' | 'sarif' {
  if (value === undefined || value === 'md' || value === 'markdown') return 'md';
  if (value === 'json' || value === 'sarif') return value;
  throw new OrbitError('INVALID_INPUT', '--format must be md, json or sarif');
}

/** Raised after the report is printed when `--fail-on` is met. */
export function failOnError(report: VerificationReport, failOn: EvidenceStatus | undefined): void {
  if (failOn && meetsFailThreshold(report.overall, failOn))
    throw new OrbitError(
      'VERIFICATION_FAILED',
      `verification result ${report.overall} is at least ${failOn}`,
    );
}
