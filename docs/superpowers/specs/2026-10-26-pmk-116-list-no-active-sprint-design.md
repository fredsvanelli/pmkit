# PMK-116 design: say there is no active sprint in issues list --sprint current

Issue: PMK-116, "Say there is no active sprint in issues list --sprint current". Found in PMK-114.

## Problem

`issues list --sprint current` with no active sprint prints `no issues` (or `{ "issues": [], "problems": [] }` with `--json`) and nothing else. `issues create`, `issues update` and `cycle add --to current` fail with `INVALID_INPUT` "there is no active sprint". A user or agent reading the empty list cannot tell "the sprint has no issues" from "there is no sprint".

PMK-114 kept the empty list on purpose. `commands/issues/mine.md` and `commands/issues/find.md` rely on exit 0, and the PMK-115 contract test asserts that `searchIssues({ sprint: 'current' })` returns an empty `.issues` with no active sprint. This design keeps all of that.

## Facts from the code

- The handler `issues list` in `scripts/pmkit.mjs` returns `{ data, text, warnings }`. `data` is the `searchIssues` result, `{ issues, problems }`.
- The runner prints `data` as JSON on stdout with `--json`, and `text` otherwise. It prints each warning to stderr as `warning: <line>`, in both modes. Stdout never carries a warning, so the JSON stays parseable.
- `search` in `scripts/lib/local/tracker.mjs` resolves `current` to `activeSprintId()`. With no active sprint that is `null`, and `runQuery` matches nothing.
- `currentCycle` is already a contract operation (`TRACKER_OPERATIONS` in `scripts/lib/contract.mjs`). `cycle current` prints `no active sprint` when it returns `null`.
- Existing warnings follow the shape `<what happened>; run <next step>`, for example `milestone ... have no file: ...; run /pmkit:local:doctor`.
- Goldens that run `issues list --sprint current`: `basic`, `no-sprints`, `team`, `messy-merge`. `team` and `messy-merge` have an active sprint. `basic` and `no-sprints` have none.

## Approaches

### A. Warning line from the CLI handler (chosen)

After `searchIssues` returns, the handler checks two things. The `sprint` option is `current`, and `found.issues` is empty. When both hold, it calls `ctx.tracker().currentCycle()`. When that returns `null`, it adds one line to `warnings`.

- The knowledge comes from `currentCycle()`, a contract operation every adapter already implements. No adapter changes and no contract change.
- The extra call runs only for `--sprint current` with an empty result. A non-empty result proves a sprint is active, so the common path costs nothing.
- Stdout stays the same in both modes. The line goes to stderr, where the CLI already puts warnings.

### B. A field in the JSON data, set by `searchIssues`

`searchIssues` would return `{ issues, problems, noActiveSprint: true }` or a similar note. Rejected.

- It widens the contract. Every adapter and the contract suite must carry the new field, for one message.
- It changes the `--json` shape of one command in one case. Agents and goldens that compare the whole object see a new key.
- A hosted adapter that resolves `current` on the server may not know why the list is empty. `currentCycle()` can answer that on its own.
- It is the right place only if a later issue needs the reason in the data (see the follow-up candidates).

### C. Change the human table text

Print `no active sprint` instead of `no issues` in the table. Rejected.

- `--json` ignores `text`, so criterion 2 fails.
- It changes stdout, which criterion 3 and the callers of the table do not expect.

### D. Fail with `INVALID_INPUT`, as create and update do

Rejected without further work. It changes the exit code from 0 to 2 and breaks `find.md`, `mine.md`, the PMK-115 test and criterion 1.

## Chosen design

Approach A. One change in the `issues list` handler, in `scripts/pmkit.mjs`:

1. Run `searchIssues` as today and build `warnings` from `found.problems`.
2. When `ctx.opt('sprint') === 'current'` and `found.issues.length === 0`, call `ctx.tracker().currentCycle()`.
3. When it returns `null`, push the message below onto `warnings`, after the problem lines.

The text and the data returned are unchanged.

### The message

```
there is no active sprint, so --sprint current matches no issues; run pmkit cycle list
```

It names the cause in the words of PMK-114 ("there is no active sprint"), says what the flag did, and gives the same next step as the PMK-114 error (`pmkit cycle list`), in the `; run <step>` form of the other warnings. It uses no em dash and no colon.

### Where it appears

| Case | stdout | stderr | exit |
|---|---|---|---|
| Human, no active sprint | `no issues` | `warning: there is no active sprint, so --sprint current matches no issues; run pmkit cycle list` | 0 |
| `--json`, no active sprint | `{ "issues": [], "problems": [] }`, pretty-printed as today | the same warning line | 0 |
| Active sprint, `--sprint current` | unchanged | empty | 0 |
| `--sprint none` or a sprint id | unchanged | empty | 0 |
| No `--sprint` | unchanged | empty | 0 |
| Active sprint, filters match nothing | `no issues` | empty | 0 |

Criterion 2 allows "the JSON data or the CLI's warning lines". This design uses the warning lines. The JSON object keeps its current keys.

## Commands and conventions

No command text changes.

- `commands/issues/mine.md` step 3 already runs `cycle current` first. When no sprint is active it drops `--sprint current` and says so. The new warning does not fire there, so the text stays correct.
- `commands/issues/find.md` runs `issues list <flags> --json` in step 5 and says, for an empty list, to "say so and name the filter that is likely too narrow". An agent reads stdout and stderr of that call together. It sees the warning, and the filter it names is `--sprint current`, which is the right one. The command needs no new step to be correct.
- `skills/pmkit/references/conventions.md` has a section on reading errors and none on warnings. That gap exists for every warning the CLI prints today, not only this one. It is a follow-up, not part of this issue.

