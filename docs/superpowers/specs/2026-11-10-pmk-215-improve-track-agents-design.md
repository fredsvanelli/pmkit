# PMK-215: track-agents on Linear, and an `--agent` filter

Source: PMK-215 (follow-up of PMK-58, listed in `docs/superpowers/epc-6-follow-ups.md`). Two acceptance criteria: a Linear fallback that finds pull requests by agent authors instead of `NOT_SUPPORTED`, and an `--agent` filter.

## Intent

A Linear issue is never assigned to `agent:<name>`: the person stays the assignee and the agent is the `delegate` (PMK-214). So `issues track-agents` cannot find agent work by assignee there and refuses. The PMK-58 spec named the way out: search the pull requests by agent author. A user with agents working through GitHub wants the list on Linear too.

## Decisions

1. **Fallback trigger.** When the capability `agent_delegation` lists `issues track-agents` under `detail.unsupported` (Linear), the command no longer throws. It runs the pull request path. `path: absent` (no agent in the workspace, or no delegation) still answers `NOT_SUPPORTED`. The manifest keeps `unsupported` so the capability stays honest: the issue path is what is unsupported, the fallback is not an issue read. *(builder's call)*
2. **Agent author.** An open pull request whose `author.is_bot` is `true` (what `gh pr list --json author` reports for GitHub Apps and bot accounts). pmkit has no map from a Linear agent to a GitHub login, so this is the one rule that can be read from the host. *(builder's call; a mapping in config is a follow-up)*
3. **Rows.** One row per such pull request, from `host.listPullRequests()` (the list is capped at 200 by the host). Each row has `pr` (`state` `draft` or `open`, number, url, `blocked`, `blocking`, `unknown`, `unchecked`, from the same `getPullRequest(..., { detail: true })` + `collectBlockers` path the Local rows use), `author` (the login) and `branch` (`headRefName`). The matching issue comes from the branch: the Linear issues with a `branch` equal to `headRefName`. A row with a match carries `id`, `title`, `status`, `delegate` (from the issue, may be `null`) and `delegation` (read from the comments with the same `delegationOf`, against the issue's `delegate`). A row without a match has `id: null` and `delegation: null`, and the text says "no issue with this branch".
4. **Source field.** The result has `source: 'issues'` (Local, as today) or `source: 'pull_requests'` (the fallback), and a note says that the list comes from bot-authored pull requests, not from delegates, so an agent whose pull request is not by a bot account is not listed.
5. **Incomplete reads.** The fallback never concludes from a read that may be cut. `incomplete: true` with a warning when the pull request list has 200 entries (it may be cut), when the issue read for the branch match has `hasMore` or problems (a row's issue match is then "not verified"), when a pull request detail read fails (`pr.state: 'unknown'`, as in Local, with `RATE_LIMITED` stopping later reads), and when a blocker is not verified. An empty result with `incomplete` says "no agent pull request was found", never "no agent has work". `git_host: none` on Linear answers `NOT_SUPPORTED` (there is no pull request to find) with the next step to configure a host.
6. **`--agent <id>` filter.** Value: `agent:<name>` or the bare `<name>`; matched case-insensitively.
   - Local: keeps the rows whose `assignee` is `agent:<name>`. Pull requests are read only for the kept rows.
   - Fallback: keeps the pull requests whose author login, with a leading `app/` and a trailing `[bot]` removed, equals `<name>`.
   - An empty value is `INVALID_INPUT`. The filter is in the result (`agent`), and an empty filtered list says "no issue (or pull request) for agent X", with the incomplete rule above. `--agent` does not check that the member exists: a typo yields the empty answer.
7. **Command file.** `commands/issues/track-agents.md` gets the optional `agent` parameter, the fallback steps and the `source` reading. Examples and the scenario agree with it.

## Non-goals

A config map from a Linear agent to a GitHub login; reading Linear sessions or delegates directly (the issue path stays unsupported); starting agents.

## Tests

Local `--agent` (kept, other agent, bare name, empty value, none found); Linear fallback with a fake `gh` and the fake Linear API (bot PR with and without an issue, human PR skipped, 200-entry list incomplete, detail failure unknown, `git_host: none`, `--agent` match); manifest still lists `issues track-agents` under `unsupported`; degraded-coverage entry moves from REFUSALS to the linear cases; golden for `--agent`.
