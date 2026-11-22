# PMK-74 design: Jira authentication, Cloud or Data Center, and spaces

Issue PMK-74, epic EPC-7 (Jira tracker adapter and Bitbucket git host), milestone `jira`. Status: approved by the owner on 2026-11-22, with the answers in "Decisions from the owner". Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The Jira adapter needs three answers before PMK-75 (the API client) can start, and PMK-74 blocks PMK-75. The Jira tab of the planning doc leaves them open: Cloud or Data Center; a personal API token or OAuth 2.0 (3LO); company-managed or team-managed spaces. The planning doc is not in the repository, so this spec works from the issue's list of those questions and from Atlassian's docs. The Unified model's Q1 decision D says to reuse existing tokens, and Q5 decision A says tokens come from the OS keychain, env vars or existing CLI logins, never from the repository file. ADR 0005 (Linear) and ADR 0007 (GitHub Issues) answered the same question for their trackers.

Acceptance criterion:

1. An ADR in `docs/adr/` records the choices.

## Goals

- One deployment, one credential and one space rule for EPC-7, recorded in `docs/adr/0013-jira-cloud-only-with-an-api-token-from-the-environment.md`.
- What PMK-75, PMK-76, PMK-77 to PMK-80 and `/pmkit:setup` must do, so their specs start from this one.

## Non-goals

- Code. PMK-74 delivers the ADR, two glossary terms and this spec. PMK-75 writes the credential module and the client.
- Bitbucket Cloud's credential (PMK-81). It is a git host, and its own issue decides it.
- Jira Product Discovery and Plans (PMK-82, PMK-83) beyond saying they use the same credential.

## Anti-goals

- pmkit never asks the user to paste the token into the chat, never passes it as an argument, never prints it, and never writes it to a file, in the repository or in the user store.
- A token for one site never reads or writes another site through a repository that names a different one.

## Facts checked against Atlassian's docs (2026-11-22)

No Jira credentials exist, so nothing was checked against a live site. Each fact below comes from Atlassian's published docs.

| Fact | Source |
|---|---|
| Atlassian ends Data Center on 2029-03-28 (read-only after). New customers cannot buy Data Center since 2026-03-30, and existing customers cannot buy new subscriptions after 2028-03-30. Jira Align and Bitbucket Data Center are excluded. | atlassian.com/licensing/data-center-end-of-life |
| Cloud API token: Basic auth with `email:token` base64-encoded, sent up front (Jira sends no challenge). Repeated failures can trigger a CAPTCHA, shown by `X-Seraph-LoginReason: AUTHENTICATION_DENIED`. | developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis |
| Tokens created after 2024-12-15 expire in 1 to 365 days, one year by default. A 401 may mean an expired token. | support.atlassian.com, Manage API tokens for your Atlassian account |
| Scoped API tokens and service-account tokens work only through `https://api.atlassian.com/ex/jira/<cloudId>`, still with Basic auth. A classic token works against `https://<site>.atlassian.net`. | same page and community reports; not checked live |
| OAuth 2.0 (3LO) needs an app registered in the developer console, a `client_secret` for the code exchange and each refresh, no PKCE, rotating refresh tokens with a 90-day inactivity expiry, and an app shared by its owner for other sites. Atlassian says apps must not have customers create their own 3LO apps. | developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps |
| The official Atlassian CLI (`acli jira auth login`) logs in with a token or OAuth, but has no raw REST command like `gh api`. | developer.atlassian.com/cloud/acli |
| Data Center uses personal access tokens (from 8.14) sent as `Authorization: Bearer`, and integrations call REST v2 there. Cloud is REST v3 with Atlassian Document Format. | confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html |

## Approaches

### Cloud or Data Center

1. **Cloud only. Chosen by the owner.** `discover` reads `GET /rest/api/3/serverInfo`, and a `deploymentType` other than `Cloud` fails with `NOT_SUPPORTED`. One code path: REST v3, Agile 1.0, Atlassian Document Format.
2. Cloud and Data Center 8.14 or later. Rejected. It needs a second auth header, REST v2, wiki markup instead of ADF, and a test fake for each, for a product that turns read-only on 2029-03-28.

