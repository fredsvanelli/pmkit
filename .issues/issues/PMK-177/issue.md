---
id: PMK-177
title: Fix the local diff notes of pr diff and issues review
type: bug
status: backlog
priority: medium
estimate: 2
related: [PMK-61]
created: 2026-10-31T16:01:11.864Z
updated: 2026-10-31T16:01:12Z
---

## Description

### Context

`pr diff` and `/pmkit:issues:review` (PMK-61) merged with these defects, found by the second review of PR #85. Source: PMK-61, PR #85.

### Scope (in)

- `scripts/lib/github/host.mjs:211`: `uncommitted` is `true` whenever the branch is checked out, even with a clean working tree, so the review warns about changes that do not exist. Untracked files stay out of the diff without a note.
- `scripts/pmkit.mjs:1054`: with a pull request and the branch checked out, uncommitted changes stay out of the diff with no `note:`. A criterion done only in the working tree is a `gap` with a PR and `covered` without one.
- `scripts/pmkit.mjs:1062`: a merged PR that GitHub refuses with 406 falls back to an empty local diff, and step 3.3 marks every criterion `gap`. The fallback base is `--base` or the default branch, not the PR base (`VIEW_FIELDS` lacks `baseRefName`), so a stacked PR diff includes the lower PR.
- `scripts/pmkit.mjs:1044`: with no open PR, `gh pr view <branch>` returns the newest merged PR, so a reused branch name is compared with an old diff, with no note.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] `uncommitted` is true only when the working tree or index has changes
- [ ] With a pull request, uncommitted changes are noted
- [ ] The local fallback uses the PR base, and a merged PR refused with 406 does not turn into an empty diff
- [ ] A merged PR of a reused branch name is not used without a note
