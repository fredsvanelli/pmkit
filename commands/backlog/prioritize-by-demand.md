---
description: Rank the open issues by demand (customer requests, or comments and mentions when there are none) and change their priorities after a full preview
argument-hint: "[find flags]"
disable-model-invocation: true
---

# Prioritize by demand

Arguments: `$ARGUMENTS`

## Parameters

- The flags of `/pmkit:issues:find` (optional): the issues to rank. Without them the candidates are `--category backlog,todo,triage`.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json` and read the `demand_signals` entry. When its `path` is `native`, the signal is customer requests. Otherwise (Linear, or a tracker with customers off) the signal is comments and mentions, and the command says so in everything it shows. Read `priorities` from `.issues/config.yaml` (the tracker priorities, highest first; ignore `none`).
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list <flags> --json`. Show each entry of `problems` as a warning: an unreadable issue is not ranked and not written. When a warning says the read was cut, say the ranking is incomplete and write nothing. When there are no candidates, say so and stop.
3. With the signal "requests", run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" demand list --json`. Keep the signals whose issue is a candidate. The score is `count` plus `important` (an important request counts twice). Ties go to more distinct customers, then the older `created`. Show each entry of `problems` as a warning and mark the ranking incomplete. When no candidate has a signal, say "no demand signals recorded" and go on with comments and mentions in step 4.
4. With comments and mentions, for each candidate (at most 30; list the rest as "not ranked"), run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --comments --json` for the number of comments, and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --text <id> --json` for the mentions: the other issues whose text names the ID. The score is comments plus mentions. A read that fails, is cut or returns `problems` makes that issue "not verified": it is shown as such, never scored as zero, never ranked and never written. State that this is a weaker signal than customer requests.
5. Rank by score, highest first. Split the ranked issues with a score above 0 into as many equal bands as there are priorities, in order, highest priority first, and never split issues with the same score across two bands. Issues with no score keep their priority. Show one table: rank, ID, title, score with its parts, current priority, proposed priority, and the signal used. Mark the issues whose proposed priority equals the current one. Ask with `AskUserQuestion` which proposals to apply: all, some, or none, and let the user edit a priority. When the user accepts none, stop and change nothing.
6. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --priority <priority> --dry-run --json` for each accepted issue. Skip the ones whose `before` equals `after`. When nothing is left, say nothing would change and stop.
7. This is a bulk change, so show the full preview: one row per issue with `priority: before → after` and the signal used, and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says. When the user declines, change nothing.
8. When the user approves, run the same commands without `--dry-run`, one at a time. When one fails, stop, list what was applied and what was not, and do not retry it.
9. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list <flags> --json` again and confirm the new priorities.

## Confirmation points

- Step 5: which proposals to apply. None stops the command.
- Step 7: the full preview of every change, always asked because it changes more than one record. Declining changes nothing.

## Output

The signal used (customer requests, or comments and mentions, said in plain words), the ranking table, the priorities changed with before and after, the issues not verified or not ranked, and the warnings. End with `/pmkit:issues:find` to check the result.

## If something is missing

- No candidate: say so and stop.
- No demand signal on any candidate, or `demand_signals` not native: use comments and mentions and say so.
- An error from the CLI: apply the rules for reading errors in the conventions.