## Snapshots

Four blocks change, in two files. Each is a `stderr` section that goes from `(empty)` to the warning line, with stdout and exit code the same.

- `scripts/__goldens__/basic/issues-list.txt`: `issues list --sprint current` and `issues list --sprint current --json`.
- `scripts/__goldens__/no-sprints/issues-list.txt`: the same two commands.

`team` and `messy-merge` have an active sprint and must not change. No scenario snapshot in `scripts/__scenarios__/` changes. `issues-find` and `issues-mine` use the `team` fixture, and their `.after.txt` files record exit codes only.

The implementer regenerates with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, then reads `git diff scripts/__goldens__` line by line. The diff must show only those four stderr sections. Any other change is a bug. The same check applies to `scripts/scenarios.test.mjs`, whose snapshots must show no diff.

## Assertions per criterion

All tests go in `scripts/cli.test.mjs`, using its `run`, `json` and `makeRepo` helpers. Let `WARNING` be `warning: there is no active sprint, so --sprint current matches no issues; run pmkit cycle list`.

### Criterion 1: exit 0, empty list, and the user is told

Test `issues list --sprint current says there is no active sprint and still lists nothing`.

- Input: `makeRepo('basic')`, then create one issue (`issues create --title First`) so the tracker is not empty. Run `issues list --sprint current`.
- Expect: status 0, stdout `no issues\n`, stderr `WARNING\n` exactly.
- Control in the same test: `issues list --json` lists the one issue, which proves the empty result comes from the sprint.

### Criterion 2: `--json` keeps an empty `issues` list and carries the reason

Test `issues list --sprint current --json keeps parseable stdout and puts the reason in a warning line`.

- Input: the same repo. Run `issues list --sprint current --json`.
- Expect: status 0. `JSON.parse(stdout)` deep-equals `{ issues: [], problems: [] }`. Stderr is `WARNING\n`. `JSON.parse` not throwing proves stdout holds only JSON.

### Criterion 3: no change with an active sprint, `none` or an id

Test `issues list --sprint current gives no warning when a sprint is active, and none or an id never warn`.

- Input: `makeRepo('team')`, active sprint `2026-10-12`.
  - `issues list --sprint current --json`: status 0, issue ids sorted equal `['ISS-2X6D', 'ISS-4M2S', 'ISS-5N1R', 'ISS-8C4W']` (the same list `scripts/sprints.test.mjs` asserts), stderr empty.
  - `issues list --sprint current --text zzzzzz --json`: `issues` empty, stderr empty. A sprint exists, so an empty result is not a sprint problem.
- Input: `makeRepo('basic')` with no active sprint.
  - `issues list --sprint none --json` and `issues list --json`: status 0, stderr empty.
  - A sprint id: in the same temp repo, open a sprint with `cycle open` and close it with `cycle close`, so no sprint is active. Then `issues list --sprint <id> --json` gives status 0 and an empty stderr. The id is a sprint that exists, so the filter is valid and never warns.
- The golden diffs (see Snapshots) prove that the stdout of the unchanged cases did not change: `team` and `messy-merge` goldens stay identical.

### Criterion 4: a CLI test covers both cases, and `npm test` passes

- The three tests above cover the case with and without an active sprint.
- Commands: `node --test scripts/cli.test.mjs`, then `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs` and the diff reading, then `npm test`.
- Red first. Before the handler change, tests 1 and 2 fail on the stderr assertion and test 3 passes.

## Decisões

1. **Warning line, not a JSON field.** The warning channel exists, reaches humans and agents, and leaves the contract alone. Criterion 2 names it as allowed.
2. **The CLI calls `currentCycle()`.** It is already a contract operation, so no adapter needs work and no contract test changes. The tracker's `searchIssues` result stays as PMK-115 tests it.
3. **Check only when the result is empty.** A non-empty result proves a sprint is active. The common path pays nothing, and the cases with an active sprint cannot warn by mistake.
4. **Warn on any empty `--sprint current` result with no active sprint, whatever other filters are set.** The sprint filter alone already matches nothing, so the reason is true whatever else is filtered.
5. **Message text.** It reuses the PMK-114 words and the PMK-114 next step, and uses the existing `; run <step>` shape of warnings. It adds "so --sprint current matches no issues" so the line makes sense alone in a stderr stream.
6. **Stdout does not change.** Criterion 3 and the callers of the table depend on it. Only stderr gains a line.
7. **No command text change.** `mine.md` avoids the case, and `find.md` already tells the agent to explain an empty list. The agent sees the warning in the same call. Changing the commands would go beyond the issue.
8. **Goldens regenerated, not edited by hand.** Four stderr sections change, and the diff is read line by line.
9. **Choices made without asking the user.** Approach A and the message text are the author's recommendation, as the brief allowed.

## Follow-up candidates

- Add a "Reading warnings" section to `skills/pmkit/references/conventions.md`: show each `warning:` line from stderr as it is. Today the file covers errors only.
- Consider a `warnings` array in the `--json` output of every command, if agents turn out to drop stderr.
- Have `commands/issues/mine.md` rely on the warning instead of its own `cycle current` pre-check, to save one call. Separate issue, since it changes a command.
- Give `cycle issues` or other `current` readers the same message if any prints silently. Check first with `grep -n "current" scripts/pmkit.mjs`.

## Open questions

None. The issue is met with exit 0 and the empty list, with no change to a command's behavior.
