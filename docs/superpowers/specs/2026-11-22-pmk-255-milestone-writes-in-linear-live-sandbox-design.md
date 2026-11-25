# PMK-255: let milestone writes through the Linear live sandbox

## Problem

PMK-226 and PMK-249 write a Linear issue's milestone as `projectMilestoneId` on `issueCreate` and `issueUpdate` (`scripts/lib/linear/writes.mjs`). The sandbox write guard (`scripts/lib/linear/sandbox.mjs`) refuses any input key off `ISSUE_KEYS`, and `projectMilestoneId` is not on it, so a live run refuses every milestone write. The live run also has no milestone to point at: the Linear adapter reads milestones but does not create them (`createMilestone` is `NOT_SUPPORTED`).

## Approaches

1. **`projectMilestoneId` on `ISSUE_KEYS`, checked as a milestone the run owns; a guarded `projectMilestoneCreate` on a project the run owns, so the run makes its own milestone; a live probe that sends the three milestone writes** (chosen). Same shape as every guard rule: an input key list, and each id checked by ownership.
2. Let `projectMilestoneId` through unchecked. A foreign milestone would move a run issue into another team's project, so the guard would no longer pin writes to the run.
3. Own the milestones of the run's projects by reading them. Needs a read per check, and the run would still have no way to make a milestone.

## Design

- `scripts/lib/linear/sandbox.mjs`:
  - `ISSUE_KEYS` gains `projectMilestoneId`; `rules.issueInput` refuses one that is not `null` and not a milestone the run owns (`projectMilestoneId is not one the run owns`).
  - `SUITE_INPUT_KEYS.projectMilestoneCreate = ['id', 'projectId', 'name']`; `SUITE_RULES.projectMilestoneCreate` takes only a project the run owns. `CREATES` maps it to `['milestone', 'projectMilestone']`, so the new id becomes the run's own. The allowlist grows from 16 to 17.
  - `MILESTONE_CREATE` (`PmkitSandboxMilestoneCreate`) is exported next to `TEAM_CREATE`. Trashing the run's project removes its milestones with it, so cleanup does not change.
- `scripts/lib/linear/live-probes.mjs`: a `milestone writes` probe. It creates an epic (`createDeliverable`), a milestone in it through `MILESTONE_CREATE`, an issue with `createIssue({ parent: epic, milestone })` (what `issues create --parent <epic> --milestone` sends), sets it on a second issue with `updateIssue` (`issues update --milestone`) and on a third through the bulk builder `parseChange('milestone', id).apply` (`issues bulk milestone`), then clears it on one. It asserts each issue reads back with the milestone. Probes create at most 7 issues in all.
- Tests over the fake (`scripts/lib/linear/sandbox.test.mjs`): the guard passes `issueUpdate` and `issueCreate` with an owned milestone and with `null`; refuses a foreign one by the ownership reason (the existing foreign-key test now names that reason); `projectMilestoneCreate` passes on an owned project and is refused on a foreign one; the probe runs through the guard over the fake. The test that lists `ISSUE_KEYS` fails if `projectMilestoneId` leaves it.
- `scripts/lib/linear/API-VERIFICATION.md`: the allowlist paragraph names `projectMilestoneCreate`, and the live run of the probe is recorded (pass or fail, no workspace name).
- CHANGELOG.

## Live run

The key is loaded at run time from the file the owner named and never printed, logged or committed. `PMKIT_LIVE_WORKSPACE` is read at run time from `viewer.organization` and kept in the scratchpad only. The run writes through the guard to the `pmkit-test` team only, and the last sweep leaves it empty.

## Interview

- Does `issues create` without `--milestone` change? No: `writes.mjs` sends no `projectMilestoneId` on a create without one.
- A milestone of a project the run did not create: refused, as any foreign id.
- The update and bulk writes need the issue in the milestone's project (the caller checks it, `writes.mjs` line 16), so the probe creates all three issues under the run's epic.
- Does Linear's `ProjectMilestoneCreateInput` take `id`? `CREATES` owns the id from the answer, so the run works either way; if the live run refuses `id`, the probe drops it and the design notes it.
- `null` (clearing the milestone): passes; it points at nothing.
- Other missing sandbox fields: out of scope; none turned up in the three milestone writes.
- New terms or ADRs: none. Milestone is in `CONTEXT.md`; a guard rule is easy to reverse.
- Approval: no product question; the acceptance criteria are the approval. pmkit PO approves.
