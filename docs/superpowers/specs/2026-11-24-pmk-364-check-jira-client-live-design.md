# PMK-364: check the Jira client against a live site

Issue PMK-364 (EPC-14, chore), follow-up of PMK-75. Written on 2026-11-24 by a dispatched worker; the owner's answers come through the coordinator.

## Intent

PMK-75 built `scripts/lib/jira/client.mjs` from Atlassian's docs only: no Jira credentials existed, so ADR 0013's live checks were skipped. The owner now has a Jira Cloud site and an API token. Run the client against that site, record what holds, and fix what does not, so the Jira adapter's auth and error mapping rest on observed behaviour, not on docs.

## Acceptance criteria (from the issue)

1. A classic token passes the session check on a live site.
2. A scoped token is checked on the site host, and an ADR is written if it fails.
3. Anonymous `serverInfo` returns `Cloud` on a live site.
4. (Description) The 401 and 429 answers match the error mapping.

## What a first read-only probe found (2026-11-24)

Site: the owner's Jira Cloud site (host recorded in the PR and the issue comment, not in the repository). Token: the owner's API token from the git-ignored `settings.local.json`, loaded into `JIRA_API_TOKEN` at run time, never printed.

| Check | Result |
|---|---|
| `GET /rest/api/3/serverInfo` anonymous | 200, `deploymentType: Cloud` |
| `createJiraClient(...).session()` with the token | passes: `source: JIRA_API_TOKEN`, the viewer's `accountId` and `displayName` |
| Same token through `https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/myself` | 200 too |
| Token type | not knowable from the token: the `ATATT3` prefix is shared, and `api.atlassian.com/me` and `accessible-resources` answer 401 to any API token (they take OAuth 3LO). It behaves as a classic token: accepted on the site host. |
| Wrong token | 401 with `X-Seraph-LoginReason: AUTHENTICATED_FAILED`; the client maps it to `AUTH` "the token may have expired", no secret in message, next step or details. `AUTHENTICATED_FAILED` is not the CAPTCHA reason (`AUTHENTICATION_DENIED`), so it is not read as one. |
| Missing work item | 404 maps to `NOT_FOUND`, with Jira's message (in the site's language) |
| Rate-limit headers on a normal answer | `x-ratelimit-limit: 350`, `x-ratelimit-remaining`, `ratelimit: "jira-burst-based";r=349;t=1`, `ratelimit-policy: "jira-burst-based";q=100;w=1`; no `Retry-After` until a 429 |
| A site host that does not exist (`<random>.atlassian.net`) | **bug**: 404 HTML, mapped to `NOT_FOUND` "Jira found nothing at GET /rest/api/3/serverInfo: no message", next step "Check the key or id". The user typed a wrong site, so the answer should be `NOT_CONFIGURED` pointing at `tracker.scope.site` / `--site`. |
| Kudos space | key `KAN`, team-managed (`next-gen`), software, empty |

## Root cause of the bug

`loadSession()` in `client.mjs` rethrows every error of the anonymous `serverInfo` call except `AUTH`. Atlassian answers an unknown `*.atlassian.net` host with HTTP 404, which `classify` maps to `NOT_FOUND` with the generic key-or-id next step. `serverInfo` exists on every Jira site, so a 404 there means no Jira at that host. It reaches users through `init --tracker jira --site <typo>` (setup step 1) and every command on a repository whose `tracker.scope.site` is wrong.

Fix: in `loadSession`, a `NOT_FOUND` from `serverInfo` becomes `NOT_CONFIGURED` "no Jira site answers at <site>", next step "Check the site's host (tracker.scope.site, or --site in setup)". One branch next to the existing `AUTH` one.

## Approaches

