# The Local tracker is the reference implementation of the contract

pmkit has one set of commands for every tracker, and each tracker adapter implements the same contract. The first adapter is the Local tracker, which keeps issues, sprints, epics and history as plain files under `.issues/` in the repository. We built it before any hosted adapter. It needs no account, no network and no setup beyond one command, so the whole kit works the day a team installs it. It is also the adapter that defines what the contract means: the contract suite runs against it first, and a hosted adapter such as Linear later has to pass the same suite. The Local tracker serves all 20 capabilities of the manifest, 15 natively and 5 derived (`native_metrics`, `linked_code`, `agent_delegation`, `security_alerts`, `user_inbox`), so every command has a working path to test against.

The files live in the repository, so git versions and shares them. Two people who append to the same `events.jsonl` merge without a conflict, because `.issues/.gitattributes` marks the file `merge=union`. The plugin never commits on its own. Tracker changes show up as file edits for the user to review and commit with the code they belong to, unless `auto_commit` is on.

## Considered options

- Start with a hosted adapter, Linear first. Rejected: the first build would need an account, a token store and network access in every test, and the contract would take the shape of one vendor's API.
- Keep issues in a single file or a database. Rejected: one file conflicts on every merge, and a database cannot be reviewed in a diff.

## Consequences

- The Local tracker pays for its simplicity. It has no index, so a search reads every issue file, and an index cache is planned for phase 2.
- Hand edits to `issue.md` are allowed, so the adapter has to detect drift and record synthetic events before each write.
- A hosted adapter that lacks a capability reports it as `absent` or `conditional` in its manifest. The Local tracker has no such gaps, so tests against it alone never exercise a command's degraded path.
