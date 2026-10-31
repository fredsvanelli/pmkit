---
description: List the open issues assigned to agents, with the delegation record and the state of each pull request
argument-hint: ""
disable-model-invocation: true
---

# Track agents

Arguments: `$ARGUMENTS`

## Parameters

None. The command reads every open issue (`triage`, `backlog`, `todo`, `in_progress`, `in_review`) whose assignee is an agent member (`agent:<name>`) and writes nothing.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues track-agents --json`. Show each entry of `notes` and `warnings` as the CLI printed it. The `note:` says when there is no pull request state because `git_host` is `none`.
2. Show one table with a row per issue in `issues`: ID, title, status, agent (`assignee`), delegation, branch and pull request. The delegation `state` is `current` (the newest root delegation comment names the assignee, so show who delegated it), `stale` (that comment names another agent, so show it and say the issue was handed over without a new delegation), `none` (the issue has an agent and no delegation comment) or `unknown` (the comments could not be read or were cut).
3. For the pull request, say by issue: `no_branch` (no branch is recorded, so there is nothing to look up), `no_pr` (the branch has no pull request), `unknown` (the read failed; show its `message`), or the pull request number, its `state` (`draft`, `open`, `merged` or `closed`) and, for `draft` and `open`, `blocked`. When `blocked` is `true`, list `blocking`. When it is `null`, say the blockers were not verified and list `unknown` and `unchecked`. Never read `null` as "nothing blocks it". When `pr` is `null`, the git host is `none`: show no pull request column.
4. When `incomplete` is `true`, say the list is not confirmed: an issue file that did not parse, a read that was cut (`hasMore`) or a read that failed or was not ready. After a `RATE_LIMITED` read the CLI stops calling the host, so the pull requests of the later issues are `unknown`. Name them from `warnings` and the `problems` of each row. Do not conclude that an agent is idle from an incomplete list.
5. When an agent has a `stale` or `none` delegation, point to `/pmkit:issues:delegate`. When an issue in `in_review` has a `merged` pull request, point to `/pmkit:issues:mine`, which runs `pr sync` and moves it to `done`, because `pr sync` reads only `in_review` issues. For a `merged` pull request on an issue in any other status, point to `/pmkit:issues:move <id> done`. Change nothing.

## Confirmation points

None. The command reads only and asks nothing.

## Output

The table of step 2 with every issue in full, the notes and warnings, and a line per issue that needs attention. When nothing is assigned to an agent, say so.

## If something is missing

- The CLI answers `NOT_SUPPORTED`: the tracker has no agent delegation (Linear, for now). Show `error.message` and `error.nextStep`.
- `gh` is missing or not logged in: the CLI answers `NOT_CONFIGURED` or `AUTH`. Show the next step and offer to retry after the fix.
- An error from the CLI: apply the rules for reading errors in the conventions.