- **A. Opt-in `scripts/lib/jira/client-live.mjs`, like `scripts/lib/linear/client-live.mjs` (recommended).** A `node:test` file `npm test` never loads (`run-tests.mjs` strips `PMKIT_LIVE`). Every test skips with its reason unless `PMKIT_LIVE=1`, `PMKIT_LIVE_JIRA_SITE`, `JIRA_EMAIL` and `JIRA_API_TOKEN` are set. It is the record of the check and reruns in one line for the next Jira live checks (PMK-366 and the other EPC-14 live issues reuse the site and the variables). About 100 lines, no fake, no runbook: the usage sits in the file header, as Linear's does.
- **B. Record only.** Run a scratch script once, record the table above in this doc and on the issue, ship only the bug fix. Smallest, but nothing reruns, and PMK-75 already noted that a live check nobody can rerun is how the gap appeared.
- **C. GitHub-style: a checks module, its unit test on the fake Jira, the entry, a runbook and a runbook test.** Reruns and is tested offline, but triples the code for a developer-only check whose fake run proves little; the client's own unit tests already cover the mapping on the fake.

A, because it reruns for the next live checks at the cost of one file.

## The checks of `client-live.mjs` (approach A)

| Test | Needs | Asserts |
|---|---|---|
| anonymous serverInfo says Cloud | site | a direct `fetch` with no `Authorization` returns 200 and `deploymentType: Cloud` |
| the token passes the session check on the site host | site, token | `session()` returns `source`, `site` and a viewer `accountId` |
| a scoped token passes the session check on the site host | `PMKIT_LIVE_JIRA_SCOPED_TOKEN` | same, with that token as `JIRA_API_TOKEN`; skipped with its reason when unset |
| a wrong token is AUTH | site, email | `session()` with a made-up token throws `AUTH`, the message says the token may have expired, no secret in the error |
| an unknown site is NOT_CONFIGURED | none but `PMKIT_LIVE` | `session()` on `pmkit-live-<random>.atlassian.net` throws `NOT_CONFIGURED` (the bug above) |
| a burst over the rate limit is RATE_LIMITED | `PMKIT_LIVE_JIRA_BURST=1` | sends `GET /rest/api/3/myself` in parallel waves of 50, at most 1000 requests, stops at the first answer `RATE_LIMITED`; asserts the code and a next step naming a reset time or "a few minutes"; skipped (with the headers it saw) when no 429 comes |
| a write round trip in the throwaway space | `PMKIT_LIVE_JIRA_SPACE` | creates a work item `pmkit-live client check` (POST, 201), reads it, deletes it (DELETE, 204 read as `null`), then reads it back as `NOT_FOUND`; the delete runs in a `finally` |

Every write goes only to `PMKIT_LIVE_JIRA_SPACE`, and the test checks first that the space exists. No output holds the token, the email or the `Authorization` header; the account id is printed as "set". The site host and the space key stay out of the repository: the PR and the issue comment record them.

## Scoped token

The owner's token behaves as classic and its type cannot be read from it. AC 2 needs a token known to be scoped (created at id.atlassian.com, "Create API token with scopes", Jira read scopes). If the owner provides one, the scoped test runs; if it fails on the site host, an ADR decides the `api.atlassian.com/ex/jira/<cloudId>` path (ADR 0013). If not, AC 2 is recorded as skipped, with the reason, and stays open in the PR.

## Goals, non-goals, anti-goals

- Goals: each AC checked live or skipped with its reason; the unknown-site bug fixed test-first; the result recorded on PMK-364.
- Non-goals: discovery, issues, sprints or setup live checks (PMK-366 and the other EPC-14 issues); the `api.atlassian.com` path unless a scoped token fails.
- Anti-goals: a write outside Kudos; anything left in Kudos; the token, the email or the site host in the repository or in any output.

## Check (SPEC-SS C)

The bug fix changes what `init --tracker jira` (setup step 1) and `discover` answer for a wrong site: a new step in `docs/runbooks/setup-jira.md` ("a site that does not exist fails with `NOT_CONFIGURED`"), checked by `scripts/runbook-setup-jira.test.mjs` with the fake site answering 404 HTML. Then run the Jira runbook tests and `client-live.mjs` against the live site.

## Left to the builder

The exact message wording; how the fake site answers an unknown host (404 HTML) in the unit test; the burst's wave size if 50 is not enough to reach a 429.
