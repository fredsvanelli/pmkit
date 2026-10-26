# PMK-114: accept --sprint current in issues create and issues update

## Problem

`issues list --sprint current` and `cycle add --to current` resolve `current` to the active sprint. `issues create --sprint current` and `issues update --sprint current` do not. They fail with `INVALID_INPUT: sprint current does not exist`, because the `sprint` field normalizer treats `current` as a sprint id. An agent that turns "add it to this sprint" into `--sprint current` gets an error on these two commands only. Found in PMK-10.

Acceptance criteria:

1. `issues create --sprint current` puts the issue in the active sprint, and fails with a clear error when no sprint is active.
2. `issues update --sprint current` behaves the same way.

## Findings

Where `current` is resolved today, all in `scripts/lib/local/tracker.mjs`:

- `currentCycle()` returns the single `active` sprint or `null`. `activeSprintId()` returns its id or `null`.
- `search()` (used by `searchIssues`) maps `filter.sprint === 'current'` to `activeSprintId()`. With no active sprint the filter becomes `null`, so the list is empty and no error is raised. That is the right behavior for a read, and it stays.
- `moveToCycle()` (the `cycle add` operation) maps `to === 'current'` to `activeSprintId()` and throws `invalid('there is no active sprint', 'pmkit cycle list')` when the result is `null`. This is the only existing message for "no active sprint". It is `INVALID_INPUT` with exit code 2 and next step `pmkit cycle list`.

Where the field is validated on write:

- `NORMALIZE.sprint` is `requireSprint(value)` (tracker.mjs, near line 177). It accepts a value only when `sprints/<value>.yaml` exists, otherwise it throws `sprint <value> does not exist`. `createIssue` and `updateIssue` both reach it through `applyFields`.
- The CLI passes the flag through unchanged: `issuePatch` in `scripts/pmkit.mjs` does `set('sprint', orNull(opt('sprint')))`. `none` already becomes `null`, which clears the sprint.

The CLI is not the only caller of `createIssue` and `updateIssue`. They are contract operations, so the rule belongs where the tracker validates the field.

## Options

A. Resolve in the CLI. `issuePatch` replaces `current` with `ctx.tracker().currentCycle()?.id` and throws the error itself. It fixes the two commands, but a second place now knows what `current` means, and any other caller of `createIssue`/`updateIssue` still fails.

B. Resolve in the tracker, in the `sprint` normalizer. `requireSprint` maps `current` to the active sprint id and throws the "no active sprint" error when none exists. A small helper holds the lookup and the error, and `moveToCycle` uses the same helper. The CLI stays unchanged. Create and update, dry run and real run, share one code path.

C. Resolve in a new shared layer that every operation calls before the tracker (a general "resolve aliases" step for `me`, `current` and `none`). It is larger than the bug and moves code that works.

## Decisions

| Decision | Reason |
| --- | --- |
| Use option B. | `search` and `moveToCycle` already resolve `current` inside the tracker. Putting create and update there keeps one rule in one file and covers every caller. A would duplicate the rule in the CLI, and C is more than a one-point bug needs. |
| Add one helper in `tracker.mjs`, `requireActiveSprintId()`, that returns `currentCycle().id` or throws `invalid('there is no active sprint', 'pmkit cycle list')`. `moveToCycle` and `requireSprint` both call it. | Reuses the exact message, code and next step that `cycle add --to current` gives, so the three write paths cannot drift. `moveToCycle` keeps its behavior and its text. |
| Error code `INVALID_INPUT` (exit 2), message `there is no active sprint`, next step `pmkit cycle list`. | Same as `cycle add --to current`. It satisfies "a clear error", and the next step tells the user how to see the sprints. |
| `searchIssues` with `sprint: 'current'` and no active sprint keeps returning an empty list. | Criteria cover writes only. `issues mine` and `issues find` rely on the empty list (their command texts say how to word it). Changing it is a different issue. |
| `requireSprint` checks `value === 'current'` before the file lookup. A sprint file named `current.yaml` is not reachable by that id. | Sprint ids are start dates (`cycle open` derives the id from `--start`), so no real sprint is called `current`. The same shadowing already exists for `cycle add --to current` and `issues list --sprint current`. |
| The resolved id, not the word `current`, is stored and written to the event log. | The file and the `update` event record the sprint the issue joined, as `cycle add` does today. |
| `--dry-run` resolves `current` like a real run. | The preview must show the real sprint id, and must fail the same way as the real call. |
| Update `usage` strings in `pmkit.mjs` to `[--sprint id\|current\|none]` for create and update. | The help text should say what the flag accepts, as `issues list` and `cycle add` already do. `none` already works on update; on create it is accepted and means no sprint. Check that no golden contains these strings (a search found none under `scripts/__goldens__` or `scripts/__scenarios__`). |
| Fix the matching text in `commands/issues/create.md`. | See "Command texts". |
| No CHANGELOG entry. | The CHANGELOG is written per release. PMK-10 and PMK-111 added none, and the last two entries (`afe5a26`, `2eeac47`) belong to release work. `changelog.test.mjs` only parses the file. The orchestrator can mention a suggested line in the PR, as PMK-10 did. |
| No tracker format change, no migration. | No stored shape changes. |

## Design

### scripts/lib/local/tracker.mjs

1. Next to `activeSprintId` (around line 400), add:

   ```js
   const requireActiveSprintId = () => {
     const id = activeSprintId()
     if (id === null) throw invalid('there is no active sprint', 'pmkit cycle list')
     return id
   }
   ```

   `activeSprintId` is declared after `requireSprint` in the file, but both are only called after the tracker is built, so the order is safe. If the reviewer prefers, move the two `const` lines above `requireSprint`.

