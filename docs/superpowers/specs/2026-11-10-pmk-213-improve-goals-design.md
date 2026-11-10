# PMK-213 design: improve goals

Source: PMK-213, the follow-ups of PMK-45 (goals) in `docs/superpowers/epc-6-follow-ups.md`, and the PMK-45 spec `2026-10-30-pmk-45-strategic-goals-design.md`. Orchestrated run: no questions were asked, so every call below is mine. PMK-233 (initiatives-and-goals) is blocked by this issue and will use the Linear initiative reads.

## Why

Goals today are create-only and Local-only: a goal cannot be renamed, finished or removed, it has no state, its prefix is fixed, the Linear adapter refuses every goal call even on a plan with initiatives, `goal progress` hides an epic file that does not parse, and `validate` does not say how many goal files it read.

## Decisions

1. **`goal_prefix`.** A new optional key in `.issues/config.yaml`, 2 to 5 capital letters, default `GOAL`. It must differ from `id_prefix` and `epic_prefix` (checked with the default when the key is absent, so `id_prefix: GOAL` without the key is a problem). The schema gets the key with `default: GOAL`. Every place that used the `GOAL_PREFIX` constant (goal reads, `createGoal`, `requireGoal`, `listGoals`, `validate`) uses `local.goal_prefix`. Changing the key does not rename files: goal files with the old prefix become "not named after a goal id" problems, as with `epic_prefix`. `init` does not write the key.
2. **Goal status.** A goal has a `status`, one of `proposed`, `planned`, `active`, `completed`, `canceled`: Linear's `InitiativeStatus` values in lower case, so Local and Linear agree. A file without `status` reads as `active` (every goal written before this change was live). `createGoal` writes `status: active` unless `--status` gives another; the file keeps the order `title`, `status`, `target`. A value outside the list is `INVALID_INPUT` on write and a `goal` problem in `validate`. `goal list` gets a Status column and `goal get` a `status` line. **Owner is out**: the criterion reads "status or owner", and the status is what `goal close` needs.
3. **`goal update <id> [--title t | --title-file f] [--target YYYY-MM-DD|none] [--status s]`.** At least one flag, else `INVALID_INPUT`. `--target none` removes the target. Only the changed frontmatter lines are edited (`setScalar` / `removeKey`, as `setEpicGoal` does), so comments, other keys and the body stay. An unchanged value writes nothing. Returns `{ before, after }` with the epics.
4. **`goal close <id>`.** `goal update <id> --status completed`, nothing more. A completed goal writes nothing.
5. **`goal delete <id>`.** Removes `goals/<id>.md`. It refuses with `CONFLICT`, writing nothing, when an epic links to the goal (the error lists the epics, the next step is `pmkit epic goal <epic> none`), and with `INVALID_INPUT` when an epic file does not parse, because that epic may link to it. The dry run returns `{ before, after: null, removes: { file } }`. Goals have no event log, so no event is written. Every delete shows a preview (write policy).
6. **`goal create --title-file`.** Added beside `--title`, as the conventions want for a title from data; `goal update` takes both too.
7. **Contract.** Two new operations, `updateGoal(id, input, actor, { dryRun })` and `deleteGoal(id, actor, { dryRun })`. `goal close` uses `updateGoal`. `SERVED_BY.strategic_goals` adds `goal update`, `goal close` and `goal delete`. Local stays `native`, so ADR-0001 is unchanged.
8. **Linear initiatives (reads).** On a Business or Enterprise plan the Linear manifest answers `strategic_goals: { path: 'native', detail: { entity: 'initiative', unsupported: ['createGoal', 'setEpicGoal', 'updateGoal', 'deleteGoal'] } }`; other plans stay `absent` with the plan hint, and every goal call there still answers `NOT_SUPPORTED` with that hint. The adapter serves `listGoals`, `getGoal` and `goalProgress`:
   - Query `PmkitInitiatives`: `initiatives(first, after)` with `id slugId identifier name description content status targetDate url` and `projects(first: 50, filter: <team filter>)` (the same `accessibleTeams` filter as `epic list`, so a goal's epics are the team's epics) with `id slugId identifier name status { name type }` and `pageInfo`. Fields checked against Linear's public schema (`packages/sdk/src/schema.graphql`, `type Initiative`, `enum InitiativeStatus`); not run live (no Business workspace), recorded in `API-VERIFICATION.md` as unverified live.
   - Goal shape: `id` is the `identifier` in upper case when set, else the `slugId`; `title` = `name`; `status` = the status in lower case; `target` = `targetDate`; `description` = `content` or `description`; `url`; `epics` = the epic ids (`epicId`) of the projects.
   - `getGoal(key)` matches the UUID, the slug or the identifier (any case) in the list; no match is `NOT_FOUND`.
   - `listGoals` reads at most 20 pages of 50 and sorts with `sortGoals`. A cut read (more initiatives, or a goal with more than 50 team projects) is a `problems` entry with `kind: 'goal'` and code `INCOMPLETE`, so `goal list` warns and `goals overview` is incomplete and never falls back to top-level issues.
   - `goalProgress` sums `deliverableProgress` of each epic as Local does (a `canceled` epic is listed with `counted: false`). A cut epic read (`hasMore`) or a cut project list adds a line to `warnings` in the result.
   - The writes stay stubs, with the generic "not implemented" refusal.
9. **`goal progress` warns.** `goalProgress` returns `warnings`: an epic file that does not parse (it may link to the goal), an issue file that does not parse, and on Linear a cut read. The CLI prints them, adds `complete: false` when there is any, and the text ends with the same "incomplete" line as `goals overview`. With none, `complete: true` and `warnings: []`.
10. **`validate` counts goals.** `checked` gains `goals` (one per `.md` file in `.issues/goals`, as milestones count), and the text line names it after releases.

## Non-goals

- Goal owner; Linear goal writes (`initiativeCreate`, `initiativeToProjectCreate`, `initiativeUpdate`, `initiativeDelete`); an epic's goal on Linear (`epic get` there shows no goal).
- `goals overview` skipping completed or canceled goals (PMK-233 decides what the report shows).
- A slash command: goals stay CLI commands documented in the README table.

## Tests

Unit tests for the parse, serialize and config rules; tracker tests for update, close, delete and their refusals; CLI tests for the new commands, the `goal progress` warnings and `validate`; Linear tests with the fake API for the three reads, the absent refusal and the manifest.
