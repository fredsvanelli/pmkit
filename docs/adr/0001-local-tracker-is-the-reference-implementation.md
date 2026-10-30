# The Local tracker is the reference implementation of the contract

pmkit has one set of commands for every tracker, and each tracker adapter implements the same contract. The first adapter is the Local tracker, which keeps issues, sprints, epics and history as plain files under `.issues/` in the repository. We built it before any hosted adapter. It needs no account, no network and no setup beyond `pmkit init`. It is also the adapter that defines what the contract means: the contract suite runs against it first, and a hosted adapter such as Linear later has to pass the same suite. The Local tracker serves 14 of the 20 capabilities of the manifest. Eleven are native: `cycles`, `estimation`, `multilevel_hierarchy`, `dependencies`, `native_triage`, `deliverables`, `status_update`, `releases`, `capacity`, `documents` and `time_tracking`. Three are derived: `native_metrics`, `linked_code` and `security_alerts`. The manifest reports the other six as `absent`: `strategic_goals`, `saved_views`, `demand_signals`, `request_queue`, `agent_delegation` and `user_inbox`. The manifest never lists a capability as native or derived unless a command serves it, so each native or derived capability has a command to test against.

The files live in the repository, so git versions and shares them. Two people who append to the same `events.jsonl` merge without a conflict, because `.issues/.gitattributes` marks the file `merge=union`. The plugin never commits on its own. Tracker changes show up as file edits for the user to review and commit with the code they belong to, unless `auto_commit` is on.

## Considered options

- Start with a hosted adapter, Linear first.
- Keep issues in a single file or a database.

## Consequences

- Searches read the query index in `.issues/.cache/index.json` and reparse only the issue files whose stat signature changed (PMK-7). Git ignores the index, and it is never a source of truth.
- Hand edits to `issue.md` are allowed, so the adapter has to detect drift and record synthetic events before each write.
- The Local tracker now has gaps. Its seven `absent` capabilities mean that tests against it exercise the `absent` path. A hosted adapter that lacks a capability reports it as `absent` or `conditional` in its manifest.
