# PMK-381 live Jira plans check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (a small task, per AGENTS.md) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only, opt-in live test that checks `jira plans list` and `jira plans get` answer `available: false` on a site without Premium, plus the runbook's live-check record and the EPC-14 follow-ups.

**Architecture:** One more `test(...)` in `scripts/lib/jira/client-live.mjs`, reusing `client()`, `liveRepo()`, `INIT()`, `acceptAll()`, `failure()` and `NEEDS_SPACE`. No product code changes unless the live run differs from the fake.

**Tech Stack:** Node 18+ ES modules, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-pmk-381-check-jira-plans-live-design.md`

## Global Constraints

- The site host, the email, the token and the account id stay out of the repository, the PR and the issue.
- No write to the site: the test only reads.
- `npm test` does not load `client-live.mjs`; run it with `PMKIT_LIVE=1 PMKIT_LIVE_JIRA_SITE=<host> PMKIT_LIVE_JIRA_SPACE=<key> node --test --test-name-pattern "Premium" scripts/lib/jira/client-live.mjs`.

## Review Focus

- A Premium or Enterprise site: the test must skip with a reason naming the follow-up, never report a pass.
- A license read that fails (403 for a non-admin): `failure` throws a non-PmkitError otherwise; treat an unread license as "not known Premium" only if the Plans 403 still holds, else fail.
- A CLI answer naming the site: `liveRepo` `assertNoSecret` covers the credential; `scrub` covers the host on failure.

---

### Task 1: The live test, the runbook record and the header comment

**Files:**
- Modify: `scripts/lib/jira/client-live.mjs` (header comment; new test after the time tracking test)
- Modify: `docs/runbooks/plans-jira.md` (the "Live check" paragraph)

**Interfaces:**
- Consumes: `client()`, `failure(promise)`, `liveRepo() -> { cli, refused, cleanup }`, `INIT()`, `acceptAll(proposal)`, `NEEDS_SPACE`, `SPACE`; `PLANS_HINT` from `./plans.mjs`.

- [ ] **Step 1: Write the test** `test('jira plans answer available false on a site without Premium', { skip: NEEDS_SPACE }, ...)`:
  - `plan` = raw `GET /rest/api/3/instance/license` → `applications.find(id === 'jira-software')?.plan`; `t.skip('the site is on Jira <plan>: the Premium checks are an EPC-14 follow-up')` when `PREMIUM` or `ENTERPRISE`.
  - `const refusal = await failure(jira.request('GET', '/rest/api/3/plans/plan'))`; assert `[refusal.code, refusal.details.jira.status] == ['AUTH', 403]`.
  - `liveRepo`, `init` with `acceptAll`; `cli('jira', 'plans', 'list')` deep-equals `{ available: false, reason: 'premium', enableHint: PLANS_HINT, site: <lowercased SITE>, plans: [], hasMore: false }` (compare fields, not the site, to keep the host out of a diff: assert `list.site === SITE.toLowerCase()` with `assert.ok`); same with `--archived --trashed --limit 1`; `cli('jira', 'plans', 'get', '1')` has `available false`, `reason premium`, `enableHint PLANS_HINT`; `refused('jira', 'plans', 'get', 'abc').code === 'INVALID_INPUT'`.
  - `t.diagnostic(\`license ${plan}; Plans 403; list and get available false\`)`; `cleanup()` in `finally`.
- [ ] **Step 2: Run it live** with the command in Global Constraints (pattern `Premium`). Expected: 1 pass; a difference is a bug to fix test-first in the product code.
- [ ] **Step 3: Run `npm test` and `npm run lint`.** Expected: pass (the live file is not loaded by `npm test`; lint covers it).
- [ ] **Step 4: Header and runbook.** Header comment: one sentence for PMK-381. Runbook "Live check": run on 2026-11-25 on a Jira Free site (host kept out): step 6 passed live (the 403 names the Administer Jira permission even for an admin, so pmkit's one hint stays); steps 2–5 need Premium and are skipped, open as the EPC-14 follow-up.
- [ ] **Step 5: Commit** `test: check live that jira plans answer available false without Premium (PMK-381)`.

### Task 2: Follow-ups and the issue record

- [ ] **Step 1:** `node scripts/pmkit.mjs issues create` three EPC-14 chores (`--parent EPC-14`, milestone `jira`): "Check the Jira plans flows on a Premium site" (ACs 1, 2, 4 of PMK-381 and AC 3's non-admin half); "The fake Jira's remaining estimate assumes no estimate is set" (from PMK-378); "events --since reads the date in UTC, not the user's zone" (from PMK-378). Link each `related` to its source issue (PMK-381, PMK-378).
- [ ] **Step 2:** Add the Result section to the design doc (table per AC: pass / skipped and why).
- [ ] **Step 3: Commit** `chore: record the PMK-381 live result and its follow-ups (PMK-381)`.
