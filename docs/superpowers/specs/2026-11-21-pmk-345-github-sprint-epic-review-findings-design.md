# PMK-345: clean up the open review findings of the GitHub sprint and epic code

Issue: PMK-345 (EPC-8, chore). The findings `utils:review-work` left open on PMK-88 (PR #318). Related: PMK-336 (the earlier complexity list).

## Intent

Close four review findings without changing behavior, so the GitHub sprint and epic code stops carrying them.

## Findings and the fix of each

1. **Capacity store under `linear/`.** `scripts/lib/linear/capacity-store.mjs` (and its test) is used by both adapters (`linear/cycle-ops.mjs`, `linear/manifest.mjs`, `github/cycle-ops.mjs`, `github/manifest.mjs`). Move it with `git mv` to `scripts/lib/capacity-store.mjs` (test beside it) and fix the four imports. No re-export left behind.
2. **`classifyRest` untested cases** (`scripts/lib/github/client.mjs`). Two tests in `client.test.mjs`: a GET whose 2xx body is not JSON fails `UPSTREAM` "GitHub returned an unreadable answer (HTTP 200)" with no retry, and an `already_exists` error off a path that is not `/milestones` is `UPSTREAM` with GitHub's message, not `CONFLICT`. Both pass today: they pin existing behavior.
3. **The stale detail.** `sprintStep` (`scripts/lib/github/filter.mjs`) throws `INVALID_INPUT` "there is no active sprint" with `details: { stale: true }`, so `withRefresh` in `issue-ops.mjs` refreshes the discovery once and translates again. When the second translation throws the same error, it leaves with `stale: true`, a retry hint meant for `withRefresh` only. Fix in `withRefresh`: an error of the second build that carries `stale` is rethrown as the same `PmkitError` without that detail. Test first: `searchIssues({ sprint: 'current' })` with no active sprint, before and after a refresh, rejects with `details` holding no `stale`.
4. **Complexity 11 to 21** (ESLint `complexity`, measured 2026-11-21): `classifyRest` 13, `openCycle` 14, `moveToCycle` 18, `searchIssues` 21, `toIssueWithWarnings` 21, `problemOf` 17, `fieldValue` 15, `bodyOf` 11, `epicInput` 14, `createDeliverable` 17, `applyPlan` 11. The criterion: each at 10 or less, or listed in PMK-336.

## Approaches for finding 4

1. **Split the nine not yet in PMK-336, and leave `searchIssues` and `fieldValue` to PMK-336, which already lists both (chosen).** Each split extracts a named helper for one concern (a guard block, a per-kind branch), with no behavior change and the existing tests as the net. PMK-336 stays the one place for the bigger splits.
2. **Split all eleven.** `searchIssues` is the read path PMK-344 changes, and `fieldValue` is in PMK-336 with others in the same file. More churn for no reader gain now.
3. **List all eleven in PMK-336.** Meets the criterion on paper and fixes nothing. Rejected.

## Order

PMK-344 changes `moveToCycle` (one read per issue) and the sprint read. This issue lands after PMK-344, so the split of `moveToCycle` is of its new form.

## Tests

- No behavior change: `npm test` and `npm run lint` pass, and the complexity check (`npx eslint@10.15.0 --no-config-lookup --rule '{"complexity":["warn",10]}'` on the touched files) reports none of the nine.
- New tests: the two `classifyRest` cases, and the stale-detail test (fails before the fix).
- E2E: the sprint and epic runbook test (`scripts/runbook-cycles-epics-github.test.mjs`) and the issues runbook test run unchanged.

## Left to the builder

Helper names; whether `problemOf`'s split is a table or helpers.

## Interview

Approved on 2026-11-21 by the pmkit PO on the owner's behalf: the issue's acceptance criteria and this design, with no open product question. The questions the grilling raised and the answers taken (the recommended ones):

- `searchIssues` and `fieldValue` stay listed in PMK-336 instead of being split here: yes, the criterion allows it, and PMK-344 changes `searchIssues`' neighbors.
- The capacity store moves with no re-export left at the old path: yes, every import is in this repository.
- This issue lands after PMK-344: yes.
- No new term for `CONTEXT.md` and no ADR.
