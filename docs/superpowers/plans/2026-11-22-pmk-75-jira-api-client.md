# PMK-75 Jira API client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the Orca brief forbids subagents for this worker) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Jira Cloud REST client (`createJiraClient`) and its credential reader, with paging and the pmkit error mapping, tested against a fake `fetch`.

**Architecture:** Mirrors `scripts/lib/linear/client.mjs`: a frozen object of closures over one `Authorization` value, a once-per-client session check, a classifier per HTTP answer and a retry loop for `GET`. No CLI wiring; `jira` stays out of `ADAPTERS`.

**Tech Stack:** Node 18+ ES modules, global `fetch`, `AbortSignal.timeout`, `Buffer`, `node:test`. No dependency (ADR 0003).

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-75-jira-api-client-design.md`

## Global Constraints

- No `package.json` dependency; lint is `npm run lint`, tests `npm test`.
- Only `scripts/lib/jira/credential.mjs` reads `env.JIRA_EMAIL` / `env.JIRA_API_TOKEN`; no library module reads `process.env`.
- No message, next step, `details`, `session()` value or `String(error)` holds the email, the token or the base64 header.
- Every request goes to `https://<tracker.scope.site>` with a path starting `/rest/api/3/` or `/rest/agile/1.0/`, `redirect: 'manual'`.
- Every commit message carries `(PMK-75)`.

## Review Focus

- A token with a trailing newline (`echo` into an env var): `AUTH`, not a silent 401. Test in Task 2.
- A `fetch` that throws with the header in its message: the error holds `network error` or the cause code, never the header. Test in Task 3 sweep.
- `tracker.scope.site` given as `https://acme.atlassian.net/`: `NOT_CONFIGURED` with the host hint. Test in Task 3.
- Jira capping `maxResults` below the request: next `startAt` uses the count returned, so no item is skipped. Test in Task 4.
- A 404 on a JQL search: the message holds the path without the query string. Test in Task 3.

---

### Task 1: Shared secret-key check

**Files:**
- Modify: `scripts/lib/user-store.mjs` (CREDENTIAL_STRING; add `secretKeyPaths`)
- Modify: `scripts/lib/linear/client.mjs` (import and re-export `secretKeyPaths`, delete its copy)
- Test: `scripts/user-store.test.mjs` or the existing test that covers `isCredentialString` (find with grep)

**Interfaces:**
- Produces: `secretKeyPaths(tracker: object) => string[]` exported from `user-store.mjs`; `isCredentialString` also true for `ATATT` + 20 or more chars and `Basic\s+\S+`.

- [ ] Step 1: Failing tests: `isCredentialString('ATATT' + 'x'.repeat(20))` and `isCredentialString('Basic dXNlcjp0b2tlbg==')` are true; `isCredentialString('ATATT')` false; `secretKeyPaths({ scope: { site: 'acme.atlassian.net', token: 'x' } })` deep-equals `['tracker.scope.token']`.
- [ ] Step 2: Run, see them fail.
- [ ] Step 3: Change the regex to `/^(lin_api_.{20,}|ATATT.{20,}|(Bearer|Basic)\s+\S+)/i`, move `secretKeyPaths` unchanged.
- [ ] Step 4: `npm test` passes (Linear client tests still import `secretKeyPaths` from `linear/client.mjs`).
- [ ] Step 5: Commit `refactor: share the secret-key check with the Jira client (PMK-75)`.

### Task 2: `jiraCredential(env)`

**Files:**
- Create: `scripts/lib/jira/credential.mjs`, `scripts/lib/jira/credential.test.mjs`

**Interfaces:**
- Produces: `jiraCredential(env) => { authorization: 'Basic <base64(email:token)>', source: 'JIRA_API_TOKEN' }`.

