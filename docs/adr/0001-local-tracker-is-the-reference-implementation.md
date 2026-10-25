# The Local tracker is the reference implementation of the contract

pmkit has one set of commands for every tracker, and each tracker adapter implements the same contract. The first adapter is the Local tracker, which keeps issues, sprints, epics and history as plain files under `.issues/` in the repository. We built it before any hosted adapter. It needs no account, no network and no setup beyond `pmkit init`. It is also the adapter that defines what the contract means: the contract suite runs against it first, and a hosted adapter such as Linear later has to pass the same suite. The Local tracker serves all 20 capabilities of the manifest, 15 natively and 5 derived (`native_metrics`, `linked_code`, `agent_delegation`, `security_alerts`, `user_inbox`), so every command has a working path to test against.

The files live in the repository, so git versions and shares them. Two people who append to the same `events.jsonl` merge without a conflict, because `.issues/.gitattributes` marks the file `merge=union`. The plugin never commits on its own. Tracker changes show up as file edits for the user to review and commit with the code they belong to, unless `auto_commit` is on.

## Considered options

- Start with a hosted adapter, Linear first.
- Keep issues in a single file or a database.

## Consequences

- Searches read the query index in `.issues/.cache/index.json` and reparse only the issue files whose stat signature changed (PMK-7). Git ignores the index, and it is never a source of truth.
- Hand edits to `issue.md` are allowed, so the adapter has to detect drift and record synthetic events before each write.
- A hosted adapter that lacks a capability reports it as `absent` or `conditional` in its manifest. The Local tracker has no such gaps, so tests against it alone never exercise a command's degraded path.
