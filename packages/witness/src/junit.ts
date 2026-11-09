import { XmlError, childrenNamed, parseXml, type XmlElement } from './xml.js';

export type CaseStatus = 'passed' | 'failed' | 'error' | 'skipped';

export interface TestCaseResult {
  id: string;
  suite: string;
  status: CaseStatus;
  message: string | undefined;
}

export interface TestReport {
  cases: TestCaseResult[];
}

export interface TestReportParse {
  report: TestReport | undefined;
  problems: string[];
}

export function parseJUnit(text: string): TestReportParse {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (error) {
    if (error instanceof XmlError)
      return { report: undefined, problems: [`invalid XML: ${error.message}`] };
    throw error;
  }
  if (root.name !== 'testsuites' && root.name !== 'testsuite')
    return {
      report: undefined,
      problems: [`root element is <${root.name}>, expected <testsuites> or <testsuite>`],
    };
  const problems: string[] = [];
  const cases: TestCaseResult[] = [];
  const seen = new Map<string, number>();
  const visit = (el: XmlElement, suite: string): void => {
    for (const child of el.children) {
      if (child.name === 'testsuite') visit(child, child.attrs['name'] ?? suite);
      else if (child.name === 'testcase') {
        const name = child.attrs['name'];
        if (!name) {
          if (problems.length < 20) problems.push('a <testcase> has no name attribute');
          continue;
        }
        const classname = child.attrs['classname'] ?? suite;
        let id = `${classname}::${name}`;
        const n = (seen.get(id) ?? 0) + 1;
        seen.set(id, n);
        if (n > 1) id = `${id}#${n}`;
        const failure = childrenNamed(child, 'failure')[0];
        const err = childrenNamed(child, 'error')[0];
        const skipped = childrenNamed(child, 'skipped')[0];
        const status: CaseStatus = failure
          ? 'failed'
          : err
            ? 'error'
            : skipped
              ? 'skipped'
              : 'passed';
        const message = (failure ?? err)?.attrs['message'];
        cases.push({ id, suite, status, message });
      } else visit(child, suite);
    }
  };
  visit(root, root.attrs['name'] ?? '');
  if (cases.length === 0) problems.push('the report contains no <testcase> elements');
  return { report: cases.length > 0 ? { cases } : undefined, problems };
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}

export function summarizeTests(report: TestReport): TestSummary {
  const s: TestSummary = {
    total: report.cases.length,
    passed: 0,
    failed: 0,
    errored: 0,
    skipped: 0,
  };
  for (const c of report.cases) {
    if (c.status === 'passed') s.passed += 1;
    else if (c.status === 'failed') s.failed += 1;
    else if (c.status === 'error') s.errored += 1;
    else s.skipped += 1;
  }
  return s;
}