- [ ] Step 1: Failing tests, with `FAKE_EMAIL = 'pmkit-test@example.com'`, `FAKE_TOKEN = 'ATATTTESTTOKENTESTTOKENTESTTOKEN'`:
  - the pair encodes to `'Basic ' + Buffer.from(`${FAKE_EMAIL}:${FAKE_TOKEN}`).toString('base64')`;
  - `{}` and `{ JIRA_EMAIL: '' , JIRA_API_TOKEN: FAKE_TOKEN }` give `AUTH`, `JIRA_EMAIL is not set`, `/pmkit:setup`; missing token gives `JIRA_API_TOKEN is not set`;
  - email `'a b@x'`, `'nobody'`, `FAKE_EMAIL + '\n'` give `JIRA_EMAIL is not a bare email address`; token with a space, `\n`, `\t`, or `Basic ` prefix gives `JIRA_API_TOKEN is not a bare Jira API token`; both next step `Export the value as Atlassian shows it, with no quotes, spaces or Basic prefix`; neither text holds the value;
  - the walk test: only `scripts/lib/jira/credential.mjs` matches `/env(\.JIRA_(EMAIL|API_TOKEN)|\[['"]JIRA_(EMAIL|API_TOKEN)['"]\])/` among non-test `.mjs` under `scripts/`.
- [ ] Step 2: Run, fail.
- [ ] Step 3: Implement. Bare = `/^[\x21-\x7E]+$/`; email also needs `@`.
- [ ] Step 4: `node --test scripts/lib/jira/credential.test.mjs` passes.
- [ ] Step 5: Commit `feat: read the Jira credential from the environment (PMK-75)`.

### Task 3: Fake fetch and `createJiraClient` (request, session, errors, retries)

**Files:**
- Create: `scripts/fake-jira-api.mjs`, `scripts/lib/jira/client.mjs`, `scripts/lib/jira/client.test.mjs`

**Interfaces:**
- Consumes: `jiraCredential`, `secretKeyPaths`, `PmkitError`.
- Produces: `fakeJiraFetch(routes) => fetch` with `.calls: { url, method, headers, body }[]`; `FAKE_EMAIL`, `FAKE_TOKEN`, `FAKE_ENV`, `TRACKER = { system: 'jira', scope: { site: 'acme.atlassian.net', space: 'ENG' } }`. Routes keyed `'<METHOD> <path>'`; defaults for `GET /rest/api/3/serverInfo` (`{ deploymentType: 'Cloud' }`) and `GET /rest/api/3/myself` (`{ accountId: 'acc-1', displayName: 'Test User', emailAddress: FAKE_EMAIL }`); unrouted call throws an `Error` that fails the test.
- Produces: `createJiraClient({ env, tracker, fetch, timeoutMs = 30000, retries = 2, sleep, now }) => frozen { request(method, path, { query, body } = {}), paginate (Task 4), session() }`.

- [ ] Step 1: Failing tests (one `test` each; `globalThis.fetch` replaced by a thrower for the file):
  - creation sends nothing; missing env fails at creation with zero calls;
  - site rows: missing → `NOT_CONFIGURED` `tracker.scope.site is not set`; `https://acme.atlassian.net/`, `acme.atlassian.net/x`, `acme.atlassian.net:443`, `u@acme.atlassian.net`, `ac me.net` → `NOT_CONFIGURED` `tracker.scope.site must be a host such as acme.atlassian.net`; `ACME.atlassian.net` is lowercased; secret key in tracker → `INVALID_INPUT` naming the path, zero calls;
  - first call order: `serverInfo` with no `authorization` header, then `myself` with `Basic …`, then the request; two concurrent `request`s share one session (serverInfo called once);
  - `GET /rest/api/3/issue/ENG-1` and `GET /rest/agile/1.0/board` go to `https://acme.atlassian.net/...` with `accept: application/json`, `redirect: 'manual'`; `query: { jql: 'a b', fields: ['x','y'] }` builds `?jql=a+b&fields=x&fields=y`; `POST` with `body` sends JSON and `content-type`; 204 resolves `null`;
  - `request('GET', '/wiki/x')` and `request('GET', 'https://evil.example/rest/api/3/x')` throw `TypeError`, zero calls;
  - `deploymentType: 'Server'` → `NOT_SUPPORTED` `acme.atlassian.net runs Jira Server; pmkit supports Jira Cloud only`, next `Use a Jira Cloud site (ADR 0013)`, myself never called; no `deploymentType` → message with `Server or Data Center`; 401 on serverInfo → `NOT_SUPPORTED`;
  - myself without `accountId` → `UPSTREAM` `Jira returned no account for this token`; `session()` deep-equals `{ source: 'JIRA_API_TOKEN', site: 'acme.atlassian.net', viewer: { accountId: 'acc-1', displayName: 'Test User' } }`;
  - one test per error-table row in the spec, exact code, message and next step (CAPTCHA header on a 401 → CAPTCHA row; 403 includes Jira message; 429 with `Retry-After: 120` and `now = () => 0` → `Wait until 1970-01-01T00:02:00.000Z and retry`; 429 with `X-RateLimit-Reset: 2025-10-08T15:00:00Z` → `Wait until 2025-10-08T15:00:00.000Z and retry`; 429 bare → `Wait a few minutes and retry`; 302 → `NOT_CONFIGURED` redirect row; 400/404/409 with `{ errorMessages: ['m'] }` and with `{ errors: { f: 'e' } }`; 404 on `GET /rest/api/3/search/jql` with a `query` → message `Jira found nothing at GET /rest/api/3/search/jql: m`; 2xx text `oops` → unreadable; 418 → `Jira answered HTTP 418: no message`); `details.jira` equals `{ status, errorMessages, errors }`;
  - retries: GET failing twice with `{ throws: Object.assign(new Error('x'), { cause: { code: 'ECONNRESET' } }) }` then 200 → sleeps `[500, 2000]`; three failures → `UPSTREAM` `Jira did not answer: ECONNRESET`; 503 ×3 → `Jira did not answer: HTTP 503`; POST with `hang` and `timeoutMs: 20` → `Jira did not confirm the change: timed out after 0.02 s`, one call; 401/403/429/400/404/409 make one call;
  - leak sweep: every failure above plus a `fetch` throwing `new Error('Authorization: ' + header)`; none of `FAKE_TOKEN`, `FAKE_EMAIL`, the base64 string appear in `message`, `nextStep`, `JSON.stringify(details)`, `String(error)`.
