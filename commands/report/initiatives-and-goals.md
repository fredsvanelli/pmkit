---
description: Progress of each strategic goal through the progress of its epics; without goals, the top-level issues and the progress of their sub-issues
argument-hint: ""
disable-model-invocation: true
---

# Initiatives and goals

Arguments: `$ARGUMENTS`

## Parameters

None.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" goals overview --json`. It reads the tracker and writes nothing. Show each entry of `notes` as a `note:` line and each entry of `warnings`, as the CLI wrote them.
2. Say which source the numbers come from, from `source`. `goals` means the tracker's strategic goals. `top_level` means the tracker has no goals (or does not support them, as a Linear workspace without initiatives, below the Business plan) and the command used the top-level issues instead: say so in one line, with the reason from `notes`, and that a top-level issue is one with no parent or whose parent is an epic.
3. Show one table. For `goals`: goal, progress, done of total issues, points done of points, and its epics (ID, title, status and done of total; an epic with `counted: false` is canceled, so mark it `canceled, not counted`: its issues are in none of the goal's numbers). For `top_level`: issue, progress, done of total, points done of points. Progress is done issues over counted issues, and canceled issues are not counted. A `progress` of `null` shows `not known`, which is not 0%: the goal has no epic, or its epics hold no counted issue (every epic canceled included). Points count only issues with an estimate, so say so when the points are partial. When `withoutChildren` is above 0, say that many top-level issues have no sub-issues and are not listed.
4. When `complete` is `false`, some files or issues were not read: say the progress is not verified, name what `warnings` lists, and draw no conclusion such as "on track" or "behind" from it. Say that `/pmkit:local:doctor` checks the files. Issues under an archived parent or under a parent file that did not parse are named in the warning and are not in the table.
5. Do not judge or forecast. Report the numbers and a goal's target date when it has one.

## Confirmation points

None. The command writes nothing.

## Output

The source line, the table, the notes and, when `complete` is `false`, the incomplete warning.

## If something is missing

- No goals and no top-level issue with sub-issues: say so, and suggest `/pmkit:issues:breakdown` to split an issue, or, on the Local tracker, `goal create` and `epic goal` to add goals (on Linear, add an initiative in Linear).
- A goal with no epics: `not known`, and say it needs an epic (`pmkit epic goal <epic> <goal>`) only when `complete` is `true`. When `complete` is `false`, say the epic may be in a file that was not read, and do not ask for one.
- An error from the CLI: apply the rules for reading errors in the conventions.
