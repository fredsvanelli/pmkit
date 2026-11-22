# PMK-355: cover the epic path of /pmkit:issues:move in the scenario tests

## Problem

`commands/issues/move.md` gained a `## Epic path` section in PMK-353. The scenario harness (`parseCommandFile` in `scripts/scenario-helpers.mjs`) reads only `## Steps` and `## If something is missing` as steps. Every other `##` section is `other`, and its calls are left out of rules 5, 6 and 9. So the epic path's `epic move` dry run, its confirmation and its real run are not checked. `scripts/__scenarios__/issues-move.mjs` excuses the path with `skip: { '1 epic get': … }` and `notHit: { 'Epic path, step 2': … }`. Only the runbooks' CLI calls cover it.

## Approaches

1. **Read `## <name> path` as steps with the prefix `<name> path`, add an epic scenario, and check rules 6 and 7 per command file** (chosen). The epic path's calls get the ids `Epic path 1` and `Epic path 3`, in the same form as a `### Heading` without a number. `issues-move.mjs` exports two scenarios: the issue one and an epic one on the team fixture's `EPC-2M9D`. A call or confirmation point counts as covered when any scenario of the same command uses or confirms it, or lists it in `skip` or `notHit`. That lets the issue scenario drop its epic entries, because the epic scenario covers them, and the reverse.
2. Keep rules 6 and 7 per scenario. Then the issue scenario would need new `skip` entries for the epic path calls, and the epic scenario would need entries for the issue path. The acceptance criteria ask to remove the epic entries from the issue scenario, which this cannot do.
3. Map only `Epic path` in `SECTIONS`. That gives the same result for this file, with no rule for the next path section. The `path` suffix rule is no wider, since only `move.md` has one today.

## Design

- `scripts/scenario-helpers.mjs`, `parseCommandFile`: a `##` heading ending in ` path` (`/^\S.* path$/`) is a steps section whose step ids carry the heading as prefix (`Epic path 1`), exactly as a `###` heading without a number does.
- Rules 6 and 7 per command file. `coverageProblems(calls, usedKeys, skip)` and `pointProblems(points, confirmed, notHit)` stay as they are. `runScenario` takes `siblings: { usedKeys, confirmed, skip, notHit }`, the union over the other scenarios of the same command, and treats a key or point there as used, confirmed or excused. Checks of a scenario's own entries stay per scenario: a stale `skip`, a `notHit` that this same scenario confirms, an empty reason. `scenarios.test.mjs` computes `siblings` statically from each other entry. Keys come from `matchEntry` on entries whose args are plain arrays; args that are functions of earlier results are left out, which is the conservative side. Confirms come from `confirm`.
- `scripts/__scenarios__/issues-move.mjs` exports an array:
  - 0: the issue scenario as it is, without `skip['1 epic get']` and `notHit['Epic path, step 2']`. `skip['3 discover']` stays: no scenario runs step 3.
  - 1: the epic scenario, `/pmkit:issues:move EPC-2M9D done`. The steps are `issues get EPC-2M9D` (step 1, expected `NOT_FOUND`), then `epic get EPC-2M9D` (step 1), then the `epic move EPC-2M9D done` dry run (`Epic path 1`), then `confirm: 'Epic path, step 2'`, then the real `epic move` (`Epic path 1`, via the dry run). It has no `skip` or `notHit` of its own. `expect` checks that the epic's status category is `done` and that one `move` event is in its `events.jsonl`.
- Snapshots: `issues-move.after.txt` becomes `issues-move.0.after.txt`, and `issues-move.1.after.txt` is new (`UPDATE_GOLDENS=1`).
- `scripts/scenario-helpers.test.mjs`: a test that `## Epic path` items get `Epic path N` ids, and a unit test of the sibling coverage. A key used only by a sibling is not a problem, and a key no scenario uses or skips is.

## Checks

- The epic scenario fails when the epic path's dry run is moved after the real run (rule 9), and when the confirmation is removed (rule 9 and rule 7). Shown with throwaway edits.
- Every other scenario passes unchanged.

## Interview

- Does the sibling rule weaken another command's checks? Only where a sibling uses the call. Commands with one scenario behave as before. Commands with several get the union, and no existing skip becomes an error.
- Is `EPC-2M9D` in a category where a move to `done` works? It is `in_progress`, and `done` has one status in the team fixture.
- Live runs (`scripts/scenarios-live.mjs`) read the same exports. An array is already supported.
- New terms or ADRs: none.
- Approval: there is no product question, and the acceptance criteria fix the outcome. The per-command rule is my call as the harness's design. It is stated in the PR.
