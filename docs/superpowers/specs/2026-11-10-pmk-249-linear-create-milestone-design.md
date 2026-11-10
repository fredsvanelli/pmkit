# PMK-249: set the milestone in `issues create` on Linear

## Why
PMK-226 let `issues update` and `issues bulk` set a Linear milestone. `issues create --milestone` still answers
`NOT_SUPPORTED` ("set the milestone in Linear") because a create has no project to check the milestone against.
A create with `--parent <epic>` already names the project (`epicNode`), so the check is possible there.

## Behavior
- `createIssue({ parent: <epic>, milestone: <id> })` resolves the milestone (`resolveMilestone`), checks that its project is the
  epic's project, and sends `projectMilestoneId` with the `issueCreate`. The dry run shows `milestone` in `after`.
- A milestone of another project is refused before any write, with the message `issues update` uses:
  `milestone <id> is not in the project of the issue` (`INVALID_INPUT`).
- A milestone with no epic parent (no parent, or an issue parent) is refused before any read or write with `INVALID_INPUT`,
  message "a milestone on a new Linear issue needs an epic parent", next step "Add --parent <epic>".
- `milestone: null` on a create stays a no-op. Creating milestones stays out (PMK-167).

## Design
- `milestoneNodeFor(milestone, issueProject)` in `issue-ops.mjs` already holds the check; `createIssue` calls it with the epic node.
- `toInput` takes `milestoneNode` in both modes and writes `projectMilestoneId`; the `LATER.milestone` refusal goes away.
- Local tracker is untouched (it already accepts `--milestone`). Capabilities, manifest and ADR counts do not change.