### Credential

1. **Personal API token from the environment. Chosen by the owner.** `JIRA_EMAIL` and `JIRA_API_TOKEN`, sent as `Authorization: Basic base64(email:token)`. Same shape as ADR 0005: no stored secret, no refresh, no server, same in a terminal, in CI and in scheduled runs.
2. OAuth 2.0 (3LO). Rejected for EPC-7. A local CLI cannot keep the `client_secret` a 3LO app needs, there is no PKCE, pmkit's maintainer would have to register and share an app, and refresh tokens rotate and need storage.
3. Reuse the `acli` login. Rejected. `acli` has no REST passthrough, so pmkit could only read its stored token, a file pmkit does not own.
4. OS keychain or a key file. Rejected, as in ADR 0005 (the owner's earlier answer for Linear).

### Spaces

1. **One space per repository. Chosen by the owner.** `tracker.scope.space` holds the space (project) key, as `tracker.scope.team` does for Linear. `discover` reads the space's style (`company-managed` or `team-managed`) and reads statuses, work types and fields for that space, so both styles map through the existing mapping shape.
2. Several spaces per repository. Rejected. It changes the config shape and every list command, for a need no EPC-7 issue states.

## Design

### Config

- `tracker.system: jira`.
- `tracker.scope.site`: the site host, such as `acme.atlassian.net`, required. Setup writes it. The client calls `https://<site>` **(builder's call: host without scheme, as `tracker.scope.host` for GitHub)**.
- `tracker.scope.space`: the space key, such as `PMK`, required.
- No credential in the config. PMK-31's refusal of secret-like keys (`token`, `api_key`, `secret`, `password`) already applies.

### The credential

- One module, `scripts/lib/jira/credential.mjs` (PMK-75), is the only reader of `JIRA_EMAIL` and `JIRA_API_TOKEN`. It reads them from the `env` that `run(argv, { env })` passes in, never from `process.env`.
- `jiraCredential(env)` returns `{ authorization: 'Basic <base64(email:token)>', source: 'JIRA_API_TOKEN' }` and throws `AUTH` when either variable is missing or empty, with next step `/pmkit:setup`.
- No `.env` reading, no keychain, no file. pmkit stores no credential anywhere.
- The token and the header never appear in output, an argument, an error message or its `details`, a cache file or the transcript. Setup never asks for them.
- One variable pair serves every site. A user with two sites sets them per shell or per directory. The site pin catches a wrong pair.

### Site pin

- On the first request of each run, the client calls `GET /rest/api/3/myself` and `GET /rest/api/3/serverInfo` on `https://<site>` and keeps both for the run.
- `myself` gives the actor (`accountId`, `displayName`). `serverInfo.deploymentType` other than `Cloud` fails with `NOT_SUPPORTED`.
- A token whose account cannot reach the site answers 401 or 403 there, which maps to `AUTH`. The pin is the site URL itself: a request only ever goes to the configured site.

### Error mapping

| Case | Code | Next step |
|---|---|---|
| `JIRA_EMAIL` or `JIRA_API_TOKEN` missing or empty | `AUTH` | `/pmkit:setup` |
| HTTP 401 | `AUTH` | `The token may have expired (at most one year). Create one at id.atlassian.com, Security, API tokens, and export JIRA_API_TOKEN` |
| `X-Seraph-LoginReason: AUTHENTICATION_DENIED` (CAPTCHA) | `AUTH` | `Sign in to <site> in a browser once to clear the CAPTCHA, then retry` |
| HTTP 403 on an operation | `AUTH` | `Check the account's permissions in the <space> space` |
| `serverInfo.deploymentType` not `Cloud` | `NOT_SUPPORTED` | `pmkit supports Jira Cloud only (ADR 0013)` |
| HTTP 429 | `RATE_LIMITED` | `Wait <Retry-After> seconds and retry` |
| Network failure, HTTP 5xx | `UPSTREAM` | `Retry, and check status.atlassian.com if it keeps failing` |

### Who appears as the author

Every write appears in Jira as the token's owner. The adapter resolves `me` and the actor from `myself`, not from `git config user.email` **(builder's call, matches ADR 0005)**.

### What each dependent issue must do

| Issue | Must do |
|---|---|
| PMK-75, API client | Add `scripts/lib/jira/credential.mjs` as above. Build `createJiraClient({ env, site, fetch = globalThis.fetch })`, so `npm test` injects a fake `fetch`. Call REST v3 and Agile 1.0 on `https://<site>`. Run the site pin. Apply the error table. Test that a fake token appears in no output. Check scoped tokens on a live site when credentials exist; if a scoped token fails on the site URL, a new ADR decides the `api.atlassian.com/ex/jira/<cloudId>` path. |
| PMK-76, discover and capabilities | Make `discover --json` return `auth: { source, viewer, site }` first. Fail with `NOT_SUPPORTED` on Server or Data Center. Read the space's style and its statuses, work types and fields, for both company-managed and team-managed spaces. |
| PMK-77 to PMK-80 | Use the client of PMK-75 only. No other module reads the variables. |
| `/pmkit:setup`, Jira branch | Run `discover --json`. On `AUTH`, tell the user to create an API token at id.atlassian.com, export `JIRA_EMAIL` and `JIRA_API_TOKEN` in the shell profile or `~/.claude/settings.json` under `env`, never in a file inside the repository, and run setup again. On success, write `tracker.scope.site` and `tracker.scope.space`. Never ask for the token. |

### Docs

- `docs/adr/0013-jira-cloud-only-with-an-api-token-from-the-environment.md`: the three decisions, the considered options and the consequences above, in the shape of ADR 0005 and ADR 0007.
- `CONTEXT.md`: two terms. **Site**: "The Jira Cloud site a repository uses, named by its host in `tracker.scope.site`. The API token comes from `JIRA_EMAIL` and `JIRA_API_TOKEN`, and pmkit stores it nowhere." **Space**: "A Jira project, company-managed or team-managed, named by its key in `tracker.scope.space`. A repository uses one space."
- `scripts/adr-jira-auth.test.mjs`: checks the ADR and the terms, as `adr-linear-auth.test.mjs` does.
- No `CHANGELOG.md` line: PMK-74 changes no behavior, as with PMK-28 and PMK-84.

## Criteria map

| Criterion | Check |
|---|---|
| 1. An ADR in `docs/adr/` records the choices | ADR 0013 exists, names Cloud only, the API token from `JIRA_EMAIL` and `JIRA_API_TOKEN`, and one space per repository, lists the rejected options and the consequences for PMK-75, PMK-76 and setup. `scripts/adr-jira-auth.test.mjs` passes. |

## Risks

- Scoped tokens may not work against the site URL. PMK-75 checks it live; until then, setup says to create a classic (unscoped) token.
- Tokens expire within a year, so users will see `AUTH` once a year. The 401 message names expiry.
- A token has the full rights of its owner, and a token in the shell profile reaches every process the user runs, as a `gh` login does.
- Data Center users cannot use pmkit with Jira. Atlassian ends Data Center on 2029-03-28.

## Left to the builder

- The exact wording of the ADR and the glossary terms, inside the rules above.

## Decisions from the owner (2026-11-22)

1. Cloud or Data Center: Cloud only (1A).
2. Credential: personal API token from `JIRA_EMAIL` and `JIRA_API_TOKEN`, Basic auth (2A).
3. Spaces: one space per repository in `tracker.scope.space`, site in `tracker.scope.site` (3A).

Interview answers, all as recommended:

- Q1. `tracker.scope.site` holds the full host, such as `acme.atlassian.net`, not a URL key in `tracker.scope.workspace`, so a custom Atlassian domain works.
- Q2. The glossary gains **Site** and **Space**, and lists "project" under _Avoid_ for Space, because `CONTEXT.md` already uses project for a GitHub Project and a Linear project.
- Q3. Classic (unscoped) API tokens only for now. Scoped and service-account tokens need `api.atlassian.com/ex/jira/<cloudId>`. PMK-75 checks them on a live site; no credentials exist today, so that check is recorded as skipped, and a new ADR decides it if needed.
- Q4. The Bitbucket Cloud credential (PMK-81) stays out of ADR 0013.
