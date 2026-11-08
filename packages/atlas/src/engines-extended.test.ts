import { describe, expect, it } from 'vitest';
import {
  parseJestJsonReport,
  parseGoTestJson,
  parsePytestJsonReport,
  analyseTestHistory,
} from './flare-extended.js';
import { inspectExtendedEnvironment } from './capsule-extended.js';
import {
  compareCoverageSnapshots,
  findSensitivePathFindings,
  mapChangeContext,
  renderWitnessSarif,
} from './witness-extended.js';
import { parseLcov, verifyChangedLineCoverage } from './verification.js';

const diff = [
  'diff --git a/src/service.ts b/src/service.ts',
  '--- a/src/service.ts',
  '+++ b/src/service.ts',
  '@@ -1,1 +1,3 @@',
  ' const oldValue = 1;',
  '+export function calculate() { return 2; }',
  '+export function helper() { return 3; }',
].join('\n');

describe('WITNESS extended verification', () => {
  it('detects sensitive paths by name without reading their contents', () => {
    const secretDiff = [
      'diff --git a/.env b/.env',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/.env',
      '@@ -0,0 +1 @@',
      '+TOKEN=placeholder',
    ].join('\n');
    const findings = findSensitivePathFindings(secretDiff);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe('secrets.environment-file');
    expect(findings[0]?.message).not.toContain('placeholder');
  });

  it('does not warn on safe environment templates', () => {
    const templateDiff = [
      'diff --git a/.env.example b/.env.example',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/.env.example',
      '@@ -0,0 +1 @@',
      '+API_URL=https://example.invalid',
    ].join('\n');
    expect(findSensitivePathFindings(templateDiff)).toEqual([]);
  });

  it('compares exact-path coverage snapshots and labels unavailable data', () => {
    const before = parseLcov('SF:src/service.ts\nDA:2,1\nDA:3,1\nend_of_record');
    const after = parseLcov('SF:src/service.ts\nDA:2,0\nDA:3,1\nend_of_record');
    const comparisons = compareCoverageSnapshots(before, after);
    expect(comparisons[0]).toMatchObject({
      path: 'src/service.ts',
      beforePercentage: 100,
      afterPercentage: 50,
      percentageDelta: -50,
      status: 'REGRESSION',
    });
    expect(compareCoverageSnapshots(before, []).map((item) => item.status)).toEqual([
      'NOT_COMPARABLE',
    ]);
  });

  it('maps changed lines to caller-supplied symbols and test relationships', () => {
    const context = mapChangeContext(
      diff,
      [
        { path: 'src/service.ts', qualifiedName: 'calculate', startLine: 2, endLine: 2 },
        { path: 'src/service.ts', qualifiedName: 'untouched', startLine: 1, endLine: 1 },
      ],
      [{ testPath: 'test/service.test.ts', sourcePaths: ['src/service.ts', 'src/other.ts'] }],
    );
    expect(context.changedSymbols.map((item) => item.qualifiedName)).toEqual(['calculate']);
    expect(context.relatedTests).toEqual([
      {
        testPath: 'test/service.test.ts',
        relatedSourcePaths: ['src/service.ts'],
      },
    ]);
    expect(context.limitations.length).toBeGreaterThan(0);
  });

  it('renders a SARIF 2.1.0 result with stable fingerprints', () => {
    const report = verifyChangedLineCoverage(diff, []);
    const value = JSON.parse(renderWitnessSarif(report, findSensitivePathFindings(diff))) as {
      version: string;
      runs: Array<{ results: unknown[]; tool: { driver: { name: string } } }>;
    };
    expect(value.version).toBe('2.1.0');
    expect(value.runs[0]?.tool.driver.name).toBe('ORBIT WITNESS');
    expect(value.runs[0]?.results).toHaveLength(1);
  });
});

