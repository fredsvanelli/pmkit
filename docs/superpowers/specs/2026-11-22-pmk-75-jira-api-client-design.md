# PMK-75 design: the Jira API client

Issue PMK-75, epic EPC-7 (Jira tracker adapter and Bitbucket git host), milestone `jira`. Status: draft for the interview. Written on 2026-11-22 by a dispatched worker with no live user dialogue, from the issue, ADR 0003, ADR 0013, the PMK-74 spec, the PMK-30 (Linear client) spec and the code. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion. No Jira credentials exist, so nothing here was checked against a live site.

## Problem

EPC-7 needs one module that talks to Jira Cloud. PMK-76 (discovery and the capability manifest) and PMK-77 to PMK-80 (work items, sprints, epics, worklogs) all send REST calls to the configured site, and ADR 0013 says none of them may read the credential, pin the site, retry or map errors on its own. Today `scripts/lib/jira/` does not exist and `tracker.system: jira` fails with `NOT_SUPPORTED` from `adapterFor` in `scripts/lib/adapters.mjs`.

Sources: Unified model, Q1 decision D (direct REST v3 and Agile APIs behind pmkit's own contract, with full control over pagination and errors); Technical spec, "Errors"; ADR 0013 (Cloud only, `JIRA_EMAIL` + `JIRA_API_TOKEN` as Basic auth, `tracker.scope.site` and `tracker.scope.space`, the error rows, `createJiraClient({ env, site, fetch })`).

Acceptance criteria:

1. Calls Jira REST v3 and Agile with the chosen credential.
2. Maps failures to the pmkit error codes.

Bound by ADR 0013 (not reopened here):

- The credential is a classic personal API token: `JIRA_EMAIL` and `JIRA_API_TOKEN` from the `env` that `run(argv, { env })` passes in, sent as `Authorization: Basic base64(email:token)` up front.
- `scripts/lib/jira/credential.mjs` is the only reader of the two variables.
- The first request of a run reads `GET /rest/api/3/serverInfo` and `GET /rest/api/3/myself`; a `deploymentType` other than `Cloud` is `NOT_SUPPORTED`.
- Error rows: missing variables, 401, a CAPTCHA (`X-Seraph-LoginReason: AUTHENTICATION_DENIED`) and 403 are `AUTH`, and the 401 message says the token may have expired; 429 is `RATE_LIMITED`; network failures and 5xx are `UPSTREAM`.
- Tests inject a fake `fetch` and open no socket; a test shows a fake token appears in no output.
- Requests go only to the configured site.

## Goals

- `scripts/lib/jira/credential.mjs` with `jiraCredential(env)`.
- `scripts/lib/jira/client.mjs` with `createJiraClient`, which sends REST v3 and Agile 1.0 calls to the pinned site with the credential, runs the Cloud and `myself` check once, pages through Jira lists, retries reads that are safe to retry, times out, and maps every failure to a `PmkitError` with a next step.
- A fake Jira `fetch`, `scripts/fake-jira-api.mjs`, for this issue's tests and for PMK-76 and PMK-77.
- The refusal of secret-like keys in the `tracker` block, shared with the Linear client.

## Non-goals

- Discovery of spaces, work types, statuses and fields, the capability manifest, `discover --json` and the `auth` block (PMK-76).
- `tracker.scope.site` and `tracker.scope.space` in the schema and the loader, and registering `jira` in `ADAPTERS` (PMK-76). Until then `tracker.system: jira` keeps failing with `NOT_SUPPORTED`, and no CLI command changes.
- Work items, transitions, JQL, sprints, epics, versions and worklogs (PMK-77 to PMK-80).
- Scoped and service-account tokens through `https://api.atlassian.com/ex/jira/<cloudId>`. ADR 0013 says a new ADR decides that path if a live check shows scoped tokens fail on the site host.
- The Atlassian Document Format. The client sends and returns JSON as Jira does.

## Anti-goals

- The token, the email-token pair or the `Authorization` value in output, an argument, a message, `details`, a cache file or a fixture.
- A request from `npm test`.
- A request to any host other than `tracker.scope.site`.
- Waiting out a rate limit inside the client.
- A query builder, a generated schema or an SDK port (ADR 0003).

## Approaches

1. **A thin REST client over `fetch`.** `request(method, path, { query, body })` returns the parsed JSON, and `paginate(path, ...)` loops over one Jira list. Callers write their own paths. This mirrors the Linear client (PMK-30), which the team already reads and tests the same way, and every failure path can run against a fake `fetch`. About 250 lines.
2. **One function per endpoint** (`getIssue`, `searchJql`, `listSprints`, ...) in the client. It hides paths from callers, but it pulls PMK-76 to PMK-80's operations into this issue before their specs exist, and the client grows with every endpoint.
3. **A shared HTTP core for Linear and Jira**, with the Linear client refactored onto it. The two differ in almost every row that matters (GraphQL envelopes and complexity buckets against REST status codes and `Retry-After`), so the shared part is `fetch` with a timeout, and the refactor puts a working, tested client at risk for no caller's gain.

Chosen: approach 1. It is the smallest code that meets both criteria with no dependency, and it follows the Linear precedent so PMK-76 to PMK-80 call Jira the way PMK-33 and PMK-35 call Linear.

## Design

### Where the client stops

The client knows HTTP, the credential, the site, Jira's error bodies, Jira's list shapes and the error codes. It knows no space, no work type, no status and no contract operation. It returns Jira's JSON as Jira sends it. A caller that needs a contract shape builds it from that JSON.

### Files

| File | Change |
|---|---|
| `scripts/lib/jira/credential.mjs` | New. `jiraCredential(env)`. |
| `scripts/lib/jira/client.mjs` | New. `createJiraClient`. |
| `scripts/lib/jira/credential.test.mjs`, `scripts/lib/jira/client.test.mjs` | New. Fake `fetch` only. |
| `scripts/fake-jira-api.mjs` | New. `fakeJiraFetch(routes)`, `FAKE_EMAIL`, `FAKE_TOKEN`. |
| `scripts/lib/user-store.mjs` | `secretKeyPaths(tracker)` moves here from `linear/client.mjs`, next to `isCredentialKey` and `isCredentialString`; `isCredentialString` also matches an Atlassian token (`ATATT` followed by 20 or more characters) and a `Basic` header **(builder's call)**. |
| `scripts/lib/linear/client.mjs` | Imports `secretKeyPaths` from `user-store.mjs` and re-exports it, so its callers and tests do not change. |

### The credential

```js
/** The Authorization header value and its source. Throws AUTH when a variable is missing or malformed. */
export function jiraCredential(env) // => { authorization: 'Basic <base64>', source: 'JIRA_API_TOKEN' }
```

| Case | Code | Message | Next step |
|---|---|---|---|
| `JIRA_EMAIL` missing or empty | `AUTH` | `JIRA_EMAIL is not set` | `/pmkit:setup` |
| `JIRA_API_TOKEN` missing or empty | `AUTH` | `JIRA_API_TOKEN is not set` | `/pmkit:setup` |
| Either holds whitespace or a control character, or the email has no `@` | `AUTH` | `JIRA_EMAIL is not a bare email address` or `JIRA_API_TOKEN is not a bare Jira API token` | `Export the value as Atlassian shows it, with no quotes, spaces or Basic prefix` |

- When both are missing, the email row comes first. The CLI shows one error at a time.
- The pair is encoded with `Buffer.from(`${email}:${token}`, 'utf8').toString('base64')`. A trailing newline from `echo` would encode silently and give a confusing 401, so the client refuses it before any request **(builder's call)**.
- No message or next step holds any part of either value. The email is not a secret, but it is personal, so it stays out too.
- A test reads every `.mjs` file under `scripts/` and finds `env.JIRA_EMAIL`, `env.JIRA_API_TOKEN` or their bracket forms only in `credential.mjs` and in test files, as the Linear credential test does.

### The site and the tracker config

`createJiraClient` takes the `tracker` block of `.pmkit/config.yaml`, as the Linear client does, because it needs `tracker.scope.site` and must refuse secrets in the same block. ADR 0013 names the argument `site`; the `tracker` block carries it at `scope.site`, and a caller with only a site, such as PMK-76's setup, passes `{ system: 'jira', scope: { site } }` **(builder's call)**.

- `secretKeyPaths(tracker)` not empty: `INVALID_INPUT`, `.pmkit/config.yaml holds a secret-like key at <paths>`, next step `Remove it from .pmkit/config.yaml and keep the Jira token in JIRA_API_TOKEN`. Paths only, never values, before any request.
- `tracker.scope.site` missing: `NOT_CONFIGURED`, `tracker.scope.site is not set`, next step `/pmkit:setup`.
- `tracker.scope.site` not a bare host (a scheme, a path, a port, a user part, a space, or a label outside `[a-z0-9-]`): `NOT_CONFIGURED`, `tracker.scope.site must be a host such as acme.atlassian.net`, next step `Set tracker.scope.site in .pmkit/config.yaml to the site's host, with no https:// or path`. Hosts are lowercased. A custom Atlassian domain passes, as ADR 0013 allows.
- Every request goes to `https://<site><path>`. `path` must start with `/rest/api/3/` or `/rest/agile/1.0/`; anything else, including a full URL, throws `TypeError` before any request, because it is a bug in the caller. This is how the client pins the site.
- `fetch` runs with `redirect: 'manual'`, so the `Authorization` header never follows a redirect to another host. A 3xx answer is `NOT_CONFIGURED`, `Jira at <site> redirected the request (HTTP <status>)`, next step `Check tracker.scope.site in .pmkit/config.yaml; a renamed site needs its new host` **(builder's call)**.

### The client

```js
export function createJiraClient({
  env,                   // required
  tracker,               // the tracker block of .pmkit/config.yaml
  fetch = globalThis.fetch,
  timeoutMs = 30_000,
  retries = 2,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}) // => frozen { request, paginate, session }
```

`createJiraClient` sends nothing. It runs the secret check, reads and checks the site, and calls `jiraCredential(env)`, so a missing variable fails at creation with no request.

- `request(method, path, { query, body } = {})` resolves to the parsed JSON body, or `null` for an empty 2xx body such as 204, or throws a `PmkitError`. `method` is one of `GET`, `POST`, `PUT`, `DELETE`. `query` is an object turned into the query string with `URLSearchParams` (array values repeat the key); `body` is sent as JSON with `Content-Type: application/json`. Every request also sends `Accept: application/json`.
- `paginate(path, options)` resolves to `{ items, hasMore }`. See "Paging".
- `session()` resolves to `{ source: 'JIRA_API_TOKEN', site, viewer: { accountId, displayName } }`. PMK-76's `discover --json` returns it as its `auth` block, and later issues resolve `me` and the actor from `viewer.accountId`.

### The session check

The first `request`, `paginate` or `session` call runs the check once per client, which is once per CLI run. The client keeps the promise, so concurrent first calls share it and a failed check fails every later call the same way.

1. `GET /rest/api/3/serverInfo` **without** the `Authorization` header. Atlassian documents it as needing no permission. Sending it anonymously means the token never reaches a host that has not said it is Jira Cloud, and a Data Center site never sees a Basic header it would count as a failed login toward a CAPTCHA **(builder's call)**.
   - `deploymentType` equals `Cloud`: go on.
   - Any other value, or none: `NOT_SUPPORTED`, `<site> runs Jira <deploymentType or "Server or Data Center">; pmkit supports Jira Cloud only`, next step `Use a Jira Cloud site (ADR 0013)`.
   - A failure maps through the error table below, and a 401 or 403 here maps to `NOT_SUPPORTED` too, because a Cloud site answers this call anonymously **(builder's call)**.
2. `GET /rest/api/3/myself` with the credential. It needs `accountId`; without one it is `UPSTREAM`, `Jira returned no account for this token`. The client keeps `accountId` and `displayName` and drops the rest, including `emailAddress`.

### Sending a request

Each attempt sends the method to `https://<site><path>[?query]` with the headers above, `redirect: 'manual'` and `signal: AbortSignal.timeout(timeoutMs)`. Node 18 has both. The client reads the body as text, then parses JSON when the text is not empty.

### Error mapping

The client checks the rows in order and stops at the first match. `<Jira message>` is the first of `errorMessages`, then of the values of `errors`, as one line of at most 200 characters, or `no message`. `details.jira` holds `{ status, errorMessages, errors }` from the body (both empty when the body has neither). Jira writes them from the request's fields and never echoes request headers.

| Case | Code | Message | Next step | Retried |
|---|---|---|---|---|
| Credential missing or malformed | `AUTH` | see "The credential" | see "The credential" | no |
| Response header `X-Seraph-LoginReason` holds `AUTHENTICATION_DENIED`, any status | `AUTH` | `Jira wants a CAPTCHA before it accepts this account's token` | `Sign in to <site> in a browser once to clear the CAPTCHA, then retry` | no |
| HTTP 401 | `AUTH` | `Jira rejected JIRA_EMAIL and JIRA_API_TOKEN; the token may have expired` | `Create an API token at id.atlassian.com and export JIRA_EMAIL and JIRA_API_TOKEN` | no |
| HTTP 403 | `AUTH` | `Jira refused the request for this account: <Jira message>` | `Check that the token's owner has the permission in <site>` | no |
| HTTP 429 | `RATE_LIMITED` | `Jira's rate limit for this account is used up` | `Wait until <resetAt> and retry`, or `Wait a few minutes and retry` with no reset header | no |
| HTTP 3xx | `NOT_CONFIGURED` | see "The site" | see "The site" | no |
| HTTP 400 | `INVALID_INPUT` | `Jira rejected the request: <Jira message>` | `Check the request against Jira's message` | no |
| HTTP 404 | `NOT_FOUND` | `Jira found nothing at <method> <path>: <Jira message>` | `Check the key or id, and that the token's owner can see it` | no |
| HTTP 409 | `CONFLICT` | `Jira reported a conflict: <Jira message>` | `Read the item again and retry` | no |
| Network failure, timeout, HTTP 5xx, on `GET` | `UPSTREAM` | `Jira did not answer: <reason>` | `Retry, and check status.atlassian.com if it keeps failing` | yes |
| The same on `POST`, `PUT` or `DELETE` | `UPSTREAM` | `Jira did not confirm the change: <reason>` | `Check in Jira whether the change was applied before you retry` | no |
| A 2xx body that is not JSON | `UPSTREAM` | `Jira returned an unreadable answer (HTTP <status>)`, or the "did not confirm" message on a write | as the two rows above | no |
| Any other status | `UPSTREAM` | `Jira answered HTTP <status>: <Jira message>` | `Retry, and check status.atlassian.com if it keeps failing` | no |

Rules for every row:

- `<reason>` is `timed out after <n> s`, `HTTP <status>`, or the `code` of the `fetch` error's `cause` when it matches `^[A-Z][A-Z0-9_]*$` (such as `ENOTFOUND`), or `network error`. The client never copies a `fetch` error's message, which can quote a header (PMK-30's rule).
- `<resetAt>` comes from `Retry-After` (seconds, added to `now()`), then from `X-RateLimit-Reset` (an ISO 8601 time), as an ISO time in UTC. Atlassian documents both on 429 only.
- 400, 404 and 409 map in the client, not in each caller, because REST status codes carry the meaning that GraphQL errors did not in the Linear client. A caller that knows better (PMK-77 turning a 400 on a transition into "the screen needs fields") reads `details.jira` and throws its own error **(builder's call)**.
- `<method> <path>` in a 404 holds no query string, so a JQL text never reaches the message.

### Retries and timeouts

- One attempt waits up to `timeoutMs`, 30 s by default.
- A `GET` that fails with a network error, a timeout or HTTP 5xx is sent again, at most `retries` times (2 by default), after 500 ms and then 2000 ms through the injected `sleep`. When a 503 carries `Retry-After` of at most 5 s, the client waits that long instead; a longer wait ends the retries and throws `UPSTREAM` **(builder's call)**.
- `POST`, `PUT` and `DELETE` are sent once. After a timeout or a 5xx nobody can tell whether Jira applied the change, so the next step hands the choice to the user. Reads that Jira only offers as `POST` are not retried; PMK-77 uses `GET /rest/api/3/search/jql`, which is a `GET`.
- The client never retries `AUTH`, `RATE_LIMITED`, `INVALID_INPUT`, `NOT_FOUND` or `CONFLICT`, and never sleeps until a rate-limit reset; the hourly quota has no gradual throttling.

### Paging

Jira lists come in two shapes, and `paginate` reads both:

- **Offset lists** (most of REST v3 and every Agile list): the request takes `startAt` and `maxResults`; the answer holds the items under a key (`values`, `issues`, `worklogs`, `comments`), with `isLast` or `total`.
- **Token lists** (`GET /rest/api/3/search/jql`): the request takes `nextPageToken` and `maxResults`; the answer holds `issues`, `nextPageToken` and `isLast`.

```js
await client.paginate('/rest/agile/1.0/board/7/sprint', {
  query: { state: 'active,future' },
  key: 'values',      // default 'values'
  pageSize: 50,       // default 50, integer 1 to 100
  limit: 200,         // optional
  maxPages: 10,       // optional
}) // => { items, hasMore }
```

- Each page asks for `maxResults = min(pageSize, limit - items so far)`. A page whose answer holds `nextPageToken` switches to token mode: the next request passes that token. Otherwise the next `startAt` is the previous `startAt` plus the number of items Jira returned, because Jira may cap `maxResults` below what was asked.
- The loop stops when `isLast` is `true`, when `total` is reached, when a page is empty, when token mode has no next token, at `limit` items, or after `maxPages` pages. `hasMore` is `true` when it stopped while Jira still had a next page.
- Without `limit`, `maxPages` defaults to 10, so a careless call costs at most 10 requests, as the user chose for Linear in PMK-30.
- An answer whose `key` is not an array, or a token equal to the previous one, is `UPSTREAM`, `Jira returned a broken page for <path>`. `pageSize` outside 1 to 100, or `maxPages` below 1, throws `TypeError` before any request.

### Keeping the token out of output

- The `Authorization` value lives in one closure variable. No returned object, error, `details` or `session()` value holds it, the email or the token.
- Messages are fixed templates filled with status codes, the site, paths, times and Jira's own messages.
- The client logs nothing and writes no file.

### Fake fetch

`scripts/fake-jira-api.mjs` exports `fakeJiraFetch(routes)`, `FAKE_EMAIL` (`pmkit-test@example.com`) and `FAKE_TOKEN` (`ATATTTESTTOKENTESTTOKENTESTTOKEN`). The `fetch` it returns records each call as `{ url, method, headers, body }` and answers from `routes`, keyed by `<METHOD> <path>` without the query string. A route is a response `{ status, headers, json | text }`, a list of responses for successive calls (the last one repeats), a function of the recorded call, `{ throws: error }` or `{ hang: true }`. `GET /rest/api/3/serverInfo` answers `deploymentType: Cloud` and `GET /rest/api/3/myself` answers a test account unless the test overrides them. A call with no route fails the test, as the Linear fake does.

### Live check

Skipped. No Jira credentials exist, and the coordinator's brief says anything needing a live site is recorded as skipped, not faked. ADR 0013's live checks for PMK-75 (a classic token against the site host, a scoped token against the site host) are listed as open in the PR. **(Question for the interview: whether to ship an opt-in `client-live.mjs` that nobody has run, or leave it to the first issue that has a site.)**

## Acceptance criteria map

| Criterion | Design part | Tests |
|---|---|---|
| 1. Calls Jira REST v3 and Agile with the chosen credential | "The credential", "The site", "The client", "The session check", "Sending a request", "Paging" | `credential.test.mjs`: the header is `Basic` plus base64 of `email:token`; each missing, empty and malformed variable gives its `AUTH` row with no part of the value in the message; only `credential.mjs` reads the two variables. `client.test.mjs`: creating the client sends nothing; a missing variable fails at creation with zero calls; a REST v3 `GET` and an Agile `GET` go to `https://acme.atlassian.net/rest/...` with the header and `Accept`; a `POST` sends a JSON body; `query` builds the string; a path outside the two prefixes and a full URL throw `TypeError`; `serverInfo` goes first without `Authorization`, then `myself` with it, once, also for two concurrent calls; `Server` and `DataCenter` give `NOT_SUPPORTED` and `myself` is never called; `session()` holds `accountId` and `displayName` and no email; the site rows; the secret refusal; offset paging over three pages, `total`, `isLast`, a capped `maxResults`, token paging, `limit`, the default 10-page cap, `hasMore`, broken pages and bad options. |
| 2. Maps failures to the pmkit error codes | "Error mapping", "Retries and timeouts" | One test per table row asserts code, message and next step. Retries: a `GET` that fails twice with `ECONNRESET` and then passes makes two `sleep` calls of 500 and 2000; three failures give `UPSTREAM`; a `POST` that times out gives the "did not confirm" message after one call; 401, 403, 429, 400, 404 and 409 make one call each; a `hang` route with `timeoutMs: 20` gives `timed out`. A sweep runs every failure path with `FAKE_TOKEN` and `FAKE_EMAIL` and asserts neither, nor the base64 header, appears in any message, next step, `JSON.stringify(details)` or `String(error)`, including a `fetch` that throws an error whose message holds the header. |
| ADR 0013: classic tokens only, scoped tokens checked live | "Live check" | Skipped: no credentials. Listed open in the PR. |
| ADR 0003: no dependency | Global `fetch`, `AbortSignal.timeout`, `Buffer` | `plugin.test.mjs` already fails on a dependency key. |

## Decisions

| Decision | Reason |
|---|---|
| Thin REST client with caller paths (approach 1) | Smallest code that meets both criteria; mirrors the Linear client. |
| The client takes the `tracker` block | It needs `scope.site` and must refuse secrets in the same block, as the Linear client does. |
| `secretKeyPaths` moves to `user-store.mjs` | Two clients use it now; it belongs next to the patterns it uses. |
| `serverInfo` is read anonymously | The token never reaches a host that has not said it is Jira Cloud. |
| Paths must start with `/rest/api/3/` or `/rest/agile/1.0/`, `redirect: 'manual'` | That is what pins the site: no caller can point the token at another host. |
| 400, 404 and 409 map in the client | REST status codes carry the meaning; the criterion asks for the pmkit codes. |
| Retry `GET` only | A write after a timeout or 5xx may have been applied. |
| No rate-limit bookkeeping before sending | Jira's hourly quota denies everything until reset and sends the reset time on the 429 itself; the Linear-style pre-check adds state for no new answer. |
| No ADR | ADR 0013 records the credential, the site, the Cloud check and the error rows. The rest is inside one module. |

## Risks

- Nothing is verified live. The response shapes come from Atlassian's published docs (rate limiting checked on 2026-11-22; `serverInfo` anonymous access, `search/jql` token paging and `X-Seraph-LoginReason` from the PMK-74 research). If `serverInfo` turns out to need auth on some sites, the anonymous call reads as `NOT_SUPPORTED` with a clear message, and the fix is one header.
- Scoped tokens may fail against the site host. ADR 0013 already routes that to a new ADR.
- No CLI command uses the client yet, so the CLI-level check that the fake token appears in no stdout or stderr runs at error level here and repeats in PMK-76 with `discover`.
- Node 18 prints an `ExperimentalWarning` on the first real `fetch`. Tests use the fake.

## Check step (E2E)

No user-visible flow changes: `tracker.system: jira` still fails with `NOT_SUPPORTED`, and no command, runbook or schema changes. The Check step runs the existing runbook tests (`scripts/runbook-*.test.mjs`) to show nothing regressed, and the PR says no flow test was added because no flow changed.

## Left to the builder

- The layout inside `client.mjs`.
- The wording of the message templates above, within the no-secret rule.
