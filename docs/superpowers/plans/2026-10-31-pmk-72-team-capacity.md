# PMK-72 team-capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `pmkit team capacity` and `/pmkit:team:capacity`, which show and change the capacity and days off of each member for a sprint after a confirmation.

**Architecture:** A pure module `scripts/lib/team-capacity.mjs` holds the parsing, merging and diffing. `runTeamLoad` in `scripts/pmkit.mjs` becomes `teamLoadReport`, shared by `team load` and the new `runTeamCapacity`. The write is one `tracker.updateCycleCapacity` call, so no new storage exists.

**Tech Stack:** Node, `node:test`, no dependencies (ADR-0003).

**Spec:** `docs/superpowers/specs/2026-10-31-pmk-72-team-capacity-design.md`

## Global Constraints

- Names and units equal those of `scripts/lib/team-load.mjs`: `capacity`, `daysOff`, `unit` (`points`, `hours`, `issues`), `flags`, `imbalances`.
- Unset capacity is `null`, never 0.
- Every commit message carries `(PMK-72)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Keep edits to `README.md`, `CHANGELOG.md`, `skills/pmkit/SKILL.md` and `scripts/lib/args.mjs` small. Do not touch the Local tracker store.
- Tests never run the CLI inside `scripts/__fixtures__/`. Use `makeRepo`.

## Review Focus

- `--set ana=6` must keep the capacity of every other member (merge, not replace). Test in Task 2.
- A bad member or date in a batch writes nothing, for all members. Test in Task 2.
- `--sprint current` with no active sprint fails with `NOT_FOUND`. Test in Task 2.
- On Linear, a member outside `tracker.scope.team` and an agent are refused, and a write only creates `.pmkit/capacity.yaml` and sends no mutation. Test in Task 2.
- A cut issue read (`hasMore`) makes `load` null with a warning, and the write still works. Test in Task 2.

---

### Task 1: Pure helpers and the shared load report

**Files:**
- Create: `scripts/lib/team-capacity.mjs`, `scripts/team-capacity.test.mjs`
- Modify: `scripts/pmkit.mjs` (`runTeamLoad` becomes `teamLoadReport`)

**Interfaces:**
- Produces in `team-capacity.mjs`:
  - `parseCapacityPairs(pairs: string[]) -> Record<string, number|null>` (`none` gives `null`; throws `PmkitError` `INVALID_INPUT` for a bad pair or a duplicate member)
  - `workingDays(sprint: {start, end}, daysOff: string[]) -> number` (weekdays inside the sprint minus the days off)
  - `mergeCapacity(current, set) -> Record<string, number>` (a `null` removes the member)
  - `checkMembers(names: string[], humans: string[], teamKey?: string) -> void` (throws `INVALID_INPUT`; agent names get the delegate next step)
  - `changeList(before: {capacity, daysOff}, after: {capacity, daysOff}, members: string[]) -> Array<{member, capacity: {before, after}, daysOff: {before, after}}>` (only members whose values differ; `null` for unset)
- Produces in `pmkit.mjs`: `async function teamLoadReport(ctx, { sprint, requireSprint, capacity, daysOff })` returning `{ data, warnings, notes, sprint, tracker }`. `capacity` and `daysOff` replace the stored maps when given. `requireSprint` throws `NOT_FOUND` (next step `/pmkit:cycle:plan`) when no sprint is in scope.

- [ ] **Step 1: Write failing unit tests** in `scripts/team-capacity.test.mjs`: `workingDays({start:'2026-10-12', end:'2026-10-25'}, ['2026-10-16'])` is 9; `parseCapacityPairs(['ana=6','fred=none'])` equals `{ana: 6, fred: null}`; `parseCapacityPairs(['ana=x'])` throws `INVALID_INPUT`; `mergeCapacity({fred: 8, ana: 10}, {ana: 6})` equals `{fred: 8, ana: 6}`; `mergeCapacity({fred: 8}, {fred: null})` equals `{}`; `checkMembers(['agent:claude'], ['fred'])` throws with a message naming `/pmkit:issues:delegate`; `checkMembers(['zed'], ['fred','ana'])` lists `fred, ana`; `changeList` leaves out an unchanged member and gives `null` for an unset value.
- [ ] **Step 2: Run** `node --test scripts/team-capacity.test.mjs`. Expect FAIL (module missing).
- [ ] **Step 3: Implement the module** with the signatures above.
- [ ] **Step 4: Refactor** `runTeamLoad` into `teamLoadReport` and make `runTeamLoad` call it, returning the same `{data, text, warnings, notes}`.
- [ ] **Step 5: Run** `node --test scripts/team-capacity.test.mjs scripts/cli-team-load.test.mjs scripts/team-load.test.mjs`. Expect PASS, `team load` output unchanged.
- [ ] **Step 6: Commit** `feat(team): add the team-capacity helpers and share the load report (PMK-72)`.

### Task 2: The `team capacity` CLI command

**Files:**
- Modify: `scripts/pmkit.mjs` (new `COMMANDS` entry after `team load`, `runTeamCapacity`), `scripts/capabilities.mjs` only if `SERVED_BY` needs `team capacity` (read it and add `team capacity` to the `capacity` list only if the contract test demands it)
- Test: `scripts/cli-team-capacity.test.mjs`

**Interfaces:**
- Consumes: Task 1 helpers and `teamLoadReport`.
- Produces: the command `team capacity`, `write: true`, `readUnless: ['set', 'days-off']`, `flags: ['sprint', 'set', 'days-off']`. Results as in the spec, with `notes` and `warnings` also inside the JSON.

- [ ] **Step 1: Write failing tests** on `makeRepo('team')` with `PMKIT_USER=fred` and `PMKIT_NOW=2026-10-23T12:00:00Z`:
  - read: sprint `2026-10-12`, `unit` `points`, ana has capacity 10, days off `['2026-10-16']`, `workingDays` 9, flags `over_average` and `over_capacity`; nothing written.
  - `--set ana=12 --dry-run`: `changes` has ana only with capacity `{before: 10, after: 12}`, `load.after` no longer has `over_capacity` for ana, and the sprint file is unchanged.
  - `--set ana=12` (real): fred keeps 8 (merge); `cycle capacity 2026-10-12 --json` shows `{fred: 8, ana: 12}`.
  - `--set fred=none` removes fred's capacity, and the read shows `null`.
  - batch `--set ana=1,fred=2 --days-off ana=2026-10-17`: exit 2 (Saturday), and both capacities are unchanged afterwards.
  - `--days-off ana=2026-10-16` again: `changes` is empty and the text says `no change`.
  - `--days-off ana=2026-10-16+2026-10-16` and `--days-off ana=2026-11-02` and `--days-off ana=16/10`: exit 2 `INVALID_INPUT`.
  - `--set agent:claude=3` and `--set zed=3`: exit 2, nothing written.
  - `--sprint current` equals the default. A repo with no active sprint (`no-sprints` copy) fails with `NOT_FOUND`.
  - `--sprint 2026-09-28` reads the closed sprint.
  - hasMore: `load` is null and a warning says the effect is not verified (use the helper other tests use to cut the read, or stub `searchIssues` through the fake Linear fetch).
- [ ] **Step 2: Run** `node --test scripts/cli-team-capacity.test.mjs`. Expect FAIL.
- [ ] **Step 3: Implement `runTeamCapacity(ctx)`**: resolve the sprint through `teamLoadReport` (requireSprint), take the human members of its rows, validate with `checkMembers`, merge, call `updateCycleCapacity` once with the full capacity map and the days-off patch, compute `load.after` with `teamLoadReport` and the resulting maps (on a dry run the result's `after`, on a real run the same maps), and return the text (a table, then the changes and the flag effect). A real run returns `commit: sprint.id`.
- [ ] **Step 4: Add Linear tests** in the same file with the fake Linear helpers of `scripts/cli-linear.test.mjs` (`cycleCli`): a member of another team is refused, an agent is refused, a write creates `.pmkit/capacity.yaml` and the fake API records no mutation, and the read and write notes appear in stderr and in the JSON.
- [ ] **Step 5: Add the note** `capacity and days off written to .pmkit/capacity.yaml; Linear was not changed` (`would write` on a dry run) when the `capacity` entry has path `derived`, next to the existing `capabilityNotes` call.
- [ ] **Step 6: Run** `node --test scripts/cli-team-capacity.test.mjs scripts/cli-degraded-coverage.test.mjs scripts/capabilities.test.mjs scripts/cli-autocommit.test.mjs`. Expect PASS.
- [ ] **Step 7: Commit** `feat(team): add the team capacity command (PMK-72)`.

### Task 3: The command file, scenario, counts and docs

**Files:**
- Create: `commands/team/capacity.md`, `scripts/__scenarios__/team-capacity.mjs` (and its generated `.after.txt`)
- Modify: `scripts/scenarios.test.mjs` (39 to 40 command files), `scripts/scenarios-live.mjs` (the LIVE_EXPECT_STOPS entry and its count comment if the new scenario saves reads), `scripts/plugin.test.mjs` (`team` list), `README.md`, `skills/pmkit/SKILL.md`, `CHANGELOG.md`

- [ ] **Step 1: Write the command file** per the spec, with the steps, "Confirmation points", "Output" and "If something is missing" sections. Repeat only messages that exist in the JSON. Say what happens when the write fails (one call, nothing written) and that a cut load read means the effect is not verified.
- [ ] **Step 2: Write the scenario** on the `team` fixture: read, a bulk dry run (`--set ana=12,fred=9 --days-off fred=2026-10-14`), confirm, write, read again. `expect` checks the sprint file and the flag change.
- [ ] **Step 3: Update the counts, the `COMMANDS` list, README table and list, SKILL.md row and the CHANGELOG line** under `## Unreleased`, top.
- [ ] **Step 4: Generate snapshots** with `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, read `git diff scripts/__scenarios__/`, then run `npm test`. Expect PASS.
- [ ] **Step 5: Tick the criterion** with `node scripts/pmkit.mjs issues update PMK-72 --check 1` (dry run first), run `superpowers:verification-before-completion`, and commit `feat(team): add /pmkit:team:capacity (PMK-72)`.
