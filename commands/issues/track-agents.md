---
description: List the open issues assigned to agents, with the delegation record and the state of each pull request
argument-hint: "[--agent <name>]"
disable-model-invocation: true
---

# Track agents

Arguments: `$ARGUMENTS`

## Parameters

- `--agent <name>` (optional): `agent:<name>` or the bare name, in any case. Only that agent is listed: on Local, its issues; on Linear, the pull requests whose author is that bot. An empty value is `INVALID_INPUT`. The name is not checked against the members, so a typo gives an empty list.

Without it the command reads every open issue (`triage`, `backlog`, `todo`, `in_progress`, `in_review`) whose assignee is an agent member (`agent:<name>`) and writes nothing. On a tracker that delegates natively (Linear) there is no such assignee, so it reads the open pull requests whose author is a bot instead (`source` is `pull_requests`; on Local it is `issues`).

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues track-agents --json`, with `--agent <name>` when the user named an agent. Show each entry of `notes` and `warnings` as the CLI printed it. The `note:` says when there is no pull request state because `git_host` is `none`.
2. Show one table with a row per issue in `issues`: ID, title, status, agent (`assignee`), delegation, branch and pull request. The delegation `state` is `current` (the newest root delegation comment names the assignee, so show who delegated it), `stale` (that comment names another agent, so show it and say the issue was handed over without a new delegation), `none` (the issue has an agent and no delegation comment) or `unknown` (the comments could not be read or were cut).
3. For the pull request, say by issue: `no_branch` (no branch is recorded, so there is nothing to look up), `no_pr` (the branch has no pull request), `unknown` (the read failed; show its `message`), or the pull request number, its `state` (`draft`, `open`, `merged` or `closed`) and, for `draft` and `open`, `blocked`. When `blocked` is `true`, list `blocking`. When it is `null`, say the blockers were not verified and list `unknown` and `unchecked`. When it is `true`, `unknown` and `unchecked` can still hold blockers that were not verified, so list them too. Never read `null` as "nothing blocks it". When `pr` is `null`, the git host is `none`: show no pull request column.
4. When `incomplete` is `true`, say the list is not confirmed: an issue file that did not parse, a comment file that did not parse (its issue has delegation `unknown`), a read that was cut (`hasMore`) or a read that failed or was not ready. The warning names the causes that happened, so quote it as it is. When `issues` is empty and `incomplete` is `true`, say no agent issue was found but the list is not confirmed, never that nothing is assigned. After a `RATE_LIMITED` read the CLI stops calling the host, so the pull requests of the later issues are `unknown`. Name them from `warnings` and the `problems` of each row. Do not conclude that an agent is idle from an incomplete list.
5. When an agent has a `stale` or `none` delegation, point to `/pmkit:issues:delegate`. When an issue in `in_review` has a `merged` pull request, point to `/pmkit:issues:mine`, which runs `pr sync` and moves it to `done`, because `pr sync` reads only `in_review` issues. For a `merged` pull request on an issue in any other status, point to `/pmkit:issues:move <id> done`. Change nothing.

On `source: pull_requests` (Linear) each entry of `issues` is a pull request, not an issue. Show `pr.number`, `author`, `agent`, the issue (`id`, or the `issueMatch`: `none` means no issue has this branch, `unknown` means the issue read was cut or had a file that did not parse, so the match is not verified), `delegate` and `delegation` (`null` when there is no issue), `branch` and the pull request state as in step 3. The `notes` say the list holds only pull requests with a bot author, so say that an agent whose pull request is by a person is not listed. A full page of 200 pull requests is incomplete (see `warnings`). With `--agent` and an empty list, say no agent pull request was found for that name, never that the agent is idle.

## Confirmation points

None. The command reads only and asks nothing.

## Output

The table of step 2 with every issue in full, the notes and warnings, and a line per issue that needs attention. When nothing is assigned to an agent, say so.

## If something is missing

- The CLI answers `NOT_SUPPORTED`: the tracker has no agent delegation (Linear without an installed agent), or Linear delegates natively and `git_host` is `none`, so there is no pull request to find. Show `error.message` and `error.nextStep`.
- `gh` is missing or not logged in: the CLI answers `NOT_CONFIGURED` or `AUTH`. Show the next step and offer to retry after the fix.
- An error from the CLI: apply the rules for reading errors in the conventions.
