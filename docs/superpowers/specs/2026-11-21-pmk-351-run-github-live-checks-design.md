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

Run on 2026-11-21T22:11:44Z from `develop` at `7bca2c83` (PMK-349 merged), pmkit 0.6.1 (`.claude-plugin/plugin.json`), gh 2.96.0, Node 22.22.0, against github.com: repository `fredsvanelli/pmkit` and the throwaway Project `fredsvanelli/2` (https://github.com/users/fredsvanelli/projects/2), titled `pmkit-live checks`, with an iteration field `Sprint` holding `Sprint 2` (2026-11-16) and `Sprint 3` (2026-11-30). Command: `PMKIT_LIVE=1 PMKIT_LIVE_GITHUB_REPO=fredsvanelli/pmkit PMKIT_LIVE_GITHUB_PROJECT=fredsvanelli/2 node --test-reporter=tap scripts/lib/github/client-live.mjs`, exit 0, 18 s.

| Check | Result | What it printed |
|---|---|---|
| no `gh` login is AUTH | pass | AUTH "GitHub CLI is not logged in", next step `gh auth login` |
| a token GitHub does not know is AUTH | pass | AUTH "GitHub rejected the token of the gh login" (HTTP 401) |
| a repository that does not exist is NOT_FOUND | pass | NOT_FOUND, type NOT_FOUND |
| the rate-limit headers fill the GraphQL bucket | pass | 4982 of 5000 left on graphql, with the reset time |
| a token without the `project` scope is AUTH | skip | no `PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN`: a classic token without the `project` scope is the owner's to create |
| discover reads a repository with a Project | pass | issue types 3, issue fields 0, Project fields 14 (iteration 1), Status options 3, capabilities 20 |
| openCycle keeps every item's iteration | pass | added the sprint 2026-12-14; 2 items kept their iteration; deleted both drafts; restored the 2 iterations of `Sprint` |
| a draft converts into an issue on GHES | skip | no GHES host is available (the owner's decision, 2026-11-21) |

No check failed, so no issue was opened. After the run the Project held no item and its iteration field held `Sprint 2` and `Sprint 3` with their ids; it was then unlinked from the repository and closed.

Also checked on this Project before the run, for PMK-344 (PR #334), with two draft items: GitHub's Project filter `sprint:"Sprint 2"` matches by the iteration field's name without case, `iteration:"Sprint 2"` matches nothing for a field named `Sprint`, and `is:issue` keeps draft issues.

## Interview

Approved on 2026-11-21 by the pmkit PO on the owner's behalf (option A). The questions the grilling raised and the answers taken (the recommended ones):

- The repository the checks read: `fredsvanelli/pmkit`, the owner's own; the checks write nothing to it. The Project is unlinked and closed after the run.
- The missing-scope check: skipped unless the owner provides a scopeless classic token; creating tokens is the owner's.
- A failure found by the run: its own issue under EPC-8, related to PMK-351, so the epic closes only once each is decided.
- No new term for `CONTEXT.md` and no ADR.
