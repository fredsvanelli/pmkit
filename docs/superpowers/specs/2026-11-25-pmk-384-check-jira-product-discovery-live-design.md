# PMK-384: check the Jira Product Discovery flows against a live site

Issue PMK-384 (EPC-14, chore), follow-up of PMK-83. Written on 2026-11-25 by a dispatched worker; the owner's answers come through the coordinator. A small change: a short design.

## Intent

PMK-83 built `jira ideas list` and `jira ideas connect` (`scripts/lib/jira/ideas.mjs`) and checked them only on the fake Jira. Run the `product-discovery-jira` runbook's flows on the owner's site, settle what the fake assumed, and leave a check that reruns in one line (the opt-in harness of PR #391, `scripts/lib/jira/client-live.mjs`, `PMKIT_LIVE`).

## Acceptance criteria (from the issue)

1. `jira ideas list` on a live site with a JPD project: the Votes field is a `jira.polaris:votes` field and search returns its number (or note that it returns null).
2. The delivery link type name (`Polaris work item link` or `Polaris issue link`) and its inward and outward text match what pmkit reads, and `jira ideas connect` makes the epic show in the idea's Delivery tab.
3. A site without JPD answers `available: false` with the hint.

## What a live probe found (2026-11-25)

Site: the owner's (host, email and token kept out of the repository, the PR and the issue). Read-only.

- `GET /rest/api/3/project/search`: one project, Kudos (`projectTypeKey: software`, team-managed). No `product_discovery` project.
- `GET /rest/api/3/issueLinkType`: Blocks, Cloners, Duplicate, Relates. No Polaris link type.
- `GET /rest/api/3/field`: no field with a `jira.polaris:*` schema.
- `GET /rest/api/3/instance/license`: `jira-software` on `FREE`; no Jira Product Discovery application.

So the site does not have Jira Product Discovery installed at all, not only no JPD project. AC 3 can be checked live; ACs 1 and 2 need JPD added to the site (a site-admin action in Atlassian Administration, not in Jira's REST API) and a JPD project.

## Approaches

- **A. One read-only live test in `client-live.mjs` for AC 3 (recommended).** The PMK-381 pattern: read the projects raw; on a site with no `product_discovery` project, run the real CLI (`liveRepo`, `init` with every recommendation on Kudos) and check the off answers; on a site that has one the test skips with a reason that names the follow-up, so it never reports a pass it did not check.
- **B. Also check ACs 1 and 2 live.** Needs the owner to add JPD to the site and create (or let pmkit's test create) a JPD project; asked through the coordinator, answer pending.
- **C. Write the JPD checks now without a JPD site.** They would ship unverified. Rejected, as in PMK-381.

A now; B depends on the owner's answer.

## Design (approach A)

- `test('jira ideas answer available false on a site without Jira Product Discovery', { skip: NEEDS_SPACE })` in `client-live.mjs`, read-only, nothing to clean up but the temporary repository. Steps:
  - raw `project/search`: skip with the follow-up's id when any project has `projectTypeKey: product_discovery`;
  - CLI `jira ideas list --json`, and with `--limit 1`: `available: false`, `reason: no_discovery_project`, `enableHint` = `IDEAS_HINT(site)`, `ideas: []`, `hasMore: false`, the site;
  - CLI `jira ideas list --project <space>`: `NOT_FOUND` with `IDEAS_HINT` as the next step (Kudos is not a JPD project);
  - CLI `jira ideas connect <space>-1 <space>-2 --dry-run`: `NOT_FOUND` (not an idea), before any write;
  - the text output of the list is the one line the runbook's step 10 shows.
- Output prints only codes and counts; `assertNoSecret`, `scrub` and `hostless` cover every answer.
- Test-first: the test is written and run before any other change; it characterises code that already behaves, so it passes on its first live run unless the site disagrees. No product code changes unless the run finds a difference.
- `docs/runbooks/product-discovery-jira.md`: the "Live check" line records the run, what passed and what is skipped.
- The header comment of `client-live.mjs` names PMK-384.
- No `CONTEXT.md` term, no ADR: nothing here is hard to reverse.

## Follow-ups (EPC-14)

- If the owner picks A: check ACs 1 and 2 on a site with Jira Product Discovery (votes field schema and value, the delivery link type's name and texts, the Delivery tab after `connect`). Linked to PMK-384.

## Goals, non-goals, anti-goals

- Goals: each AC checked live or skipped with its reason; the result on PMK-384 and in the runbook; the check reruns in one line.
- Non-goals: company-managed space and non-admin token checks (owner's decision, open in the PR); insights (Jira's REST API does not return them).
- Anti-goals: any write outside Kudos; any change to the site's products; the host, email, token or account id in the repository, the PR or the issue.

## Check (SPEC-SS C)

`scripts/runbook-product-discovery-jira.test.mjs` on the fake, then the new live test (`PMKIT_LIVE=1 ... node --test --test-name-pattern "Product Discovery" scripts/lib/jira/client-live.mjs`).

## Left to the builder

Assertion wording and the test name.
