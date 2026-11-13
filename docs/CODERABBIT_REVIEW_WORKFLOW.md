# AI-assisted code review with CodeRabbit

ORBIT uses CodeRabbit as an advisory pull-request reviewer. Human review and deterministic CI remain authoritative.

## What CodeRabbit reviews

- Correctness, regressions, error handling and TypeScript runtime boundaries
- Security: injection, path traversal, SSRF, secrets, unsafe process/filesystem access and GitHub Actions permissions
- Evidence integrity: provenance, hashes, coverage and test/build result interpretation
- MCP/API/CLI contracts, read-only guarantees and safe defaults
- Test quality, edge cases, determinism and cross-platform behavior

The repository policy lives in `.coderabbit.yaml`. Automatic review is enabled for non-draft pull requests, including incremental review after pushes.

### Automatic-review title exclusions

Automatic review is skipped when a pull-request title contains any configured exclusion keyword: `WIP`, `DO NOT MERGE`, or `NO REVIEW`. These exclusions are intentional safeguards for work that is not ready for automated review; they can also prevent an incremental automatic review after a push. Before expecting automatic review, remove the matching keyword from the PR title. To request a review without changing the title, use a manual PR command such as `@coderabbitai review` or `@coderabbitai full review`.


## Pull-request workflow

1. Open a pull request against `main`; keep it non-draft when ready for review.
2. Read CodeRabbit's walkthrough and inline findings. Treat each finding as a hypothesis to verify against the code and tests.
3. Ask follow-up questions in the PR with `@coderabbitai` (for example, ask it to explain a finding or inspect a proposed fix).
4. Push fixes; incremental review should revisit the updated changes.
5. Run the repository's deterministic checks: `pnpm run check`. Do not mark external ACCELQ runs, device measurements, or other evidence as successful unless the provider result is actually available and verified.
6. Resolve or explicitly discuss every actionable finding before merge. Human reviewers own the final decision.

## Useful PR commands

- `@coderabbitai review` — review changes since the last review; it does not rerun previously reviewed changes.
- `@coderabbitai full review` — rerun a complete review, including changes that were already reviewed.
- `@coderabbitai summary` — request a concise change summary.
- `@coderabbitai configuration` — inspect the effective CodeRabbit configuration when the app is active.

## Safety and limitations

CodeRabbit comments are recommendations, not proof that a change is correct or secure. Never paste secrets, access tokens, private customer data or credentials into PR comments. Do not accept an automated suggestion without understanding its behavior and running the relevant tests. CI, CodeQL, dependency checks, and human review remain separate safeguards.
