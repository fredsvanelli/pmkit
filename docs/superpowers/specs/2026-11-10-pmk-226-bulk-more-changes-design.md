# PMK-226: more changes for issues bulk

## Intent

`issues bulk` (PMK-56) applies one change to every issue a filter returns. This adds the changes the PMK-56 reviewers asked for: `due`, `type` and `archive`, and the Linear `milestone`. Source: `docs/superpowers/epc-6-follow-ups.md`.

## Decisions

Orchestrator answer (PERGUNTA PMK-226-1, option A): Linear `release` stays `NOT_SUPPORTED`. The Linear adapter maps releases nowhere (`listReleases` returns `[]`, `createRelease` and `--release` are `NOT_SUPPORTED`), and a write cannot be validated without a sandbox. Acceptance criterion 2 stays unchecked, and the issue comment and the PR body say the release half needs a Linear releases mapping (follow-up).

Builder's calls (no user to ask):

- `due <YYYY-MM-DD|none>`: `updateIssue({ due })` on both trackers; `none` clears it. A bad date is `INVALID_INPUT` for every issue, so it fails once.
- `type <type|none>`: `updateIssue({ type })`. The Local tracker requires a type, so `none` is `INVALID_INPUT` there; Linear clears the type label. An unknown type is `INVALID_INPUT` (Linear: no label in `mappings.types`).
- `archive`: takes no value (`issues bulk archive --label legacy`); a value is `INVALID_INPUT`. Calls `tracker.archive`, the call `issues archive` makes. The preview shows `archived: false → true` and warns that archived issues leave every list and are never matched by a bulk change again.
- Linear `milestone <id|none>`: `updateIssue({ milestone })` resolves the id with `getMilestone` (a UUID of a project milestone) and sends `projectMilestoneId`. The issue must be in the project of the milestone; otherwise `INVALID_INPUT` naming both, before any write, in the dry run too. `none` sends `projectMilestoneId: null`. The change sits in `updateIssue`, so `issues update --milestone` works on Linear as well; `issues create --milestone` stays `NOT_SUPPORTED` (a new issue has no project to check against). An unknown milestone is `NOT_FOUND` (from `getMilestone`); one issue in the batch keeps that code, several are one `INVALID_INPUT`, as `valueError` does today.
- Linear `release`: still `NOT_SUPPORTED`, with a message that says releases are not mapped; tested.
- No new capability, no new command file, no new write path. `SERVED_BY` and the manifest are unchanged (`issues bulk` is not a capability).

## Non-goals

Linear release writes, milestone writes on `create`, an unarchive change, several changes in one call.

## Acceptance

1. `due`, `type`, `archive` work in `issues bulk` with the same preview, digest and midway-stop behavior, on Local and Linear.
2. Linear `milestone` works; Linear `release` is refused with a tested message (criterion left unchecked).
