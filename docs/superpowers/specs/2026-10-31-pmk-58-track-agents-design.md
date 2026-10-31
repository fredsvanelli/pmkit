# PMK-58: track the issues delegated to agents

Epic EPC-6. Source: Foundation catalog (`track-agents`: "Status of agent sessions and PRs on issues"). Blocked by PMK-57, which writes the delegation comment this command reads.

## Intent

A user who delegated issues to agents wants one list: which issues each agent holds, whether the delegation is current, and what state the pull request of each issue is in.

## Decisions

- Command: `pmkit issues track-agents`, skill `/pmkit:issues:track-agents`. It reads only.
- Scope: open issues (`backlog`, `todo`, `in_progress`, `in_review`) whose assignee matches `agent:<name>`.
- Delegation: the newest root comment (no parent) that `parseDelegation` reads. It is `current` when it names the assignee, `stale` when it names another agent, `none` when no record exists. A comment read that fails or is cut makes the delegation `unknown`.
- `parseDelegation` normalizes CRLF and trailing space (PMK-181 scope, small fix).
- PR state, per issue, from the issue `branch`: `no_branch`, `no_pr`, or the pull request (`open`, `draft`, `merged`, `closed`) with `blocked` from `collectBlockers` and the blocking messages. A failed read for one issue gives `unknown` with the error, never a guess. `NOT_CONFIGURED` and `AUTH` stop the command.
- `git_host: none`: the list has no PR state (`pr: null`) and a `note:` says why.
- Incomplete reads (issue that does not parse, `hasMore`, per-issue failures) set `incomplete: true` and a warning. No issue is hidden.
- Linear: `agent_delegation` is absent, so the command answers `NOT_SUPPORTED` with the manifest hint, like release commands do for absent releases. Capability `agent_delegation` serves the command in `SERVED_BY`.

## Non-goals

Searching PRs by agent author (the catalog's degradation for trackers without delegation) and starting agents.
