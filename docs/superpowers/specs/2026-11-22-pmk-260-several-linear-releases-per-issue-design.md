# PMK-260: show and set several Linear releases per issue

## Problem

A Linear issue can be in one release per release pipeline. PMK-246 chose one release per issue (decision PMK-246-1, option A): an issue in two or more has `releases` in the JSON only, its text shows no release line, and `issues update --release` and `issues bulk release` refuse it.

## Approaches

1. **Option B of PMK-246-1** (chosen, as the issue asks): `--release <id>` replaces only the release of that id's pipeline, `--release none` clears all, and the text shows every release. The pipeline of each current release is read only for a release write, with a one-issue query, so the list reads (PMK-262's budget) do not grow.
2. Add `pipeline { id }` to every issue's release read. About 1.1 more points per release in every list: the batch read would grow from about 4,650 to about 6,850 points for a field only a release write uses.

## Design

- `scripts/lib/linear/documents.mjs`: `ISSUE_RELEASE_PIPELINES_QUERY` (`issue(id) { releases(first, after) { nodes { id stage { type } pipeline { id } } } }`).
- `scripts/lib/linear/issue-ops.mjs` `releaseNodeFor`: the "one release per issue" refusal goes. For a target release on an issue that has any release, the issue's releases are read again with their pipelines (`allReleases`, every page) onto `beforeNode.releases`.
- `scripts/lib/linear/writes.mjs` `releaseInput`: `none` removes every active release; `<id>` adds it when absent and removes each other active release of the same pipeline (`node.pipeline.id === target.pipeline.id`). A current release whose pipeline is unknown is treated as the same pipeline, as before.
- `scripts/lib/format.mjs` `issueRecord`: the `release` line shows `releases` joined with `, ` when the issue has two or more. Lists have no release column, for any issue, so they do not change.
- `issues bulk release` runs the same `updateIssue`, so it follows the same rule and preview.
- CHANGELOG; `API-VERIFICATION.md` (PMK-246 section) notes that decision PMK-246-1 is now option B.

Tests (`scripts/lib/linear/tracker.test.mjs`, fake with two pipelines; `scripts/cli-bulk-linear.test.mjs`): `issues get` text of an issue in two releases shows both; `--release none` clears both; `--release <id of pipeline A>` on an issue in releases of A and B changes only A's; the bulk change follows the same rule. The existing "one release per issue" refusal tests are replaced.

## Interview

- An issue in one release of pipeline A, set to a release of pipeline B: it is now in both (option B), where it moved before. That is the option the issue asks for.
- Live check: the sandbox workspace has releases off (Free plan), so it is skipped (coordinator decision for EPC-5).
- New terms or ADRs: none; decision PMK-246-1 is recorded in its spec and the verification notes.
- Approval: the issue names option B; pmkit PO approves.
