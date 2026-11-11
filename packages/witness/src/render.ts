import type { Finding, Severity, VerificationReport } from './types.js';

/** Stable JSON: fixed key order from the report type, 2-space indent, trailing newline. */
export function renderJson(report: VerificationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const cell = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const short = (sha: string): string => sha.slice(0, 10);

export function renderMarkdown(r: VerificationReport): string {
  const o: string[] = [];
  const t = r.totals;
  o.push(`# WITNESS verification: ${r.overall}`, '');
  o.push(
    `Repository \`${r.repository.name}\` · base \`${short(r.base.sha)}\` (${r.base.ref}) · merge base \`${short(r.mergeBase)}\` · head \`${short(r.head.sha)}\` (${r.head.ref})`,
    '',
  );
  o.push(
    '> PASS means every measured dimension passed. NOT_MEASURED and INCOMPLETE are never counted as passing. A passing test run does not prove correctness.',
    '',
  );
  o.push('## Result by dimension', '', '| Dimension | Status | Detail |', '| --- | --- | --- |');
  for (const d of r.dimensions)
    o.push(
      `| ${d.name} | ${d.applicable ? d.status : `${d.status} (not applicable)`} | ${cell(d.summary)} |`,
    );
  o.push('', '## Change summary', '');
  o.push(`- Files changed: ${t.filesChanged}`);
  o.push(`- Lines: +${t.linesAdded} / -${t.linesRemoved}`);
  o.push(
    `- Executable changed lines covered: ${t.coveredChangedLines} of ${t.changedExecutableLines}; uncovered: ${t.uncoveredChangedLines}`,
  );
  o.push(`- Changed source files with no coverage data: ${t.filesWithoutCoverage}`);
  o.push(
    `- Tests: ${r.tests.status}${r.tests.total > 0 ? ` (${r.tests.passed} passed, ${r.tests.failed + r.tests.errored} failed, ${r.tests.skipped} skipped)` : ''}`,
  );
  o.push(`- Build: ${r.build.status}${r.build.command ? ` (\`${r.build.command}\`)` : ''}`);
  o.push(
    `- Impacted modules: ${r.impactedModules.length > 0 ? r.impactedModules.map((m) => `\`${m}\``).join(', ') : 'none found (or not measured)'}`,
  );

  o.push(
    '',
    '## Files',
    '',
    '| File | Change | Category | +/- | Changed-line coverage | Linked tests |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const f of r.files) {
    const c = f.coverage;
    const cov = !c
      ? '—'
      : `${c.status}${c.covered.length + c.uncovered.length > 0 ? ` (${c.covered.length}/${c.covered.length + c.uncovered.length})` : ''}`;
    const l = f.linkage;
    const link = !l
      ? '—'
      : `${l.status}${l.status !== 'NOT_MEASURED' ? ` (${l.direct.length} direct, ${l.transitive.length} indirect)` : ''}`;
    o.push(
      `| \`${f.path}\`${f.oldPath ? ` (was \`${f.oldPath}\`)` : ''} | ${f.status} | ${f.category} | +${f.addedLines}/-${f.removedLines} | ${cov} | ${link} |`,
    );
  }

  if (r.symbols.length > 0) {
    o.push(
      '',
      '## Changed symbols',
      '',
      '| Symbol | Location | Changed lines | Covered | Uncovered | Coverage |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const s of r.symbols)
      o.push(
        `| \`${s.qualifiedName}\` (${s.kind}) | \`${s.path}:${s.startLine}-${s.endLine}\` | ${s.change === 'deleted-lines' ? 'deletions only' : s.changedLines.length} | ${s.covered.length} | ${s.uncovered.length} | ${s.coverage} |`,
      );
  }

  if (r.tests.failures.length > 0 || r.tests.regressions.length > 0) {
    o.push('', '## Test failures and regressions', '');
    for (const f of r.tests.failures)
      o.push(`- FAIL \`${f.id}\`${f.message ? `: ${cell(f.message)}` : ''}`);
    for (const g of r.tests.regressions)
      o.push(`- REGRESSION \`${g.id}\`: ${g.baseStatus} → ${g.headStatus}`);
  }

  o.push('', '## Findings', '');
  if (r.findings.length === 0) o.push('No findings.');
  for (const f of r.findings) {
    o.push(`### ${f.id} — ${f.severity.toUpperCase()}: ${f.title}`, '');
    o.push(f.explanation, '');
    if (f.location)
      o.push(
        `- Source: \`${f.location.path}${f.location.startLine ? `:${f.location.startLine}${f.location.endLine && f.location.endLine !== f.location.startLine ? `-${f.location.endLine}` : ''}` : ''}\``,
      );
    for (const e of f.evidence) o.push(`- Evidence: ${e}`);
    o.push(`- Suggested action: ${f.suggestedAction}`, '');
  }

  if (r.decisions.length > 0) {
    o.push('## Relevant architecture decisions', '');
    for (const d of r.decisions)
      o.push(
        `- \`${d.path}\` — ${d.title}${d.status ? ` (${d.status})` : ''}; mentions ${d.matched.map((m) => `\`${m}\``).join(', ')}`,
      );
    o.push('');
  }

  o.push('## Inputs', '');
  if (r.inputs.length === 0) o.push('No coverage, test or build inputs were supplied.');
  for (const i of r.inputs)
    o.push(
      `- ${i.kind}: \`${i.path}\` sha256 \`${i.sha256.slice(0, 16)}…\` — ${i.status}${i.problems.length > 0 ? ` (${i.problems.length} problem(s))` : ''}`,
    );
  if (r.assumptions.length > 0)
    o.push('', '## Assumptions', '', ...r.assumptions.map((a) => `- ${a}`));
  if (r.limitations.length > 0)
    o.push('', '## Limitations', '', ...r.limitations.map((l) => `- ${l}`));
  o.push('', `_Generated by ORBIT WITNESS ${r.witnessVersion}._`, '');
  return o.join('\n');
}

