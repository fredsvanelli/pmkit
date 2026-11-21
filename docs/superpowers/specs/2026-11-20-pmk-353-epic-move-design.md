# PMK-353: `epic move` changes an epic's status

Size: a project (three trackers, the CLI, one command file, runbooks). Issue: `.issues/issues/PMK-353`. Parent: EPC-6.

## Intent

No command can change an epic's status. Every epic stays where `epic create` put it, so EPC-3 still reads backlog with all 8 of its issues done. Status reports, roadmap reviews and `epic list` then misreport what is open. `/pmkit:issues:move EPC-3 done` answers NOT_FOUND because it only reads issues, and editing `.issues/` by hand is not allowed. The work adds one operation, on all three trackers, that moves an epic to a status category.

## Goals, non-goals, anti-goals

- Goal: `pmkit epic move <id> <category> [--status <name>]` changes the status, and `epic get` and `epic list` show the new one.
- Goal: the dry run shows the status before and after, and writes nothing on any tracker.
- Goal: a move to done or canceled while the epic has open issues warns with their IDs, and still moves it. The issue asks only for done. Canceled was added in the interview because it's the same check, and canceling an epic leaves its open issues under a dead parent.
- Goal: the move lands in the local epic's `events.jsonl` with its author and date, and on Linear and GitHub the remote epic shows the new status.
- Goal: `/pmkit:issues:move` accepts an epic ID and runs `epic move` for it.
- Goal: an unknown epic answers NOT_FOUND. An unknown category, a category the tracker can't store for an epic, or the status the epic already has answers INVALID_INPUT.
- Non-goal (from the issue): editing an epic's title or description (PMK-348), moving an epic on its own when its issues finish, moving many epics in one command.
- Non-goal: an `epic history` command. The local history is `epics/<ID>/events.jsonl`, as for `epic goal`.
- Anti-goal: a move whose status reads back as something else. On every tracker, `epic get` after a move must show the status the move wrote. That is why GitHub refuses the categories it can't store.
- Anti-goal: a warning that blocks the move. The user decides.

## Approaches (GitHub, the only open choice)

Local and Linear have a status field on the epic, so there is one way to write each. GitHub has none: pmkit reads an epic's status from the Project's `closed` flag (Closed, done) or from its latest status update (`toEpic` in `scripts/lib/github/projects.mjs`).

- **A. Status updates, plus Closed on request.** Picked by the user. A move publishes a Project status update with the mapped status. Done defaults to Complete, and `--status Closed` closes the Project. Trade-off: each move adds a status update to `epic updates`, and todo, canceled, triage and in_review can't be written.
- **B. Done closes the Project.** Not picked: closing is more final, and a closed Project drops out of the views people use on GitHub.
- **C. A single-select field on the epic Project.** Not considered further: `toEpic` doesn't read one, so it would change the read path and ADR 0010.

## Design

### Contract

A new operation `moveDeliverable(id, category, actor, { status, dryRun })` in `TRACKER_OPERATIONS`, next to `createDeliverable`. It returns `{ before, after }`, as `moveToCategory` does for an issue. Every adapter implements it, and the contract suite (`scripts/contract-suite.mjs`) covers it. `epic move` goes into the `deliverables` command list in `scripts/lib/capabilities.mjs`.

The rules, the same on every tracker:

1. Read the epic. An unknown ID answers NOT_FOUND (`pmkit epic list` as the next step).
2. The category must be one of the seven. On top of that, it must be one the tracker can store for an epic (below). Otherwise INVALID_INPUT, listing the categories that work.
3. The status is `--status` when given, otherwise the category's first status. A `--status` outside the category answers INVALID_INPUT, listing the statuses in it.
4. Without `--status`, a category equal to the epic's current one answers INVALID_INPUT ("epic EPC-3 is already in done"), even when the category's first status isn't the current one. With `--status`, only the exact current status answers INVALID_INPUT, and another status in the same category is a real move. The user decided this after the builder check: a bare `epic move acme/12 done` on a closed GitHub Project would otherwise reopen it and publish Complete. `--status Complete` still does that on purpose. This is stricter than `issues move`, which treats the same status as a no-op. The acceptance criteria ask for the error.
5. A dry run computes `after` and makes no write and no remote mutation.

### Local

- The statuses are the tracker's own `local.statuses`, the same set issues use (epics already read their status from it). Any category that has a status works.
- The write follows `setEpicGoal`: edit only the `status` line of `epic.md` with `setScalar`, read it back with `parseEpicFile`, then append `{ at, by, op: 'move', field: 'status', from, to }` to `epics/<ID>/events.jsonl`. `from` and `to` are status names, as in an issue's move event.

### Linear

- An epic is a Linear project. The statuses are the workspace's project statuses (the existing `PROJECT_STATUSES` query), in `position` order, each in the category that `STATUS_CATEGORY` gives its `type`. When a workspace has several statuses of one type, such as two `started` ones, the default is the first by `position` (decided in the interview). The dry run shows it, and `--status` picks another. So `paused` sits in backlog, and triage and in_review have no status and answer INVALID_INPUT.
- The write is a new `projectUpdate(id, input: { statusId })` mutation. `after` is the project read back.
- `--status` matches names the same way Linear's `moveToCategory` matches issue state names.

### GitHub (approach A, ADR 0011)

