---
description: Read the Jira Premium Plans of the site, with their scheduling settings, cross-project releases and the capacity of each team
argument-hint: "[plan id or name]"
disable-model-invocation: true
---

# Jira plans and scenarios

Arguments: `$ARGUMENTS`

## Parameters

- A plan id or name (optional): the plan to open. Without it, the command lists the plans and asks which one when there is more than one.
- `--archived`, `--trashed` and `--limit <n>` (optional): passed to the plan list to include archived or trashed plans or to raise the page size.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. When `tracker` is not `jira`, say that this command works only with the Jira tracker and stop.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" jira plans list --json`, with `--archived`, `--trashed` or `--limit <n>` when the user asked for them. When `available` is false, print `reason` and `enableHint`, say that the plans capability is absent on this site, and stop. Jira does not say whether the cause is a missing Premium plan or a missing Administer Jira permission, so name both.
3. Show the plans as a table with the id, name, status, default scenario and sources. Show each warning. When `hasMore` is true, say that the list was cut and offer to run it again with a larger `--limit`. When the user named a plan, use it. When there is more than one plan and none was named, ask which one with `AskUserQuestion`. When there is one plan, use it.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" jira plans get <id> --json`. Show the plan's lead, last saved date and sources, then the scheduling settings (dependencies, estimation, inferred dates, start and end date), then the default scenario. Say that the other scenarios are not readable through Jira's public API. Then show the cross-project releases with their version ids, and for each team its name, planning style, sprint length and capacity with the capacity unit. Show each warning.
5. Say that the dependency setting governs how linked work is scheduled in the plan. When the links between issues matter, offer `/pmkit:issues:dependencies` to see or change them. Change nothing here.

## Confirmation points

- Step 3: which plan to open, only when there is more than one and the user did not name one.

The command only reads. It writes nothing to Jira.

## Output

The plans of the site, then for the chosen plan: the scheduling settings, the default scenario, the cross-project releases, and each team's planning style, sprint length and capacity. The warnings are shown as they are.

## If something is missing

- A tracker that is not Jira: stop at step 1.
- No `JIRA_EMAIL` or `JIRA_API_TOKEN`: the CLI fails with `AUTH`. Apply the rules for reading errors in the conventions.
- No Jira Premium, or no Administer Jira permission: step 2 stops with the `enableHint`. Jira does not say which of the two is missing.
- A plan id that does not exist: the CLI fails with `NOT_FOUND`. Show the plan list again and ask for another id.
- `hasMore` is true: say that the list was cut and offer `--limit`.
- An error from the CLI: apply the rules for reading errors in the conventions.
