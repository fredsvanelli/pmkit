# Plan PMK-308

1. TDD: add tests in scripts/cli-pr.test.mjs (behind 2 commits dry+real; 1 commit; level and no origin/main; could not compare; PR base other than default; follow the next step and push passes). Update the existing `pr ready` test to the detail view key.
2. `pr ready` in scripts/pmkit.mjs: read the PR with `{ detail: true }`, `base = pr.detail?.baseRefName ?? defaultBranch(ctx)`, `behind = behindNotes(ctx, issue.branch, base, true)`, add to `data.notes` (when non-empty) and `notes`.
3. README, work.md (sub-step 4 of step 9 and `unblock.md` mention), CHANGELOG line.
4. Tick criteria, npm test, PR.
