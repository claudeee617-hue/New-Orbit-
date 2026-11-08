import { describe, expect, it } from 'vitest';
import { compareEnvironments, inspectEnvironment } from './capsule.js';
import { parseTelemetry } from './flight-recorder.js';
import { parseJunitXml, summarizeTestHistory, type TestCaseResult } from './flare.js';
import { createChangePassport } from './passport.js';
import {
  parseCobertura,
  parseLcov,
  parseUnifiedDiff,
  verifyChangedLineCoverage,
} from './verification.js';

describe('WITNESS changed-line verification', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    ' const before = true;',
    '+const changed = true;',
    ' const after = true;',
  ].join('\n');

  it('maps added lines to measured coverage and does not count deleted lines', () => {
    expect(parseUnifiedDiff(diff)[0]?.addedLines).toEqual([2]);
    const report = verifyChangedLineCoverage(
      diff,
      parseLcov('TN:\nSF:src/a.ts\nDA:2,1\nend_of_record\n'),
    );
    expect(report.summary).toMatchObject({
      changedLines: 1,
      measuredLines: 1,
      coveredLines: 1,
      percentage: 100,
      status: 'PASS',
    });
    expect(report.findings).toHaveLength(0);
  });

  it('distinguishes uncovered from missing coverage evidence', () => {
    const uncovered = verifyChangedLineCoverage(
      diff,
      parseLcov('SF:src/a.ts\nDA:2,0\nend_of_record'),
    );
    expect(uncovered.summary.status).toBe('PARTIAL');
    expect(uncovered.findings[0]?.rule).toBe('coverage.uncovered');
    const missing = verifyChangedLineCoverage(diff, []);
    expect(missing.summary.status).toBe('INCOMPLETE');
    expect(missing.findings[0]?.rule).toBe('coverage.missing');
  });

  it('parses Cobertura line hits and rejects DTD/entity declarations', () => {
    const xml =
      '<coverage><packages><package><classes><class filename="src/a.ts"><lines><line number="2" hits="3"/></lines></class></classes></package></packages></coverage>';
    expect(verifyChangedLineCoverage(diff, parseCobertura(xml)).summary.status).toBe('PASS');
    expect(() =>
      parseCobertura('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><coverage/>'),
    ).toThrow(/DTD/);
  });
});

describe('FLARE test history', () => {
  it('parses JUnit outcomes and durations', () => {
    const xml =
      '<testsuite name="unit"><testcase classname="auth" name="login" time="0.12"/><testcase classname="auth" name="logout" time="0.2"><failure message="expected 1">bad</failure></testcase><testcase classname="auth" name="skip"><skipped/></testcase></testsuite>';
    expect(parseJunitXml(xml).map((item) => item.outcome)).toEqual(['passed', 'failed', 'skipped']);
    const selfClosing =
      '<testsuite name="unit"><testcase classname="auth" name="broken"><failure message="timeout"/></testcase></testsuite>';
    expect(parseJunitXml(selfClosing)[0]?.outcome).toBe('failed');
  });

  it('uses minimum samples and outcome flips before flagging suspected flakiness', () => {
    const history: TestCaseResult[] = Array.from({ length: 10 }, (_, index) => ({
      id: 'suite::case',
      name: 'case',
      suite: 'suite',
      outcome: index % 2 === 0 ? 'passed' : 'failed',
      durationSeconds: 0.1,
    }));
    expect(summarizeTestHistory(history)[0]?.classification).toBe('suspected-flaky');
    expect(summarizeTestHistory(history.slice(0, 4))[0]?.classification).toBe('insufficient-data');
  });

  it('rejects XML entity declarations', () => {
    expect(() => parseJunitXml('<!DOCTYPE x [<!ENTITY e "x">]><testsuite/>')).toThrow(/entity/);
  });
});

describe('CAPSULE environment inspection', () => {
  it('fingerprints declared environment without reading secret values', () => {
    const snapshot = inspectEnvironment({
      'package.json': JSON.stringify({
        packageManager: 'pnpm@10',
        engines: { node: '>=22' },
        dependencies: { fastify: '5.x' },
        scripts: { test: 'vitest run' },
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9',
      '.env.example': 'API_KEY=example-only\nPORT=4317',
    });
    expect(snapshot.runtimes.node).toBe('>=22');
    expect(snapshot.environmentVariableNames).toEqual(['API_KEY', 'PORT']);
    expect(JSON.stringify(snapshot)).not.toContain('example-only');
  });

  it('compares runtime, dependency and lockfile changes', () => {
    const before = inspectEnvironment({
      'package.json': '{"dependencies":{"a":"1"}}',
      'package-lock.json': 'one',
    });
    const after = inspectEnvironment({
      'package.json': '{"dependencies":{"a":"2"}}',
      'package-lock.json': 'two',
    });
    expect(compareEnvironments(before, after).map((item) => item.kind)).toContain('dependency');
    expect(compareEnvironments(before, after).map((item) => item.kind)).toContain('lockfile');
  });
});

describe('FLIGHT RECORDER telemetry replay', () => {
  it('parses NDJSON metrics and identifies watchdog/reset events', () => {
    const session = parseTelemetry(
      [
        '{"timestamp":"2026-11-08T10:00:00Z","voltage":3.3,"temperature":28.5,"event":"boot"}',
        '{"timestamp":"2026-11-08T10:00:01Z","voltage":3.2,"event":"watchdog reset"}',
      ].join('\n'),
    );
    expect(session.format).toBe('ndjson');
    expect(session.metricNames).toEqual(['temperature', 'voltage']);
    expect(session.watchdogEvents).toBe(1);
    expect(session.resetEvents).toBe(2);
    expect(session.rawSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Change Passport', () => {
  it('creates a deterministic content hash and makes missing evidence explicit', () => {
    const input = {
      repository: 'owner/repo',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
      diffSha256: 'a'.repeat(64),
      changedFiles: ['b.ts', 'a.ts'],
      evidence: [],
    };
    const a = createChangePassport(input, { now: () => '2026-11-08T00:00:00.000Z' });
    const b = createChangePassport(input, { now: () => '2026-11-08T00:00:00.000Z' });
    expect(a.id).toBe(b.id);
    expect(a.contentSha256).toBe(b.contentSha256);
    expect(a.state).toBe('PARTIAL');
    expect(a.missingEvidence).toHaveLength(4);
  });
});
