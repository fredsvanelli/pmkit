# PMK-364 Check the Jira Client Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the unknown-site answer of the Jira client and ship an opt-in live check that reruns the PMK-364 checks.

**Architecture:** One branch in `loadSession()` of `scripts/lib/jira/client.mjs` turns a 404 on `serverInfo` into `NOT_CONFIGURED`. A new `scripts/lib/jira/client-live.mjs` (node:test, never loaded by `npm test`) runs the checks against the site named by `PMKIT_LIVE_JIRA_SITE`.

**Tech Stack:** Node 18+ ES modules, `node:test`, global `fetch`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-pmk-364-check-jira-client-live-design.md`

## Global Constraints

- No dependency (ADR 0003). `npm test` and `npm run lint` pass.
- The token, the email, the `Authorization` header, the site host and the owner's account id never reach the repository or any output.
- Writes go only to `PMKIT_LIVE_JIRA_SPACE`; everything created is deleted.
- No deliberate burst for a 429 (interview Q3).

## Review Focus

- A real site whose `serverInfo` 404s for another reason (a proxy, a path change): it now reads as `NOT_CONFIGURED`, naming the site; acceptable since `serverInfo` is the first call and the site is the only input. Pinned by the unit test.
- `discover` on a wrong `tracker.scope.site` gets the same new error (shared session); no extra test, same code path.
- The live check run with `PMKIT_LIVE` unset must send nothing: every test skips with a reason (Task 2 step 2).
- The write round trip must delete even when an assertion fails (`finally`).
- A scoped-token test without `PMKIT_LIVE_JIRA_SCOPED_TOKEN` skips, never fails.

---

### Task 1: an unknown site is NOT_CONFIGURED

**Files:**
- Modify: `scripts/lib/jira/client.mjs` (`loadSession`)
- Test: `scripts/lib/jira/client.test.mjs`, `scripts/runbook-setup-jira.test.mjs`
- Docs: `docs/runbooks/setup-jira.md` (new error step after step 9, renumber 10 to 11)

- [ ] **Step 1: failing unit test** `a site where serverInfo is 404 is NOT_CONFIGURED and myself is never called`: route `'GET /rest/api/3/serverInfo': { status: 404, text: '<!DOCTYPE html>' }`; `assertError(..., 'NOT_CONFIGURED', 'No Jira site answers at acme.atlassian.net', 'Check the site host in tracker.scope.site, or --site in /pmkit:setup')`; calls are only serverInfo.
- [ ] **Step 2:** `node --test scripts/lib/jira/client.test.mjs` fails (gets `NOT_FOUND`).
- [ ] **Step 3:** in `loadSession`'s catch, `if (error instanceof PmkitError && error.code === 'NOT_FOUND') throw new PmkitError('NOT_CONFIGURED', \`No Jira site answers at ${site}\`, 'Check the site host in tracker.scope.site, or --site in /pmkit:setup')`.
- [ ] **Step 4:** unit test passes.
- [ ] **Step 5: runbook step + test.** `setup-jira.md` new step 10: "A `--site` where no Jira site answers (a typo, a deleted site) fails with `NOT_CONFIGURED`, `No Jira site answers at <site>`. Nothing is written." Extend the errors test of `runbook-setup-jira.test.mjs` with route `{ 'GET /rest/api/3/serverInfo': { status: 404, text: 'Not Found' } }` → code `NOT_CONFIGURED`, message contains `No Jira site answers at acme.atlassian.net`; add `No Jira site answers at` to the "runbook names" strings if that test lists messages. Run it red first (runbook text missing), then green.
- [ ] **Step 6:** commit `fix: an unknown Jira site is NOT_CONFIGURED (PMK-364)`.

### Task 2: opt-in live check

**Files:**
- Create: `scripts/lib/jira/client-live.mjs`

Header comment: usage line `PMKIT_LIVE=1 PMKIT_LIVE_JIRA_SITE=<host> [PMKIT_LIVE_JIRA_SPACE=<key>] [PMKIT_LIVE_JIRA_SCOPED_TOKEN=<token>] node --test scripts/lib/jira/client-live.mjs` with `JIRA_EMAIL`/`JIRA_API_TOKEN` exported; not loaded by `npm test`.

Skip reason: `set PMKIT_LIVE=1 to run the live check`, then `set PMKIT_LIVE_JIRA_SITE to the Jira Cloud site host`, then `JIRA_EMAIL and JIRA_API_TOKEN are not usable: <message>` (via `jiraCredential`). Per-test extra: `set PMKIT_LIVE_JIRA_SCOPED_TOKEN to a scoped API token to check it on the site host`, `set PMKIT_LIVE_JIRA_SPACE to the key of a throwaway space to check a write`.

Tests (names and assertions from the spec table, Q3 row as amended):
1. `anonymous serverInfo says Cloud` — direct fetch, no Authorization, 200, `deploymentType === 'Cloud'`.
2. `the token passes the session check on the site host` — `session()`: `source`, `site`, non-empty `viewer.accountId`; diagnostic prints `viewer: set`.
3. `a scoped token passes the session check on the site host` — same with `JIRA_API_TOKEN` replaced.
4. `a wrong token is AUTH` — token `ATATT` + 40 random hex; code `AUTH`, message matches `/may have expired/`.
5. `an unknown site is NOT_CONFIGURED` — site `pmkit-live-<random hex>.atlassian.net`; code `NOT_CONFIGURED`.
6. `a normal answer carries the rate-limit headers` — raw authenticated GET `/rest/api/3/myself`: `x-ratelimit-limit` and `x-ratelimit-remaining` are integers.
7. `a work item round trip in the throwaway space` — GET `/rest/api/3/project/<space>` first; pick the space's first non-subtask issue type from `issueTypes`; POST `/rest/api/3/issue` summary `pmkit-live client check`; GET it; DELETE in `finally`; GET after delete is `NOT_FOUND`.

Every error a test catches is checked: no token, email or header in message, nextStep, details.

- [ ] **Step 1:** write the file.
- [ ] **Step 2:** `node --test scripts/lib/jira/client-live.mjs` with no `PMKIT_LIVE`: 7 skipped, exit 0.
- [ ] **Step 3:** `npm test` does not run it (name lacks `.test.mjs`) and passes; `npm run lint` passes.
- [ ] **Step 4:** live run with the owner's site, `PMKIT_LIVE_JIRA_SPACE=KAN`: 6 pass, scoped skipped. Check Kudos holds no issue after.
- [ ] **Step 5:** commit `test: opt-in live check of the Jira client (PMK-364)`.

### Task 3: record the result

- [ ] Add a "Result" section to the spec: date, Node version, per-check pass/fail/skip with the skip reasons (scoped: no scoped token; 429: not provoked, interview Q3). Site host and space key stay out of the repository.
- [ ] Update the "Live check: skipped" line of `docs/runbooks/setup-jira.md`? No: that is the setup live check (EPC-14), not this one. Leave it.
- [ ] Commit `docs: record the PMK-364 live result (PMK-364)`.
