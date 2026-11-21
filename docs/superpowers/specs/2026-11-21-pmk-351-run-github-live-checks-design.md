# PMK-351: run the GitHub live checks against github.com and GHES and record the result

Issue: PMK-351 (EPC-8, task). Related: PMK-335 (PR #327) built the checks, PMK-349 cleans up an interrupted run.

## Intent

The live checks (`scripts/lib/github/client-live.mjs`, runbook `docs/runbooks/live-checks-github.md`) have only run against fakes. Run them once against github.com, so the client's error shapes, `discover`, `openCycle` and the iteration ids PMK-88 relies on are confirmed on a real host, and record the result.

## Decisions from the owner (2026-11-21, relayed by the PO)

- Option A: the `gh` login of this machine now has the `project` scope; the run uses a throwaway Project on the owner's github.com account.
- No GHES host is available: the GHES check is recorded as skipped, with that reason.

## Goals, non-goals, anti-goals

- Goal: every github.com check ran, and the result per check is recorded with the date, pmkit version, host and `gh` version.
- Goal: the throwaway Project is empty after the run.
- Non-goal (issue): fixing a failing check. Each failure gets its own issue, linked to this one.
- Anti-goal: a write to anything but the throwaway Project; a token in any output or file.

## Plan of the run (this is a task with no product code; the steps follow the runbook)

1. Run the checks from `develop` after PMK-349 merged, so an interrupted run cleans up after itself.
2. Prepare (runbook "Prepare the accounts"): create a Project on the owner's account titled `pmkit-live checks` (`gh project create`), link it to `fredsvanelli/pmkit` (`gh project link`), add an iteration field with one iteration (`createProjectV2Field` with `dataType: ITERATION` through `gh api graphql`, as `gh project field-create` has no iteration type). The repository is the owner's own; the github.com checks add no issue to it. Leave the Project empty.
3. The missing-scope check needs a classic token without the `project` scope, which only the owner can create; it is recorded as skipped with its reason unless the owner provides one.
4. Run `PMKIT_LIVE=1 PMKIT_LIVE_GITHUB_REPO=fredsvanelli/pmkit PMKIT_LIVE_GITHUB_PROJECT=fredsvanelli/<n> node --test scripts/lib/github/client-live.mjs` and keep the TAP output (no token in it; the checks never print one).
5. Check the Project is empty (`gh project item-list`), then unlink it from the repository and close it, so it leaves no trace in the repository's Projects tab. Its URL goes in the record.
6. Record (below, section "Result", and as a comment on PMK-351): date, pmkit version (`package.json` / plugin manifest), host, `gh` version, and pass, fail or skip per check, with each skip's reason. Open one issue per failure, linked `related` to PMK-351, under EPC-8.

## Check (SPEC-SS C)

The runbook test (`scripts/runbook-live-checks-github.test.mjs`) is the E2E of the flow; it runs in `npm test`. If the real run shows the runbook is wrong (a step, an expected line), the runbook and its test change in this branch.

## Result

Filled in by the run.

## Interview

Approved on 2026-11-21 by the pmkit PO on the owner's behalf (option A). The questions the grilling raised and the answers taken (the recommended ones):

- The repository the checks read: `fredsvanelli/pmkit`, the owner's own; the checks write nothing to it. The Project is unlinked and closed after the run.
- The missing-scope check: skipped unless the owner provides a scopeless classic token; creating tokens is the owner's.
- A failure found by the run: its own issue under EPC-8, related to PMK-351, so the epic closes only once each is decided.
- No new term for `CONTEXT.md` and no ADR.
