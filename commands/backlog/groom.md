---
description: Find what is wrong with the backlog and fix what you accept
argument-hint: ""
disable-model-invocation: true
---

# Groom the backlog

Arguments: `$ARGUMENTS`

## Parameters

None. The staleness threshold is `defaults.stale_days` in `.issues/config.yaml` (60 when it is missing).

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Read `defaults.stale_days` from `.issues/config.yaml`. Compute the cutoff date, today minus that many days.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --category backlog,todo,triage --json`. The result has the issues and a `problems` list. Show each problem as a warning, because an unreadable issue is not in the scan.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" events --since <cutoff> --json`. An issue is stale when its `updated` date is before the cutoff and no event since the cutoff names it.
4. Find the problems in the `--json` output yourself. The CLI has no command for this.
   - No estimate: the `estimate` field is empty.
   - No acceptance criteria: `acceptanceCriteria` is empty.
   - No parent: no `parent` field.
   - Stale: see step 3.
   - Likely duplicates: pairs with similar titles and descriptions. Say it is a guess.
   - Broken references: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json` and list the problems whose message names a parent, blocker, sprint or milestone.
5. Group the findings by problem and propose a fix for each, with the counts. The fixes are an estimate from the scale, a drafted list of criteria, an epic as parent, close as stale, and mark as duplicate. Never invent an estimate or a parent without saying it is a proposal.
6. Ask with `AskUserQuestion` which fixes to apply: all of them, one group, or one by one. Let the user edit the proposals. When the user accepts none, stop and change nothing.
7. Run the dry run of every accepted fix, so the preview matches what is written.
   - Estimate or criteria: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --estimate <n> --dry-run --json`, or `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --criteria-file <file> --dry-run --json`, with the file written outside `.issues/`.
   - Parent: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues parent <id> <epic id> --dry-run --json`.
   - Stale: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> canceled --dry-run --json`.
   - Duplicate: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <duplicate id> <kept id> --kind duplicate --dry-run --json`, then `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <duplicate id> canceled --dry-run --json`.
   - Skip a fix whose `before` equals `after`, and say nothing would change.
8. This is a bulk change, so show the full preview of all accepted fixes, with before and after per issue, and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says. When the user declines, change nothing.
9. When the user approves, run the same commands without `--dry-run`. When one fails, stop, list what was applied and what was not, and do not retry it.
10. Run steps 2 to 4 again and compare the counts.
11. Remove the temporary files.

## Confirmation points

- Step 6: which fixes to apply.
- Step 8: the full preview of all accepted fixes, always asked because it changes more than one record. Declining changes nothing.

## Output

A table with the count of each problem before and after, then the list of applied fixes by issue ID and the problems left. State that the duplicate guess comes from the titles and descriptions.

## If something is missing

- An empty backlog: say there is nothing to groom.
- `.issues/config.yaml` has no `stale_days`: use 60 and say so.
- No estimate scale value fits: leave the estimate and say so.
- An error from the CLI: apply the rules for reading errors in the conventions.