const SARIF_LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'note',
  info: 'note',
};
const SECURITY_SEVERITY: Record<Severity, string> = {
  critical: '9.5',
  high: '7.5',
  medium: '5.0',
  low: '3.0',
  info: '0.0',
};

export function renderSarif(r: VerificationReport): string {
  const rules = new Map<string, Finding>();
  for (const f of r.findings) if (!rules.has(f.rule)) rules.set(f.rule, f);
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'ORBIT WITNESS',
            version: r.witnessVersion,
            rules: [...rules.values()]
              .sort((a, b) => a.rule.localeCompare(b.rule))
              .map((f) => ({
                id: f.rule,
                name: f.rule,
                shortDescription: { text: f.title.replace(/[:].*$/, '') },
                defaultConfiguration: { level: SARIF_LEVEL[f.severity] },
              })),
          },
        },
        invocations: [{ executionSuccessful: true }],
        properties: {
          overallStatus: r.overall,
          baseSha: r.mergeBase,
          headSha: r.head.sha,
        },
        results: r.findings.map((f) => ({
          ruleId: f.rule,
          level: SARIF_LEVEL[f.severity],
          message: { text: `${f.title}. ${f.explanation} Suggested action: ${f.suggestedAction}` },
          ...(f.location && {
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: f.location.path, uriBaseId: '%SRCROOT%' },
                  ...(f.location.startLine !== undefined && {
                    region: {
                      startLine: f.location.startLine,
                      ...(f.location.endLine !== undefined && { endLine: f.location.endLine }),
                    },
                  }),
                },
              },
            ],
          }),
          partialFingerprints: { 'orbitFindingId/v1': f.id },
          properties: {
            severity: f.severity,
            evidence: f.evidence,
            'security-severity': SECURITY_SEVERITY[f.severity],
          },
        })),
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}