2. `requireSprint(value)` starts with `if (value === 'current') return requireActiveSprintId()`. The rest is unchanged. `NORMALIZE.sprint` stays `requireSprint`, so `createIssue` and `updateIssue` both get the behavior, including `--dry-run`.

3. `moveToCycle`: replace the two lines that compute `sprint` and throw with `const sprint = to === 'current' ? requireActiveSprintId() : to`. Keep `if (sprint !== null) getSprint(sprint)`. The thrown error is identical to today's.

An unreadable sprint file already throws `INVALID_INPUT` naming the file from `listCycles`. The new path inherits that, like `searchIssues` does.

### scripts/pmkit.mjs

- No change to `issuePatch`. `current` flows through `set('sprint', orNull(opt('sprint')))` to the tracker.
- Usage strings only: `issues create` and `issues update` show `[--sprint id|current|none]`. Verify the help output with `node scripts/pmkit.mjs issues create --help`.

### Command texts

- `commands/issues/create.md` line 40 says a sprint that does not exist answers `NOT_FOUND`. The CLI answers `INVALID_INPUT` (the same function throws `INVALID_INPUT` for a missing parent and member as well, so the line is wrong for all three). Fix the code in that line to match what the CLI does, and add: `--sprint current` with no active sprint answers `INVALID_INPUT` "there is no active sprint"; offer `/pmkit:cycle:plan` or create the issue without a sprint. Before editing, confirm the real codes with one dry run for each of parent, sprint and member, and fix only what differs.
- `commands/issues/update.md`: add the same no-active-sprint line to its error section, and say that `--sprint current` is accepted. The scope-move confirmation rule already covers any `--sprint` change.
- Both files: where the text lists `--sprint`, a short note that the value is a sprint id, `current` or `none`. Keep it to one clause.
- `scripts/scenarios.test.mjs` static checks parse these files (flags, confirmation bullets). Run `npm test` after the edit, and regenerate a golden only if a scenario output really changes, with `UPDATE_GOLDENS=1`, and review the diff.
- `commands/cycle/plan.md`, `close.md`, `issues/mine.md`, `issues/find.md` already use `current` correctly and stay unchanged.
- `docs/superpowers/specs/2026-10-23-pmkit-design.md` lists `cycle add <id...> --to <sprint|none>` without `current`, and `issues create/update` without a value hint. It is a historical spec; leave it.

## Tests to add

All use `makeRepo` from `scripts/test-helpers.mjs`. The `team` fixture has an active sprint, `2026-10-12`. The `basic` fixture has none.

In `scripts/sprints.test.mjs` (tracker level):

1. `createIssue` with `{ sprint: 'current' }` on `team` stores `sprint: '2026-10-12'` and the `create` event carries that id.
2. `updateIssue` with `{ sprint: 'current' }` on `team` sets the active sprint, and writes an `update` event on field `sprint` with `to: '2026-10-12'`.
3. `createIssue` and `updateIssue` with `{ sprint: 'current' }` on `basic` throw `INVALID_INPUT` with message `there is no active sprint` and next step `pmkit cycle list`, and leave no issue folder or event line behind (compare the file list or `hashTree` before and after).
4. `{ dryRun: true }` resolves too: the returned `after.sprint` is the active id and nothing is written. With no active sprint it throws the same error.
5. After `cycle close` of the only active sprint on `team`, `current` fails (a closed sprint does not count).

In `scripts/cli.test.mjs` (end to end, next to the existing `cycle add --to current` test):

6. `issues create --title T --sprint current --json` on `team` prints `after.sprint === '2026-10-12'`, exit 0.
7. `issues update <id> --sprint current --json` on `team` does the same for an existing issue.
8. The same two commands on `basic` exit with status 2 and `error.code === 'INVALID_INPUT'`, with the message `there is no active sprint`.
9. `issues update <id> --sprint none` still clears the sprint (regression for the `orNull` path), and `--sprint 2026-10-12` still works.
10. `cycle add --to current` on `basic` keeps its current error (existing test at cli.test.mjs near line 582; extend it with an assertion on the message, which proves the helper refactor changed nothing).

TDD order for the implementer: write tests 1 to 3 and 6 to 8, see them fail with `sprint current does not exist`, then change `tracker.mjs`.

## Acceptance criteria to design

| Criterion | Design part |
| --- | --- |
| 1. `issues create --sprint current` puts the issue in the active sprint, and fails clearly when none is active | `requireSprint` resolves `current` through `requireActiveSprintId()`; error `INVALID_INPUT`, `there is no active sprint`, next step `pmkit cycle list`; tests 1, 3, 4, 6, 8; command text fix in `commands/issues/create.md` |
| 2. `issues update --sprint current` behaves the same way | Same normalizer serves `updateIssue`; tests 2, 3, 4, 5, 7, 8, 9; command text in `commands/issues/update.md` |

## Risks and non-goals

- `issues list --sprint current` with no active sprint still returns an empty list and no error. Out of scope.
- `issues create` and `update` do not accept other aliases (`next`, `previous`). Out of scope.
- A future adapter for another tracker must resolve `current` in its own `createIssue`/`updateIssue`. The contract suite in `scripts/contract-suite.mjs` does not cover sprint aliases today. Adding a contract test for `current` is optional and listed as an open question.
- The error message is the same as for `cycle add`, so a scenario or golden that captures it needs no update. If one captures the old `sprint current does not exist` text, update it.

## Open questions

- Should the contract suite (`scripts/contract-suite.mjs`) assert the `current` behavior for any adapter? Default: no, the Local tracker tests are enough for this issue.
- The `commands/issues/create.md` error code line may be wrong for parent and member too. The implementer verifies and fixes only the lines that differ.
