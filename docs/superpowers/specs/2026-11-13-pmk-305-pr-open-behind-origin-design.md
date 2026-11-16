# PMK-305: say in `pr open` when the branch is behind origin/<default>

Short design (small change). Choices below were made without a live partner (orchestrated worker run); they are marked as calls.

## Intent
A pull request opened from a branch whose base lags the last fetched `origin/<default>` may conflict or miss fixes, and the user learns it on GitHub. `pr open` should say so cheaply, as PMK-298 did for `issues branch`.

## Goals
- `pr open`, dry run and real, adds a note (stderr, and `notes` of the JSON) when `origin/<default>` has commits the branch lacks: the count plus the next step `git fetch origin`, then `git rebase origin/<default>`.
- No note when the branch has them all, or when `origin/<default>` does not exist.
- When git cannot count, the note says it could not compare, never "up to date".

## Non-goals
Fetching, rebasing, refusing the push, a new flag.

## Approaches
1. Reuse `branchBase`/`syncNotes` as they are. They compare the local default with origin, not a branch with origin; the wrong question. Rejected.
2. New small helper `behindNotes(ctx, branch, base)` using `git rev-list --count refs/heads/<branch>..refs/remotes/origin/<base>`, local refs only, same style as `branchBase`. **Chosen.**
3. Ask GitHub for the compare. Network, needs a fetch of truth, not cheap. Rejected.

## Calls
- The already-open PR case (call): the note shows there too, on dry run and on the real push, because a push to an open PR is exactly when a stale base matters. The text of the dry run is unchanged; the note goes in `notes` (stderr in text mode), like the other notes.
- Count by `<branch>..origin/<default>`, so a branch that is ahead and a branch that diverged both get a note only when origin has commits it lacks.
- `unknown` (call): origin/<default> exists but the count fails (for example the branch ref is missing or git errors) gives a "could not compare" note with `git fetch origin` and `git log <branch>..origin/<default>`.
- No `origin/<default>`: no note (nothing to compare with), as PMK-298.
- Base name is `defaultBranch(ctx)`, the same `base` that the request uses.
