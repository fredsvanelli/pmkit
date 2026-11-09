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

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json` and read the `demand_signals` entry. When the call fails, apply the rules for reading errors in the conventions and stop. When its `path` is `native`, the signal is customer requests. Otherwise (Linear, or a tracker with customers off) the signal is comments and mentions, and the command says so in everything it shows. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` and read `priorities` (the tracker priorities, highest first; ignore `none`).
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list <flags> --json`. Show each entry of `problems` as a warning: an unreadable issue is not ranked and not written. When `hasMore` is true, the candidates are incomplete: show the ranking but write nothing, and say why. When there are no candidates, say so and stop. Keep each candidate's `created` and `updated`.
3. With the signal "requests", run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" demand list --json`. Keep the signals whose issue is a candidate. The score is `count` plus `important` (an important request counts twice). Ties go to more distinct customers (the `customers` and the `from` of the signal together), then the older `created` from step 2. Show each entry of `problems` as a warning. Each problem has an `about`. A problem with `about: "customer"` (a customer with no readable file) or `about: "issue"` whose `id` is not a candidate (a request on a deleted or unreadable issue) concerns no candidate: it is only a warning, and the ranking stays complete. Any other problem (`about: "request"`, a request file that did not parse and may belong to a candidate, or an `about: "issue"` problem whose `id` is a candidate) makes the ranking incomplete: show the ranking as incomplete, write nothing, and suggest `pmkit validate`. When no candidate has a signal, say "no demand signals recorded" and go on with comments and mentions in step 4.
4. With comments and mentions, take the 30 candidates most recently updated and list the rest as "not ranked". For each of them run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --text <id> --json`. `--text` is a substring match over title and description, so it only narrows: the mentions of the candidate are the hits, other than the candidate itself, whose title or description names its ID as a whole token. The ID is not directly preceded by a letter or a digit nor followed by a letter, a digit or an underscore, so `PMK-4` is not found in `PMK-40`; a URL, the target of a markdown link and a file path are not mentions (the rule of `issues delete`). The match is case sensitive, because the IDs are uppercase. When that read has `hasMore` true, the mentions of that candidate are incomplete: it is "not verified". On Linear only the issues of the configured team count, and the output says so. Show the `problems` of these reads once as warnings; they do not make a candidate unverified. For the comments run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --comments --json` for each. A comment counts only when it is not pmkit's own: skip every comment whose `author` is the assignee of the issue (the plan, progress and summary comments of `/pmkit:issues:work` are posted by the assignee), every comment whose `author` is an agent (`agent:...`) and every comment whose first line starts with `Delegated to agent:`. Count the comments skipped, and say in the output how many were ignored as pmkit's own, in total and per candidate that had any. When either call fails or is cut, that candidate is "not verified": shown as such, never scored as zero, never ranked and never written. The score is comments plus mentions. State that this is a weaker signal than customer requests.
5. Rank every verified candidate by score, highest first, with the score-0 issues last and outside the bands. Split only the issues with a score above 0 into as many equal bands as there are priorities that can be proposed, in order, highest priority first, so an issue with no demand never takes a band from an issue with demand. With customer requests that is every priority, and an issue with no demand is capped (below). With comments and mentions the signal is weak, so the first priority is never proposed and the top band gets the second one (with one priority, use it), and a proposal never lowers an issue: when its current priority is already as high as the proposed one, leave it unchanged. Issues with the same score are never split across two bands, and that rule wins over equal band sizes. Issues with a score of 0 keep their priority, with one exception. With customer requests an issue with no demand must never rank above an issue with demand: let the floor be the lowest priority proposed to an issue with demand. A score-0 issue whose current priority is higher than the floor is proposed the floor, and one whose priority is the floor, lower than it or empty keeps it. Mark each capped issue "no demand, capped" in the table and in the step 7 preview, with the floor. With comments and mentions the signal is weak, so score-0 issues are never lowered. When no candidate has a score above 0, propose nothing, say so and stop. Show one table: rank, ID, title, score with its parts, current priority, proposed priority, and the signal used. Mark the issues whose proposed priority equals the current one. Ask with `AskUserQuestion` which proposals to apply: all, some, or none, and let the user edit a priority. When any read above was incomplete, ask nothing, change nothing and say so. When the user accepts none, stop and change nothing.
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
- A read that is incomplete (`hasMore` on the candidates, a `demand list` problem of a request file that did not parse or of a candidate): the ranking is shown, nothing is written. A `demand list` problem of a customer, or of an issue that is no candidate, is a warning only. A `hasMore` on the mentions read of one candidate leaves only that candidate not verified.
- An error from the CLI: apply the rules for reading errors in the conventions.
