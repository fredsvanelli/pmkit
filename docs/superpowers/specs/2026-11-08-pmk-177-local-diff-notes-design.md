# PMK-177: fix the local diff notes of `pr diff` and `/pmkit:issues:review`

## Why

`pr diff` (and the review command that reads it) says things that are false or says nothing when it should:
a clean checked-out branch is reported as having uncommitted changes, a pull request diff silently leaves out the working tree, a merged PR that GitHub refuses (HTTP 406) becomes an empty local diff that marks every criterion `gap`, a stacked PR diffs against the wrong base, and a reused branch name is compared with the diff of an old merged PR.

## Goals

1. `uncommitted` is true only when the index or the tracked working tree has changes (`git status --porcelain --untracked-files=no` is non-empty).
2. With a pull request and the branch checked out, uncommitted changes are noted and exposed in the JSON. Untracked files are counted in `untracked` and noted, in both sources, because they are in no diff.
3. The local fallback of a pull request diffs against the PR base (`baseRefName`, added to `VIEW_FIELDS`). `--base` still wins. A merged PR whose diff GitHub refuses and whose local diff is empty is reported `incomplete: true` with a note, never as a plain empty diff.
4. A merged PR whose head (`headRefOid`) is not the tip of the branch is not used. The command reads the local diff and says why.

## Non-goals

- Rebuilding the diff of a rebase-merged PR from its merge commit (ceiling, follow-up).
- The improvements of `docs/superpowers/epc-6-follow-ups.md`.

## Design

`host.mjs`
- `VIEW_FIELDS` gains `baseRefName,headRefOid`.
- New `workingTree(branch)`: `null` when `branch` is not the checked-out branch, else `{ uncommitted, untracked }` from `git status --porcelain`. A failing `git status` throws (an unknown state is never "clean").
- `localDiff` uses it; `uncommitted` is `workingTree.uncommitted`. The diff command is the merge-base form only when uncommitted, otherwise the three-dot form. It also returns `untracked`.
- New `branchTip(branch)`: sha of `refs/heads/<branch>`, else `refs/remotes/origin/<branch>`, else `null`.

`pmkit.mjs` `pr diff`
- A merged PR with `headRefOid` different from a non-null `branchTip` is dropped, with a note.
- The local base is `requested ?? pr.baseRefName ?? default branch`; the default-branch notes only when the default is used.
- After choosing the source, `workingTree(branch)` adds the notes: PR source with changes -> "does not include them"; local source -> existing note; untracked -> a note in both.
- Merged PR + 406 + empty local diff -> `incomplete: true`, note. JSON gains `incomplete`, `uncommitted` (the branch has changes), `uncommittedIncluded`, `untracked`.

`commands/issues/review.md` step 3: repeat the new notes; when `incomplete` is true, mark every criterion `not checked` (not `gap`) and skip the comparison. README row for `pr diff` updated.

## Calls I made

- `uncommitted` means tracked changes only; untracked files get their own count so the flag matches the diff.
- Reused-name detection compares the PR head with the branch tip; a deleted branch (no tip) keeps using the PR.
