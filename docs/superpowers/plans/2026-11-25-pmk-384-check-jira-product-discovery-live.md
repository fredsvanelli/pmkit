# PMK-384 live Jira Product Discovery check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (small task, AGENTS.md). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check live that a site without Jira Product Discovery answers `available: false` with a hint that covers a site where JPD is not installed (AC 3).

**Architecture:** One read-only test in the opt-in harness `scripts/lib/jira/client-live.mjs` (PMK-381 pattern), and a reworded `IDEAS_HINT` in `scripts/lib/jira/ideas.mjs`, changed test-first.

**Tech Stack:** Node 18 ES modules, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-pmk-384-check-jira-product-discovery-live-design.md`

## Global Constraints

- The site host, the email and the token stay out of the repository, the PR, the issue and test output (`hostless`, `scrub`, `assertNoSecret`).
- Write only to Kudos; this plan writes nothing to Jira.
- New hint, verbatim: `Add Jira Product Discovery to ${site} and create a project there, or check that the token's owner can browse one`.

## Review Focus

- `--project <space>` on a site with no JPD project: `NOT_FOUND` whose next step is the new hint (Task 2 asserts it live; `ideas.test.mjs:229` on the fake).
- A connect with two keys of a software space: `NOT_FOUND` before any write (Task 2, `--dry-run`).
- A site that has a JPD project: the live test skips naming the follow-up instead of passing (Task 2).

---

### Task 1: Reword `IDEAS_HINT`

**Files:**
- Modify: `scripts/lib/jira/ideas.test.mjs:83`, `scripts/runbook-product-discovery-jira.test.mjs:165`, `scripts/lib/jira/ideas.mjs:7`, `docs/runbooks/product-discovery-jira.md` (step 10 and the Failures row)

- [ ] **Step 1:** In `ideas.test.mjs`, assert `IDEAS_HINT(SITE)` equals the new hint with `acme.atlassian.net`; in the runbook test set `hint` to the new text.
- [ ] **Step 2:** Run `node --test scripts/lib/jira/ideas.test.mjs scripts/runbook-product-discovery-jira.test.mjs`. Expected: FAIL on the hint text.
- [ ] **Step 3:** Change `IDEAS_HINT` in `ideas.mjs`; update the runbook's step 10 and Failures row.
- [ ] **Step 4:** Rerun Step 2's command. Expected: PASS.
- [ ] **Step 5:** Commit `fix: the Jira Product Discovery hint covers a site without it installed (PMK-384)`.

### Task 2: Live AC 3 test

**Files:**
- Modify: `scripts/lib/jira/client-live.mjs` (header comment; new test after the plans test; import `IDEAS_HINT`)

**Interfaces:** Consumes `liveRepo`, `INIT`, `acceptAll`, `client`, `NEEDS_SPACE`, `SPACE`, `SITE` from the same file; `IDEAS_HINT(site)` from Task 1.

- [ ] **Step 1:** Add `test('jira ideas answer available false on a site without Jira Product Discovery', { skip: NEEDS_SPACE }, ...)`:
  - raw `jira.paginate('/rest/api/3/project/search', { key: 'values' })`; if any `projectTypeKey === 'product_discovery'`, `t.skip` naming the follow-up;
  - `cli('jira','ideas','list')` and with `--limit 1`: `[available, reason, enableHint, site === SITE.toLowerCase(), ideas, hasMore]` deep-equals `[false, 'no_discovery_project', IDEAS_HINT(SITE.toLowerCase()), true, [], false]`;
  - `refused('jira','ideas','list','--project', SPACE)`: code `NOT_FOUND`, `nextStep` the hint;
  - `refused('jira','ideas','connect', `${SPACE}-1`, `${SPACE}-2`, '--dry-run')`: code `NOT_FOUND`.
- [ ] **Step 2:** Run live: `PMKIT_LIVE=1 PMKIT_LIVE_JIRA_SITE=<host> PMKIT_LIVE_JIRA_SPACE=KAN node --test --test-name-pattern "Product Discovery" scripts/lib/jira/client-live.mjs`. Expected: PASS, no host or credential in the output. Mutation check: break `reason` in `ideas.mjs` temporarily, see FAIL, restore.
- [ ] **Step 3:** Update the header comment (PMK-384) and the runbook's "Live check" line with the result.
- [ ] **Step 4:** `npm test` and `npm run lint` pass. Commit `test: check live that jira ideas answer available false without Jira Product Discovery (PMK-384)`.
