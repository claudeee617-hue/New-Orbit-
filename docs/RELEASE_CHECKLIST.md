# ORBIT Release Checklist

This checklist is a gate, not a declaration that a release is ready.

## Product and engineering

- [ ] Prompts 11–16 are complete and their PRs are merged after required checks.
- [ ] Full Ubuntu, macOS and Windows CI matrix passes on the release commit.
- [ ] Command Center screens and all visible controls are implemented and browser-tested.
- [ ] GitHub Action is tested on same-repository and fork pull requests.
- [ ] MCP tools are read-only, bounded and tested with at least two clients.
- [ ] Optional AI remains disabled by default and passes the data-flow/privacy acceptance suite.
- [ ] Security review has no unresolved critical/high findings.
- [ ] Dependency audit and CodeQL findings are reviewed.
- [ ] Migrations are tested from the previous supported schema.
- [ ] Demo data is persistently labelled DEMO and never mixed with real evidence.

## Documentation and governance

- [ ] README quick start is verified on a clean machine.
- [ ] CLI, local API, MCP, GitHub Action, embedded telemetry and troubleshooting guides are current.
- [ ] SECURITY.md, privacy/data handling, contributing and code-of-conduct docs are reviewed.
- [ ] Apache-2.0 licensing and third-party notices are checked by the repository owner.
- [ ] Changelog includes breaking changes and known limitations.
- [ ] Version and package metadata are consistent.
- [ ] Release artifacts are reproducible and checksums are published.

## Legal and brand

- [ ] Check GitHub repository name, npm package names, domains and trademarks for ORBIT and related names.
- [ ] Verify all dependencies and copied fixtures have compatible licenses.
- [ ] Do not claim uniqueness, security certification, correctness guarantees or measured performance without evidence.
- [ ] Review jurisdiction-specific privacy and legal obligations before collecting user data or publishing hosted services.

## Publishing

- [ ] Release owner explicitly approves publication.
- [ ] Create signed/tagged version from the validated commit.
- [ ] Publish packages only after a dry run and provenance review.
- [ ] Publish release notes and support policy.
- [ ] Verify install and rollback instructions after publication.

No package, website or Marketplace listing should be published automatically by CI.
