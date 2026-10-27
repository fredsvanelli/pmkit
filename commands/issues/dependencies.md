---
description: Show what blocks an issue or an epic, with the blocker chain, the hierarchy and the critical path
argument-hint: "<id>"
disable-model-invocation: true
---

# Show what blocks an issue or an epic

Arguments: `$ARGUMENTS`

## Parameters

- `id` (required): an issue ID or an epic ID, for example `ISS-2X6D` or `EPC-2M9D`.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues dependencies <id> --json`. Every later step reads this result. Do not compute anything the result does not hold.
2. When `basis` is `blockers`, lead with one line: how many open issues in `nodes` have `scope` false or appear in a `blockedBy` list, and which of them have `scope` false. Then show the critical path in bold on its own line, as `ISS-5N1R → ISS-2X6D (11 points)`, from `criticalPath.ids`, `criticalPath.length` and `weight.unit`. Then show the blocker chain as an issue table with the five standard columns, plus "Blocked by" (the node's `blockedBy`) and "Critical path" (`yes` when `critical` is true, empty otherwise). The rows are the nodes of the critical path from its start, then the other open nodes that block or are blocked, in the order of `nodes`. For each ID in `criticalPath.unestimated`, say that it has no estimate and counts as 0.
3. When `basis` is `hierarchy`, say in one line that this is the hierarchy only and why, from `reason`: `none` means no blocker link touches the target, `resolved` means every blocker is done or canceled, and `absent` means the tracker has no dependencies capability. When `related` is not empty, list each pair as a related link after the hierarchy.
4. In both bases, show the hierarchy from `tree` as an indented list under the target, one issue per line with its ID, title and status. For an issue target, show `target.ancestors` as one line above it, from the top down. Fold the done and canceled issues of each level into a count. Mark in words each node that is missing, unreadable, archived, or outside the target (`scope` false).
5. Show each entry of `problems` once as a warning. For a problem with code `cycle`, offer `/pmkit:local:doctor` to fix the loop.
6. End with one next step. With the basis `blockers`, name the first open node of the critical path as the issue to unblock first, and offer `/pmkit:issues:summary <id>` to read it. With the basis `hierarchy`, offer `/pmkit:issues:link` to record blockers.

## Confirmation points

None. The command only reads, and it runs no `pr sync`.

## Output

Lead with the answer, then the critical path, the table and the hierarchy. Write every issue ID in full.

## If something is missing

- No ID: ask for it.
- An unknown ID (`NOT_FOUND`): say so and ask for a corrected ID.
- An epic with no issues: say so. The hierarchy is empty.
- A target whose scope is all done or canceled: say there is no open work under it.
- An error from the CLI: apply the rules for reading errors in the conventions.
