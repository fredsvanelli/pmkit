# PMK-4 days off per sprint: implementation plan

Spec: `docs/superpowers/specs/2026-10-25-pmk-4-days-off-design.md`. Issue PMK-4 (epic EPC-1), estimate 2.

**Goal:** `cycle capacity <id>` reads and sets days off per member through a `--days-off` flag, and `/pmkit:cycle:plan` stores the days off it asks for.

**Architecture:** `requireDaysOff` validates in `scripts/lib/local/sprints.mjs`. A new tracker method `updateCycleCapacity` writes capacity and days off in one `writeSprint` call. The CLI parses the flag and the plan command passes it.

## Global Constraints

- Syntax: `cycle capacity <id> [--set member=n,..] [--days-off member=date+date,..]`. `--days-off` may repeat. Dates in one pair join with `+`. `member=none` removes the member's entry. A pair replaces that member's list. Members not named keep their list.
- Dates: `YYYY-MM-DD`, real calendar dates, inside the sprint `start` to `end` inclusive, Monday to Friday, no repeats per member. The file keeps each list sorted ascending. No half days.
- Read JSON (no flag): `{ "capacity": { "<member>": <n> }, "days_off": { "<member>": ["YYYY-MM-DD"] } }`. Read text lists the capacity lines, then a `days off` line per member. When both are empty, the text is `no capacity or days off set`.
- Write JSON (any flag): `{ "before": <sprint record>, "after": <sprint record> }`, as `--set` returns today. One `writeSprint` call, one commit, `--dry-run` writes nothing.
- Errors: validation failures are `INVALID_INPUT` (exit 1 path as for `requireCapacity`). Unknown member: message `days off member "<m>" is not a member`, next step `Use one of: <members>`. Bad date: `days off date "<d>" for <m> is not a valid date (YYYY-MM-DD)`. Out of range: `days off date <d> for <m> is outside the sprint <start> to <end>`. Weekend: `days off date <d> for <m> is not a weekday`. Duplicate: `days off date <d> for <m> is repeated`. A malformed pair (no `=`, empty member, empty value) is a usage error with exit code 2: `--days-off takes member=date+date pairs, got "<pair>"`, next step `Use --days-off ana=2026-10-16+2026-10-19`.
- Tracker contract: add `getDaysOff` and `updateCycleCapacity` to `TRACKER_OPERATIONS` in `scripts/lib/contract.mjs`. `setCapacity` keeps its signature and calls `updateCycleCapacity`.
- Do not edit `CHANGELOG.md` (written per release). Do not edit `.issues/` by hand.
- Code, tests, docs and commits in English. Every commit message carries `(PMK-4)` and ends with the trailer `Co-Authored-By: Claude <model of the implementer> <noreply@anthropic.com>`, naming the model that made the commit.
- Tests that create temporary directories outside `makeRepo` remove them in `finally`. Run one file with `node --test scripts/<file>.test.mjs`, everything with `npm test`.

## Review Focus

- A date on a Saturday or Sunday, one day before `start`, one day after `end`, and `start`/`end` themselves.
- `--days-off` alone must not touch `capacity`, and `--set` alone must not touch `days_off`.
- `member=none` on a member with no entry does nothing and does not error.
- A dry run changes no file. A rejected value leaves the file byte-identical.
- The JSON read shape changed. No remaining reader expects the flat capacity map (`grep -rn "cycle capacity" commands skills scripts README.md`).
- Unknown keys in the sprint file survive the write.

## Task 1: validation and tracker

Complexity: standard
Covers: `cycle capacity <id>` reads and sets days off per member (tracker half)

**Files:** modify `scripts/lib/local/sprints.mjs`, `scripts/lib/local/tracker.mjs`, `scripts/lib/contract.mjs`, `scripts/sprints.test.mjs`, `scripts/contract-suite.mjs`.

- [ ] Write failing tests in `scripts/sprints.test.mjs`, using `setup()` (fixture `team`, sprint `2026-10-12` runs 2026-10-12 to 2026-10-25, `ana` has `[2026-10-16]`):
  - `requireDaysOff` rejects: unknown member, `2026-02-30`, `2026-10-11` (before start), `2026-10-26` (after end), `2026-10-17` (Saturday), a repeated date, a non-array value. Each asserts `code('INVALID_INPUT', /pattern/)` with the messages in Global Constraints.
  - `requireDaysOff` accepts `2026-10-12` and `2026-10-23` and returns sorted lists (`['2026-10-19','2026-10-16']` becomes `['2026-10-16','2026-10-19']`).
  - `updateCycleCapacity` with `{ daysOff: { fred: ['2026-10-14'] } }` merges: file `days_off` is `{ ana: ['2026-10-16'], fred: ['2026-10-14'] }` and `capacity` is unchanged.
  - Replace: `{ daysOff: { ana: ['2026-10-19'] } }` gives `ana: ['2026-10-19']`.
  - Clear: `{ daysOff: { ana: null } }` removes the `ana` key.
  - `{ capacity, daysOff }` together make one write (`before`/`after` both change, one file write).
  - Dry run: `hashTree(root)` is equal before and after.
  - A rejected value leaves `hashTree(root)` equal.
  - `getDaysOff('2026-10-12')` returns `{ ana: ['2026-10-16'] }`, and `{}` for `2026-10-26`; unknown id is `NOT_FOUND`.
  - Existing `setCapacity` test still passes.
- [ ] Run `node --test scripts/sprints.test.mjs`; expect the new tests to fail.
- [ ] Implement `requireDaysOff(value, members, sprint)` in `sprints.mjs`, next to `requireCapacity`. `value` is a map of member to `string[] | null`. It returns the validated map with sorted lists, keeping `null` for clears. Weekday check: `new Date(\`${d}T00:00:00Z\`).getUTCDay()` is 0 or 6 means weekend. Export it.
- [ ] In `tracker.mjs` import it and add:

```js
const getDaysOff = (id) => getSprint(id).daysOff

function updateCycleCapacity(id, { capacity, daysOff } = {}, actor, { dryRun = false } = {}) {
  requireWriter(actor)
  const before = getSprint(id)
  const next = { ...before }
  if (capacity !== undefined) next.capacity = requireCapacity(capacity, local.members)
  if (daysOff !== undefined) {
    const merged = { ...before.daysOff }
    for (const [member, dates] of Object.entries(requireDaysOff(daysOff, local.members, before))) {
      if (dates === null) delete merged[member]
      else merged[member] = dates
    }
    next.daysOff = merged
  }
  return writeSprint(before, next, { dryRun })
}
```

  Rewrite `setCapacity(id, map, actor, opts)` as `return updateCycleCapacity(id, { capacity: map }, actor, opts)`. Export both in the returned object.
- [ ] Add both names to `TRACKER_OPERATIONS` in `contract.mjs`.
- [ ] In `scripts/contract-suite.mjs`, add a case after "sets and reads cycle capacity": open a cycle at `today`, pick the first weekday on or after `today` inside the sprint (the sprint is 14 days, so one exists), call `updateCycleCapacity(cycle.id, { daysOff: { [member.id]: [weekday] } }, actor)`, assert `getDaysOff` returns it, then clear with `null` and assert `{}`.
- [ ] Run `npm test`; expect all green. Commit: `feat: validate and store days off in the Local tracker (PMK-4)`.

## Task 2: CLI flag, read output, README

Complexity: standard
Covers: `cycle capacity <id>` reads and sets days off per member (CLI half)

**Files:** modify `scripts/pmkit.mjs`, `scripts/cli.test.mjs`, `README.md`.

- [ ] Update `scripts/cli.test.mjs` first. In the test "cycle capacity reads, and --set takes a list or repeated flags" change the read expectation to `{ capacity: { fred: 8, ana: 10 }, days_off: { ana: ['2026-10-16'] } }`. Add a test "cycle capacity --days-off sets, clears and validates" using `makeRepo('team')`:
  - `--days-off fred=2026-10-14+2026-10-13` gives `after.daysOff.fred` equal to `['2026-10-13','2026-10-14']` and keeps `ana`.
  - Repeated flag `--days-off fred=2026-10-14 --days-off ana=2026-10-19` sets both.
  - `--days-off ana=none` removes `ana` (`after.daysOff` has no `ana`).
  - Combined `--set fred=3 --days-off fred=2026-10-14` changes both in one result.
  - `--dry-run` leaves the file unchanged (read again and compare).
  - Text read output contains `days off` and `ana`.
  - Exit codes: `--days-off fred` and `--days-off =2026-10-14` and `--days-off fred=` exit 2; `--days-off fred=2026-10-17` (weekend) and `--days-off nobody=2026-10-14` exit 1 with `INVALID_INPUT` in the JSON error. Check the real exit code used for `INVALID_INPUT` in an existing test first and assert that one.
  - Check how the test file reads the sprint after a write, and use the same helper.
- [ ] Run `node --test scripts/cli.test.mjs`; expect failures.
- [ ] In `pmkit.mjs` add `parseDaysOff(ctx)` next to `parseCapacity`: for each pair of `csv(ctx.list('days-off'))` match `/^([^=]+)=(.+)$/`, else `usageError` with the message in Global Constraints. The value `none` maps to `null`, anything else splits on `+` into a list (an empty piece is a usage error).
- [ ] Change the command: `usage: '<id> [--set member=n,..] [--days-off member=date+date,..]'`, `summary: 'reads or sets capacity and days off'`, `flags: ['set', 'days-off']`. With neither flag: `data = { capacity: tracker.getCapacity(id), days_off: tracker.getDaysOff(id) }` and text from `fields` for capacity, then one `days off <member>: <dates joined by ", ">` line per member, or the empty text in Global Constraints. With a flag: call `tracker.updateCycleCapacity(id, { capacity: set ? parseCapacity(ctx) : undefined, daysOff: dayoff ? parseDaysOff(ctx) : undefined }, ctx.actor(), { dryRun: ctx.dryRun })`, same return as today.
- [ ] Update the README row: `| \`cycle capacity <id>\` | reads or sets capacity and days off (\`--set member=n,..\`, \`--days-off member=date+date,..\`) |`.
- [ ] Run `npm test`; expect green. Commit: `feat: add --days-off to cycle capacity (PMK-4)`.

## Task 3: /pmkit:cycle:plan stores days off

Complexity: mechanical
Covers: `/pmkit:cycle:plan` stores the days off it asks for

**Files:** modify `commands/cycle/plan.md`.

- [ ] Run `grep -rn "cycle capacity" commands skills` and confirm `commands/cycle/plan.md` step 7 is the only caller. If another caller exists, update it to the new read shape.
- [ ] Step 4: delete the sentence "The CLI cannot record days off, so they feed only this calculation." Replace it with "Days off must be weekdays inside the sprint dates, one date per day off. Step 7 stores them."
- [ ] Step 7: replace the capacity command with `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle capacity <id> --set <member>=<n>,<member>=<n> --days-off <member>=<date>+<date>,<member>=<date> --json`, "with the numbers and dates the user approved. Leave out a member with no days off. When the command fails, show the error and ask for a corrected date."
- [ ] Step 6 already shows days off; leave it. Check the Output and Confirmation sections for another mention that days off are not stored, and fix it.
- [ ] Run `npm test` (plugin tests lint command files); expect green. Commit: `docs: store days off from /pmkit:cycle:plan (PMK-4)`.