The statuses an epic move can write, by category, with the default first:

| Category | Statuses | Write |
|---|---|---|
| backlog | Inactive | status update `INACTIVE` |
| in_progress | On track, At risk, Off track | status update `ON_TRACK`, `AT_RISK`, `OFF_TRACK` |
| done | Complete, Closed | status update `COMPLETE`, or `updateProjectV2(closed: true)` for Closed |

- todo, canceled, triage and in_review answer INVALID_INPUT, naming backlog, in_progress and done. Todo reads as "No update", which a write can't produce. Closed reads as done, so it can't stand for canceled.
- From Closed to any other status (for done, only with `--status Complete`, by rule 4), the move first reopens the Project (`updateProjectV2(closed: false)`), then publishes the update. To Closed, it only closes the Project and publishes nothing.
- The status update carries the latest update's start and target dates forward, as `publishStatusUpdate` does (ADR 0010). Its body is the fixed line `Status changed to <name>.`, for example `Status changed to Complete.`, and `epic move` has no flag for a note (decided in the interview: `epic update-status` publishes notes).
- A reopen that succeeds while the update that follows fails leaves the Project open. The error says so and names the step left, the same way `createDeliverable` reports a half-done write (`afterCreate`).
- These are the names `STATUS_OF` already reads, so a move reads back as itself.

### Open issues on a move to a terminal category

`deliverableProgress` already walks every non-archived issue whose parent chain reaches the epic, on all three trackers. It gains an `open` list: the IDs of the counted issues whose category is neither done nor canceled, in the order they were read. A move to done or canceled runs the move first, so a refusal wins, then reads progress; a failed read becomes a warning (`could not read the open issues of EPC-3: <message>`) instead of an error, since the write has landed, and a cut read (`hasMore`) adds a warning that the open list may be partial. When `open` isn't empty, the move adds a warning, `EPC-3 still has open issues: PMK-12, PMK-14`, to both the dry run and the real run, and goes ahead. On GitHub, canceled is refused before progress is read, so there the warning only comes with done. Using progress keeps the warning's set the same as the one `epic progress` counts, including grandchildren. Local `searchIssues({ parent })` only sees direct children, so it isn't used.

### CLI

`epic move` sits in `scripts/pmkit.mjs` next to `epic goal`: usage `<id> <category> [--status name]`, `write: true`, `flags: ['status']`. It returns `writeText(result, { record: epicRecord })` with the warning, and commits the epic like the other epic writes. The help comes from the command table.

### `/pmkit:issues:move`

`commands/issues/move.md` gets an epic path. Step 1 runs `issues get <id>`. When that answers NOT_FOUND or INVALID_INPUT, it runs `epic get <id>`. When that finds the epic, the command follows the epic path:

- skip the child and blocker checks of step 2 (the CLI warns about open issues itself),
- skip the `discover` status question of step 3. The dry run shows the status picked, and the command says `--status` picks another one,
- run `epic move <id> <category> [--status <name>] --dry-run --json`, show `before` and `after` with the CLI's warning, ask once, then run it without `--dry-run`.

When `epic get` answers NOT_FOUND too, show the original `issues get` error. The command's description and parameter text say "an issue or epic ID".

### Tests and runbooks

- Unit: each adapter's `moveDeliverable` (Local on a temp tracker, Linear on `fake-linear-api.mjs`, GitHub on the fake GitHub API), plus the contract suite. The cases are the acceptance criteria: the move, the dry run, an unknown epic, an unknown category, a category the tracker can't store, and the same status. Each adapter's `deliverableProgress` test checks the `open` list. The warning belongs to the CLI, so the contract result stays `{ before, after }` and the warning is tested on `epic move` in the CLI tests (builder check, my call).
- E2E: a new `docs/runbooks/epic-move.md` for the Local flow (move EPC-style epics with open and finished issues, dry run, warning, `epic get` and `epic list`, `events.jsonl`, the errors), verified by `scripts/runbook-epic-move.test.mjs`. `docs/runbooks/cycles-epics-github.md` and its test gain the GitHub steps: move to in_progress, then to Complete, then to Closed and back. Linear has no runbooks in `docs/runbooks/`, so its unit tests on the fake API cover it.
- The CHANGELOG records the command.

## Left to the builder

- Linear: whether `projectUpdate` returns the project with the fields `toEpic` needs, or needs a read after the write.
- Where `open` is filled in each adapter's progress code, and its exact order.
- The wording of messages and next steps, following `scripts/lib/errors.mjs` and the existing epic commands.

## Decided in the interview

- The GitHub mapping for writes is ADR 0011, `docs/adr/0011-github-epic-moves-publish-status-updates.md`, and ADR 0010's consequences point to it.
- `CONTEXT.md`: "Event" now covers a Local epic's `events.jsonl` (its history, which the metrics don't read), and "Epic" says `epic move` changes its status. No new term: "move", "category" and "open issue" already mean what this design uses.
- The open-issues warning comes with done and with canceled.
- On Linear, the default status of a category is the first by `position`.
- A GitHub move's status update has the fixed body `Status changed to <name>.`, with no flag for a note.
- The reports need no change: `risks.mjs` and `roadmap-review.mjs` already skip epics in a terminal category, so a moved epic stops reading as open.

Approved by the user on 2026-11-20.