describe('FLARE extended report adapters', () => {
  it('parses pytest JSON outcomes and execution durations', () => {
    const results = parsePytestJsonReport(
      JSON.stringify({
        tests: [
          { nodeid: 'tests/test_auth.py::test_login', outcome: 'passed', duration: 0.2 },
          {
            nodeid: 'tests/test_auth.py::test_logout',
            call: { outcome: 'failed', longrepr: 'assert 1 == 2' },
            duration: 0.4,
          },
          { nodeid: 'tests/test_auth.py::test_skip', outcome: 'skipped', duration: 0 },
        ],
      }),
    );
    expect(results.map((item) => item.outcome)).toEqual(['passed', 'failed', 'skipped']);
    expect(results[1]?.message).toContain('assert');
  });

  it('parses Jest JSON report and converts milliseconds to seconds', () => {
    const results = parseJestJsonReport(
      JSON.stringify({
        testResults: [
          {
            name: '/repo/auth.test.ts',
            assertionResults: [
              { fullName: 'auth logs in', title: 'logs in', status: 'passed', duration: 120 },
              {
                fullName: 'auth logs out',
                title: 'logs out',
                status: 'failed',
                duration: 250,
                failureMessages: ['timeout'],
              },
            ],
          },
        ],
      }),
    );
    expect(results[0]?.durationSeconds).toBe(0.12);
    expect(results[1]?.outcome).toBe('failed');
    expect(results[1]?.message).toContain('timeout');
  });

  it('parses Go test JSON terminal events and attaches output to failures', () => {
    const results = parseGoTestJson(
      [
        '{"Action":"run","Package":"example/app","Test":"TestLogin"}',
        '{"Action":"output","Package":"example/app","Test":"TestLogin","Output":"    auth_test.go:14: token missing\\n"}',
        '{"Action":"fail","Package":"example/app","Test":"TestLogin","Elapsed":0.3}',
        '{"Action":"pass","Package":"example/app","Test":"TestLogout","Elapsed":0.1}',
      ].join('\n'),
    );
    expect(results.map((item) => item.outcome)).toEqual(['failed', 'passed']);
    expect(results[0]?.message).toContain('token missing');
  });

  it('clusters failures and ranks slow tests with transparent limitations', () => {
    const results = Array.from({ length: 10 }, (_, index) => ({
      id: 'suite::flaky',
      name: 'flaky',
      suite: 'suite',
      outcome: index % 2 === 0 ? ('passed' as const) : ('failed' as const),
      durationSeconds: (index + 1) / 10,
      ...(index % 2 === 1 ? { message: 'assert failed at /workspace/a.ts:' + (20 + index) } : {}),
    }));
    const report = analyseTestHistory(results);
    expect(report.summaries[0]?.classification).toBe('suspected-flaky');
    expect(report.failureClusters[0]?.occurrences).toBe(5);
    expect(report.slowTests[0]?.p95Seconds).toBe(1);
    expect(report.limitations.length).toBeGreaterThan(0);
  });

  it('rejects malformed or oversized report JSON', () => {
    expect(() => parsePytestJsonReport('{')).toThrow(/valid JSON/);
    expect(() => parseJestJsonReport('{"testResults":[]}')).not.toThrow();
  });
});

describe('CAPSULE extended manifest inspection', () => {
  it('detects polyglot toolchains, dependency declarations, containers and workspaces', () => {
    const snapshot = inspectExtendedEnvironment({
      '.tool-versions': 'nodejs 22.12.0\npython 3.12.1\nrust 1.82.0',
      'requirements.txt': 'fastapi==0.115.0\npytest>=8.0',
      Dockerfile: 'FROM node:22-alpine AS build\nFROM nginx:alpine',
      'pnpm-workspace.yaml': 'packages:\n  - apps/*',
      'turbo.json': '{"tasks":{}}',
      'devcontainer.json': '{"image":"mcr.microsoft.com/devcontainers/base:ubuntu"}',
      'package.json': '{"packageManager":"pnpm@10","workspaces":["apps/*"]}',
      '.env.example': 'PUBLIC_URL=https://example.invalid',
      '.env': 'SECRET_VALUE=never-read',
    });
    expect(snapshot.toolchains).toMatchObject({
      node: '22.12.0',
      python: '3.12.1',
      rust: '1.82.0',
    });
    expect(snapshot.declaredDependencies.fastapi).toBe('0.115.0');
    expect(snapshot.containerImages.map((item) => item.image)).toContain('node:22-alpine');
    expect(snapshot.workspaceSignals).toContain('pnpm-workspace');
    expect(snapshot.workspaceSignals).toContain('turborepo');
    expect(snapshot.base.environmentVariableNames).toEqual(['PUBLIC_URL']);
    expect(JSON.stringify(snapshot)).not.toContain('never-read');
  });

  it('is deterministic and refuses oversized or excessive manifest input', () => {
    const files = { '.tool-versions': 'nodejs 22.12.0' };
    expect(inspectExtendedEnvironment(files).fingerprint).toBe(
      inspectExtendedEnvironment(files).fingerprint,
    );
    expect(() =>
      inspectExtendedEnvironment({ 'large.json': 'x'.repeat(2 * 1024 * 1024 + 1) }),
    ).toThrow(/2 MiB/);
    expect(() =>
      inspectExtendedEnvironment(
        Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`file-${i}`, 'x'])),
      ),
    ).toThrow(/1000 files/);
  });
});
