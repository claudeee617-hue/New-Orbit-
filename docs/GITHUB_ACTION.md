# ORBIT GitHub Action

ORBIT's composite Action runs the trusted ORBIT CLI from the pull request's base commit against the PR diff as data. It does not execute the changed PR source tree. The Action is intentionally advisory by default.

## Caller workflow

Create `.github/workflows/orbit.yml` in the consuming repository:

```yaml
name: ORBIT verification

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write # Needed only for the optional single upserted comment.
  # security-events: write # Add only if upload-sarif is enabled.

jobs:
  orbit:
    runs-on: ubuntu-latest
    steps:
      - name: Check out PR data
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Run ORBIT
        uses: claudeee617-hue/New-Orbit-/.github/actions/orbit@main
        with:
          github-token: ${{ github.token }}
          coverage-file: coverage/lcov.info
          coverage-format: lcov
          fail-on-uncovered: "false"
          comment: "true"
          upload-sarif: "false"
```

The example assumes a trusted ORBIT release has been merged to `main`. For a Cobertura report, set `coverage-format: cobertura`. Omit `coverage-file` if no report is available; the output is explicitly `NOT_MEASURED`, never 0%.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `base-sha` | PR base SHA | Diff base |
| `head-sha` | PR head SHA | Diff head |
| `coverage-file` | empty | Optional path to a coverage report |
| `coverage-format` | `lcov` | `lcov` or `cobertura` |
| `fail-on-uncovered` | `false` | Fail only when supplied coverage produces PARTIAL changed-line status |
| `comment` | `true` | Upsert one marked PR comment |
| `upload-sarif` | `false` | Upload SARIF (requires `security-events: write`) |
| `github-token` | empty | Optional token for PR comment |
| `runtime-ref` | PR base SHA | Trusted base commit from which ORBIT is installed and built |

## Outputs

- `report-path`: Markdown report path.
- `sarif-path`: SARIF report path when coverage is supplied.
- `verification-status`: `PASS`, `PARTIAL`, `INCOMPLETE` or `NOT_MEASURED`.

## Security model and fork safety

- The Action checks out the PR base SHA into `.orbit-action-runtime` with `persist-credentials: false`, then installs/builds that trusted base code.
- The PR head is used only as diff input. The Action does not run PR package scripts, tests, build scripts or arbitrary changed code.
- The caller's checkout should use `persist-credentials: false` and `fetch-depth: 0`.
- The default permissions are read-only. Grant `pull-requests: write` only when enabling the optional comment.
- Fork pull requests normally receive a read-only token. In that case the report still runs and the comment step emits a warning rather than failing verification.
- SARIF upload is opt-in and needs `security-events: write`. Do not grant this permission unless required.
- Never use `pull_request_target` to check out and execute an untrusted PR head with secrets.
- No source files are uploaded to an ORBIT hosted service. The action does not send data to an AI provider.
- Coverage and diff files are untrusted input and are bounded by ORBIT's parser limits.
- A passing changed-line coverage result is not proof of correctness, security, or approval to merge.

## Current limitations

- The Action currently supports changed-line coverage from LCOV/Cobertura and filename-only sensitive-path checks.
- It does not yet ingest all test reports, persist FLARE history across runs, or attach per-line custom annotations.
- A coverage file must already exist in the caller workspace before the Action step. Run the test/coverage job before ORBIT.
- The Action is not a GitHub Marketplace release; version tags, marketplace metadata and broader compatibility tests remain release work.
