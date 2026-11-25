# PMK-381: check the Jira plans flows against a live site

Issue PMK-381 (EPC-14, chore), follow-up of PMK-82. Written on 2026-11-25 by a dispatched worker; the owner's answers come through the coordinator. A small change: a short design.

## Intent

PMK-82 built `jira plans list` and `jira plans get` (`scripts/lib/jira/plans.mjs`) from Atlassian's OpenAPI document and checked them only on the fake Jira. Run the `plans-jira` runbook's flows on the owner's site, settle what the fake assumed, and leave a check that reruns in one line (the opt-in harness of PR #391, `scripts/lib/jira/client-live.mjs`, `PMKIT_LIVE`).

## Acceptance criteria (from the issue)

1. The Plans reads (`plans/plan`, `plan/{id}`, `plan/{id}/team`, the `planonly` and `atlassian` team reads) answer the shapes the PMK-82 design lists.
2. The plan list and the team list page with `cursor`, `nextPageCursor` and `last`, as `client.paginate` reads them.
3. A Standard site, and a Premium site whose token owner lacks Administer Jira, both answer 403, and `jira plans list` shows `available: false` with the hint.
4. The capacity unit pmkit shows matches what Jira Plans shows.

## What a live probe found (2026-11-25)

Site: the owner's (host, email and token kept out of the repository, the PR and the issue). Read-only: nothing was written to Kudos or anywhere else.

- `GET /rest/api/3/instance/license`: `{ applications: [{ id: "jira-software", plan: "FREE" }] }`. The site is on **Jira Free**, not Premium, and not Standard.
- The token's owner **has** Administer Jira (`mypermissions` `ADMINISTER.havePermission: true`; not `SYSTEM_ADMIN`).
- Every Plans read (`plans/plan`, `plans/plan/1`, `plans/plan/999999`, `plan/1/team`, `team/planonly/1`, `team/atlassian/1`, and `client.paginate` on the list) answers **403** with `errorMessages: ["Você não tem a permissão global de Administrar o Jira"]` ("you lack the Administer Jira global permission"), whatever `Accept-Language` says. On a Free site Jira blames the permission even when the owner has it, so the 403 cannot tell edition from permission apart: PMK-82's single hint naming both is right.
- The client maps it to `AUTH` with `details.jira.status` 403 and no captcha, which `plans.mjs` reads as the Premium refusal.
- The real CLI on a repository set up on Kudos: `jira plans list` and `jira plans get 1` (text and `--json`, with `--archived --trashed --limit 1` too) exit 0 with `available: false`, `reason: premium` and the hint, `plans: []` and `hasMore: false` on the list; `jira plans get abc` is `INVALID_INPUT` before any call.

So AC 3 holds for a non-Premium site (Free here, Standard not available), and ACs 1, 2 and 4 cannot be reached: they need a Premium or Enterprise site.

## Approaches

- **A. One read-only live test in `client-live.mjs` (recommended).** The PMK-367 to PMK-378 pattern: read the license raw; on a site that is not Premium or Enterprise, check the raw 403 on the list, then run the real CLI (`liveRepo`, `init` with every recommendation) and check the off answers above. On a Premium or Enterprise site the test skips with a reason that names the follow-up (below), so it never reports a pass it did not check.
- **B. Also write the Premium checks (shapes, cursor paging, capacity unit) now.** They could not run on this site, so they would ship unverified, and the first Premium run would debug them anyway. Rejected: the follow-up writes them against a real Premium answer.
- **C. A new harness, or a Premium trial on the owner's site.** The task says reuse PR #391's harness; changing the site's plan is a site-wide write outside Kudos. Rejected.

A.

## Design (approach A)