- [ ] Step 2: Run, fail.
- [ ] Step 3: Implement per spec "Error mapping" (rows in order; CAPTCHA header checked first after the credential), "Retries and timeouts" (`GET` only; delays `[500, 2000]`), "The session check" (promise kept). `<Jira message>`: first of `errorMessages`, then `Object.values(errors)`, whitespace collapsed, ≤200 chars, else `no message`. Site regex: `/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/` after lowercase.
- [ ] Step 4: `node --test scripts/lib/jira/client.test.mjs` passes.
- [ ] Step 5: Commit `feat: add the Jira REST client with the error mapping (PMK-75)`.

### Task 4: `paginate`

**Files:**
- Modify: `scripts/lib/jira/client.mjs`, `scripts/lib/jira/client.test.mjs`

**Interfaces:**
- Produces: `paginate(path, { query = {}, key = 'values', pageSize = 50, limit, maxPages } = {}) => Promise<{ items, hasMore }>` (GET only).

- [ ] Step 1: Failing tests:
  - offset: three pages of 2 with `isLast` on the third → 6 items, `startAt` 0, 2, 4, `hasMore: false`;
  - Jira returns 1 item when `maxResults=2` was asked → next `startAt` is 1;
  - `total: 3` stops after 3 items without `isLast`; empty page stops;
  - token: `/rest/api/3/search/jql` with `key: 'issues'`, page 1 `nextPageToken: 't1'`, page 2 `isLast: true` → second request has `nextPageToken=t1` and no `startAt`;
  - `limit: 3`, `pageSize: 2` → second request `maxResults=1`, `hasMore: true` when Jira had more;
  - no limit, endless pages → 10 requests, `hasMore: true`; `maxPages: 2` → 2 requests;
  - `key` not an array, or a repeated token → `UPSTREAM` `Jira returned a broken page for <path>`;
  - `pageSize` 0, 101, 1.5 and `maxPages` 0 throw `TypeError`, zero calls.
- [ ] Step 2: Run, fail.
- [ ] Step 3: Implement per spec "Paging".
- [ ] Step 4: Tests pass.
- [ ] Step 5: Commit `feat: page through Jira lists (PMK-75)`.

### Task 5: Follow-up issue for the live checks

- [ ] Step 1: `node <pmkit>/scripts/pmkit.mjs epic list --json`; create `EPC-7 follow-ups` epic if missing (`epic create`, dry run first).
- [ ] Step 2: Create an issue "Check the Jira client against a live site" (classic token on the site host; scoped token on the site host, a new ADR if it fails; anonymous `serverInfo` on a live site), parent that epic, related to PMK-75.
- [ ] Step 3: Commit the `.issues/` change `chore: capture the PMK-75 live checks follow-up (PMK-75)`.

### Task 6: Full suite

- [ ] Step 1: `npm test` and `npm run lint` pass; read the summary lines.
