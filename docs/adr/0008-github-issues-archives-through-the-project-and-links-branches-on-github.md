# GitHub Issues archives through the Project and links branches on GitHub

PMK-87 gives the GitHub Issues adapter the issue operations of the tracker contract. Two of them have no direct counterpart on GitHub. An issue has no archived state, and pmkit's `issues branch` records a branch name on the issue, while GitHub keeps no branch field. The user settled both on 2026-11-16 as decisions 2 and 6 of `docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md`, and the coordinator corrected decision 6 the same day.

Archive goes through the Project. `archive` sends `archiveProjectV2Item` for the issue's item in the Project that `tracker.scope.project` names, and leaves the issue open or closed as it was. An issue reads `archived: true` when that item is archived, and search leaves it out unless the filter has `archived: true`. An issue with no item fails with `INVALID_INPUT`, with the next step `pmkit issues move <id> <category> adds it`. With `tracker.scope.project: none`, `archive` answers `NOT_SUPPORTED`. `unarchive` answers `NOT_SUPPORTED` with the next step `Restore the item from the archived items of the Project on GitHub`, as Linear answers it (PMK-250). `delete` runs `deleteIssue`, and since GitHub has no trash, `restore` answers `NOT_SUPPORTED`.

The issue's branch is a linked branch. `updateIssue(id, { branch }, actor, { base })` reads the head commit on GitHub of the base branch (`repository.ref(qualifiedName: "refs/heads/<base>")`) and sends `createLinkedBranch` at that commit. GitHub then lists the branch in the issue's Development section, and `issue.branch` reads the first linked branch. The branch exists on GitHub before the first push. The base is the branch `issues branch` starts from, without `origin/`: pmkit's default branch (`git_host.default_branch`, else `origin/HEAD`) or the `--from` ref. GitHub's own default branch (`defaultBranchRef`) is never the base. A repository whose GitHub default is `main` while pmkit works from `develop` would otherwise get a branch linked at `main`, and GitHub would refuse the first push of a branch started from `develop` as non-fast-forward. When `--from` names a branch GitHub does not have, the adapter links at the head of pmkit's default branch there and says so in a note. When GitHub lacks that branch too, the write fails with `INVALID_INPUT`, `GitHub has no branch <default> to start <branch> from`.

A linked branch can still start at a commit the local branch lacks, because GitHub creates it at the head of the base there and the local base may be behind `origin/<base>`. `issues branch` checks this with local refs only (`git merge-base --is-ancestor origin/<base> <from>`). When the check fails, the result carries a note that the push of `pr open` would be refused and names the fix. The dry run says to pass `--from origin/<base>`, and the real run says to run `git fetch origin`, then `git rebase --onto origin/<base> <from> <branch>`.

## Status

Accepted

## Considered options

Archive:

- A. Archive the issue's item in the Project. Chosen. It is the only archive GitHub has for an issue, it keeps the issue's state, and the Project hides archived items the way pmkit lists hide archived issues.
- B. Close the issue as not planned and lock it. Rejected. A closed issue reads as `canceled`, so archiving a done issue would change its category and its flow metrics, and an unarchive could not tell which state to restore.
- C. Answer `NOT_SUPPORTED` for `archive`. Rejected. Teams that use a Project would lose a command they have on the Local and Linear trackers.

Branch:

- A. Create a linked branch on GitHub with `createLinkedBranch`. Chosen. GitHub then shows the branch on the issue, as `gh issue develop` does, and `issue.branch` reads it back from the tracker.
- B. Read the branch from linked branches and pull requests only, with `branchName` as the fallback name, and write nothing. Rejected. `issues branch` would record nothing on GitHub, and an issue would show no branch until a pull request named it.
- C. Answer `NOT_SUPPORTED` for the branch field. Rejected. `issues branch` would lose the record of the branch that `issues get` and the pull request flow read.

## Consequences

- `archive` needs a Project. With `tracker.scope.project: none` it answers `NOT_SUPPORTED`, with the next step `Set tracker.scope.project with /pmkit:setup`.
- `unarchive` and `restore` answer `NOT_SUPPORTED` on GitHub. A user restores an archived item from the Project's archived items on GitHub.
- `issues branch` on GitHub creates the branch on origin before any push, so the branch exists on GitHub even when nobody pushes to it.
- `issues branch` passes the base it starts from to the adapter, and the adapter never reads `defaultBranchRef` for a link.
- A local base behind `origin/<base>` gives a note on the dry run and on the real run. `scripts/cli-issues-github.test.mjs` and `scripts/runbook-issues-github.test.mjs` cover it.
- When the issue already has another linked branch, `updateIssue` fails with `INVALID_INPUT`, `GitHub links <id> to branch <name> already`. With `settings().trackerBranch: true`, `issues branch` reuses that name, so only a name picked by hand meets this.