- `test('plans on a site without Premium', { skip: NEEDS_SPACE })` in `client-live.mjs`, read-only, nothing to clean up but the temporary repository. Steps: raw license plan; skip when it is `PREMIUM` or `ENTERPRISE`; raw `GET plans/plan` fails `AUTH` with status 403; CLI `jira plans list` and `jira plans get 1` (`--json`) answer `available: false`, `reason: premium`, `enableHint` = `PLANS_HINT`, and the list `plans: []`, `hasMore: false`; `jira plans get abc` is `INVALID_INPUT`. Output prints the license plan and the codes only; `assertNoSecret`, `scrub` and `hostless` cover every answer.
- Test-first: the test is written and run before any other change; it is a characterisation of code that already behaves, so it passes on its first live run unless the site disagrees. No product code changes unless the run finds a difference.
- `docs/runbooks/plans-jira.md`: the "Live check" line records the run, what passed and what is skipped, and that Jira's 403 on a non-Premium site names the permission even for an admin.
- The header comment of `client-live.mjs` names PMK-381.
- No `CONTEXT.md` term, no ADR: nothing here is hard to reverse.

## Follow-ups (EPC-14)

- Check the Jira plans flows on a Premium site: ACs 1, 2 and 4, and the Premium site with a token owner lacking Administer Jira (AC 3's second half). Linked to PMK-381.
- From PMK-378: the fake's remaining estimate (`timeestimate` item) assumes no estimate is set.
- From PMK-378: `events --since` takes the date in UTC, not the user's zone.

## Goals, non-goals, anti-goals

- Goals: each AC checked live or skipped with its reason; the result on PMK-381 and in the runbook; the check reruns in one line.
- Non-goals: company-managed space and non-admin token checks (owner's decision, open in the PR); a sharper reason read from the license (Jira's 403 cannot tell the cause, and the hint names both).
- Anti-goals: any write to the site (none is needed); the host, email, token or account id in the repository, the PR or the issue.

## Check (SPEC-SS C)

`scripts/runbook-plans-jira.test.mjs` on the fake, then the new live test (`PMKIT_LIVE=1 ... node --test --test-name-pattern plans scripts/lib/jira/client-live.mjs`).

## Interview

Answered on 2026-11-25 by the coordinator; the design is approved.

- Q1: yes. ACs 1, 2 and 4, and AC 3's Premium site with a token owner lacking Administer Jira, are skipped and open in the PR, with one EPC-14 follow-up to run them on a Premium site. No Premium trial on the owner's site, and no unverified Premium test code now.
- Q2: yes. AC 3's "Standard site" is recorded as checked on a Free site (also not Premium, same 403); a Standard site is not checked on its own.
- Q3: yes. The two PMK-378 leftovers are filed as EPC-14 follow-ups now.
- Q4: yes. No `CONTEXT.md` term (Plan and Scenario are there) and no ADR.

## Left to the builder

Assertion wording and the test name.

## Result

Run on 2026-11-25 against the owner's Jira Cloud site (host kept out of the repository, the PR and the issue), space Kudos: `PMKIT_LIVE=1 PMKIT_LIVE_JIRA_SITE=<host> PMKIT_LIVE_JIRA_SPACE=<key> node --test --test-name-pattern Premium scripts/lib/jira/client-live.mjs`. Read-only: nothing was written to the site. No output held the token, the email or the host. A mutation (the Premium refusal mapped from another status) made the test fail, then it passed again on the real code.

| Check | AC | Result |
|---|---|---|
| Plans reads answer the PMK-82 shapes | 1 | **skipped**: the site is on Jira Free; PMK-399 |
| Plan and team lists page with `cursor`, `nextPageCursor`, `last` | 2 | **skipped**: needs Premium; PMK-399 |
| A site without Premium answers 403; `jira plans list` and `get` show `available: false` with the hint | 3 | **pass** on a Free site (Q2: Standard not checked on its own) |
| A Premium site whose token owner lacks Administer Jira answers 403 | 3 | **skipped**: needs Premium; PMK-399 |
| The capacity unit matches Jira Plans | 4 | **skipped**: needs Premium; PMK-399 |

No product code changed: the live answers matched the fake's off mode. Follow-ups in EPC-14: PMK-399 (the Premium checks), PMK-400 and PMK-401 (from PMK-378: the fake's remaining estimate with an estimate set; `events --since` reads a UTC date).
