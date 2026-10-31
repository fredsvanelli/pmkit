---
id: PMK-188
title: Fix link-repo when the repo and the remote disagree or the host is cleared
type: bug
status: backlog
priority: medium
estimate: 1
related: [PMK-53]
created: 2026-10-31T16:59:11.059Z
updated: 2026-10-31T16:59:11Z
---

## Description

### Context

`link-repo` (PMK-53) merged with these defects, found by the second review of PR #97. Source: PMK-53, PR #97.

### Scope (in)

- `link-repo --remote my.remote --repo z/z` writes the default branch of the remote's repository for the repository `z/z`.
- `--git-host none` removes `git_host.repo` and keeps `default_branch`.
- `--git-host github` with no remote and no `--repo` writes `system: github` without `repo`, and `validate` accepts it.
- `commands/link-repo.md` `argument-hint` does not list `--default-branch`.
- `readRemotes` runs `git` in `ctx.root` without checking that it is the repository root.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] `default_branch` is only inferred from the remote whose repository is written
- [ ] `--git-host none` also clears `default_branch`
- [ ] `system: github` without `repo` is refused by `link-repo` and reported by `validate`
- [ ] The argument hint lists every flag
