# WITNESS sample report

`sample-report.{md,json,sarif}` are golden outputs for a tiny deterministic pull request created by
`src/fixture.ts` (fixed names, dates and contents, so commit SHAs are stable).

The LCOV, JUnit and build files that feed the sample are **hand-written fixtures** that exercise the
parsers. They are not output from a real test run and the numbers in the report describe that
fixture only. Regenerate with `UPDATE_GOLDEN=1 pnpm --filter @orbit/witness test`.
