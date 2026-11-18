---
id: PMK-336
title: Split the complex functions in the GitHub adapter and setup code
type: chore
status: backlog
priority: low
created: 2026-11-16T19:46:40.891Z
updated: 2026-11-17T21:22:17Z
---

## Description

Found by `utils:review-work` on PMK-86 (PR #310), PMK-87 (PR #311) and PMK-89 (PR #312). These functions have a cyclomatic complexity above 10:

- `runInitGithub`, `hostedInitFile` and `deleteText` in `scripts/pmkit.mjs`
- `fieldValue` in `scripts/lib/github/mappings.mjs`
- `runSteps`, `updateIssue`, `assign` and `searchIssues` in `scripts/lib/github/issue-ops.mjs`
- `link` in `scripts/lib/github/relation-ops.mjs`
- `derivedNote` in `scripts/lib/path-notes.mjs`
- `proposeGithubSetup` (split its status loop into a helper)
- `planLabels` in `scripts/lib/github/writes.mjs` (split out the type-label swap)

## Acceptance criteria

- [ ] Each listed function has a cyclomatic complexity of 10 or less, with no change in behavior
