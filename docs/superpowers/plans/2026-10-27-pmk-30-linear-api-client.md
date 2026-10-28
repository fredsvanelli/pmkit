# PMK-30 the Linear API client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One library module sends GraphQL to Linear with the key from `LINEAR_API_KEY`, pins the workspace, pages through Relay connections, retries safe failures, and maps every failure to a `PmkitError` with a next step.

**Architecture:** `scripts/lib/linear/credential.mjs` is the only reader of `LINEAR_API_KEY`. `scripts/lib/linear/client.mjs` exports `createLinearClient`, a closure over an injected `fetch`, `sleep` and `now`, with no state outside the returned object. Tests run against `scripts/fake-linear-api.mjs`, a fake `fetch` keyed by GraphQL operation name. An opt-in live check, `scripts/lib/linear/client-live.mjs`, runs the same client against the sandbox workspace with reads only.

**Tech Stack:** Node 18+ ES modules, global `fetch`, `Headers` and `AbortSignal.timeout`, `node:test`. No dependency. Run the suite with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-27-pmk-30-linear-api-client-design.md`. The spec is the authority. Where this plan and the spec differ, the spec wins, and the implementer reports the difference.

## Global Constraints

- Resolved: the secret-key refusal lives only in `createLinearClient`, and `validatePmkitConfig` and the schema stay as they are. The default page cap with no `limit` is 10 pages. `linear` stays out of `ADAPTERS` and `scripts/lib/adapters.mjs` does not change.
- `package.json` gains nothing. `npm test` sends no request. No test reads `process.env.LINEAR_API_KEY`.
- No library module reads `process.env`. `env` always comes from the caller.
- The key never appears in a message, next step, `details`, warning, `rateLimit()` value, log, file or command-line argument. Messages are the fixed templates from the spec's "Error mapping" table and "Workspace pin" table, copied verbatim, with no trailing period added.
- Errors use `new PmkitError(code, message, nextStep, details)` from `scripts/lib/errors.mjs`. A caller bug (bad `pageSize`, `maxPages`, `limit` or `select`) throws `TypeError` before any request.
- Defaults: `timeoutMs = 30_000`, `retries = 2`, retry delays 500 ms then 2000 ms, `pageSize = 100` (integer 1 to 250), `maxPages = 10` when no `limit` is given and no cap when one is given.
- Endpoint: `LINEAR_ENDPOINT = 'https://api.linear.app/graphql'`. Headers: `Content-Type: application/json` and `Authorization: <key>` with no `Bearer`.
- Test values: the fake key is `lin_api_TESTKEYTESTKEYTESTKEY`, the workspace is `acme`, the team key is `ACME`. No file names the real workspace URL key or team key. Docs say "the sandbox workspace".
- Do not use `AbortSignal.any` (Node 20+). Do not use `t.after` on the test context. Use the `after` and `afterEach` hooks from `node:test`.
- Code, comments and commits are in English and follow the unslop rules. Every commit message carries `(PMK-30)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Module surface

```js
// scripts/lib/linear/credential.mjs
export function linearCredential(env) // => { authorization: string, source: 'LINEAR_API_KEY' }, throws AUTH

// scripts/lib/linear/client.mjs
export const LINEAR_ENDPOINT
export function isMutation(document)       // boolean: strip # comments, test /^mutation\b/i
export function operationName(document)    // 'Issues', or null for an anonymous document
export function secretKeyPaths(tracker)    // ['tracker.scope.token', ...], sorted, values never included
export function createLinearClient({ env, tracker, requireWorkspace = true, fetch = globalThis.fetch,
  timeoutMs = 30_000, retries = 2, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now() })
// => Object.freeze({ request, paginate, session, rateLimit })
//   request(document, variables = {})                      => Promise<data>
//   paginate(document, variables = {}, { select, pageSize = 100, limit, maxPages }) => Promise<{ nodes, hasMore }>
//   session()  => Promise<{ source, viewer: { id, name }, workspace: { urlKey, name }, pinned, warnings }>
//   rateLimit() => { requests: { limit, remaining, resetAt }, complexity: { limit, remaining, resetAt }, lastComplexity } | null

// scripts/fake-linear-api.mjs
export const FAKE_KEY = 'lin_api_TESTKEYTESTKEYTESTKEY'
export function fakeLinearFetch(routes = {}, { workspace = 'acme', previousUrlKeys = [] } = {})
// => async fetch(url, init) with .calls = [{ url, method, headers, body }] and .unrouted = [operation names]
export function page(nodes, { hasNextPage = false, endCursor = null } = {}) // a Relay connection object
export function json(data, { status = 200, headers = {} } = {})             // a route response { status, headers, json: { data } }
```

`operationName` is a small export the spec does not list. The fake uses it to pick a route, and `paginate` uses it in the broken-page message.

## File Map

- Create `scripts/lib/linear/credential.mjs` and `scripts/lib/linear/credential.test.mjs`.
- Create `scripts/fake-linear-api.mjs` and `scripts/fake-linear-api.test.mjs` (a test of the fake itself, so client tests can trust it).
- Create `scripts/lib/linear/client.mjs` and `scripts/lib/linear/client.test.mjs`.
- Create `scripts/lib/linear/client-live.mjs`. Its name does not end in `.test.mjs`, so `npm test` never loads it.
- Modify `scripts/lib/user-store.mjs`: export `isCredentialString`.
- Modify `scripts/lib/linear/verify-api.mjs` and `scripts/lib/linear/verify-api.test.mjs`: read the key through `linearCredential(env)`.

## Acceptance Criteria Map

| Criterion | Tasks |
| --- | --- |
| 1. Calls the Linear GraphQL API with the credential chosen in the auth decision | 1, 3, 4, 9 |
| 2. Pages through results | 7, 9 |
| 3. Maps failures to `AUTH`, `RATE_LIMITED` and `UPSTREAM` with a next step | 5, 6, 8, 9 |
| 4. `package.json` gains no dependency | 10 (the existing `plugin.test.mjs` check) |
| Binding: secret-like keys in the tracker config are refused | 3, 8 |
| Binding: tests use a fake `fetch` | 2, 3 (the `globalThis.fetch` guard) |
| Binding: live checks run only behind an explicit variable | 9 |

## Review Focus

The spec implies these inputs, and no row of its tables names them. Each line has a test in the task named at the end.

1. A response with `data` and `errors: []` is a success. Linear and proxies send an empty list, and a client that tests `errors !== undefined` would fail every such call (Task 5).
2. A GraphQL error with no `extensions`, no `message` or a message longer than 200 characters or with line breaks still maps to `UPSTREAM` with a readable one-line message, never `undefined` (Task 5).
3. `select(data)` returning `null` or `undefined`, as `team: null` does for an unknown team, gives `UPSTREAM` "broken page" and not a `TypeError` from reading `pageInfo` of null (Task 7).
4. Rate-limit headers that are missing, partial or not numeric never block a request and never put `NaN` or `Invalid Date` in `rateLimit()` (Task 6).
5. `isMutation` must not call `query MutationReport { ... }` or a document whose first line is `# mutation note` a mutation, and must call `  mutation Create { ... }` with leading whitespace and a comment a mutation. A wrong answer either retries a write or stops retrying a read (Task 3).

---

### Task 1: The credential and its only reader

**Files:** create `scripts/lib/linear/credential.mjs`, `scripts/lib/linear/credential.test.mjs`; modify `scripts/lib/linear/verify-api.mjs`, `scripts/lib/linear/verify-api.test.mjs`.

**Interfaces:**
- Produces: `linearCredential(env)` as in the module surface.

- [ ] **Step 1: Write the failing tests** in `credential.test.mjs`.
  - `linearCredential({ LINEAR_API_KEY: FAKE })` returns `{ authorization: FAKE, source: 'LINEAR_API_KEY' }`, with `FAKE = 'lin_api_TESTKEYTESTKEYTESTKEY'` written inline (the fake module does not exist yet).
  - `{}` and `{ LINEAR_API_KEY: '' }` throw `PmkitError` with `code: 'AUTH'`, message `LINEAR_API_KEY is not set`, next step `/pmkit:setup`.
  - `'Bearer ' + FAKE`, `FAKE + '\n'`, `' ' + FAKE`, `FAKE + '\t'` and `FAKE + 'é'` each throw `AUTH`, message `LINEAR_API_KEY is not a bare Linear key`, next step `Export the key as Linear shows it, with no quotes, spaces or Bearer prefix`. For each, assert that the message and next step contain neither `TESTKEY` nor the full value.
  - A value such as `abc123` passes (no `lin_api_` prefix check, ADR-0005).
  - `only credential.mjs reads LINEAR_API_KEY from an env`: walk `scripts/` recursively for `.mjs` files that do not end in `.test.mjs`, match `/env(\.LINEAR_API_KEY|\[['"]LINEAR_API_KEY['"]\])/`, and assert the matching files equal `['scripts/lib/linear/credential.mjs']` (paths relative to the repository root, `/` separators).
  - In `verify-api.test.mjs`, add `run exits 2 with a malformed key and sends nothing`: `env: { PMKIT_LIVE: '1', LINEAR_API_KEY: 'Bearer x' }` returns 2, writes one line, and `fetch.calls.length === 0`.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/credential.test.mjs scripts/lib/linear/verify-api.test.mjs`. Expect failures (module missing, sweep finds `verify-api.mjs`).
- [ ] **Step 3: Implement** `linearCredential(env)`. A value is bare when it matches `/^[\x21-\x7E]+$/`. In `verify-api.mjs`, replace `env.LINEAR_API_KEY` with a `linearCredential(env)` call inside a `try`. On `AUTH` with the "is not set" message, write the existing `verify-api needs LINEAR_API_KEY in the environment.\n`. On the malformed message, write `verify-api: <message>\n`. Both return 2. The rest of `run` uses `credential.authorization`.
- [ ] **Step 4: Run** the two files. Expect pass.
- [ ] **Step 5: Commit** `feat: read the Linear key in one place (PMK-30)`.

### Task 2: The fake Linear fetch

**Files:** create `scripts/fake-linear-api.mjs`, `scripts/fake-linear-api.test.mjs`; create `scripts/lib/linear/client.mjs` with `isMutation` and `operationName` only.

**Interfaces:**
- Consumes: nothing.
- Produces: `FAKE_KEY`, `fakeLinearFetch`, `page`, `json` from the module surface; `isMutation`, `operationName` in `client.mjs`.

- [ ] **Step 1: Write the failing tests** in `fake-linear-api.test.mjs`.
  - `operationName('query Issues($a: Int) { x }') === 'Issues'`, `operationName('mutation IssueCreate { x }') === 'IssueCreate'`, `operationName('{ viewer { id } }') === null`, and a leading `# comment\n` line is skipped.
  - The fake records each call as `{ url, method, headers, body }`, where `headers` is a plain object with the header names as sent and `body` is the parsed JSON.
  - With no routes, a `PmkitSession` call answers 200 with `{ data: { viewer: { id: 'user-1', name: 'Test User' }, organization: { urlKey: 'acme', name: 'Acme', previousUrlKeys: [] } } }`. `{ workspace: 'other', previousUrlKeys: ['acme'] }` changes those two fields.
  - A route of one response answers every call. A route that is a list answers the Nth call with item N, and the last item repeats.
  - A route that is a function receives the parsed body and returns a response.
  - `{ text: 'oops', status: 400 }` answers with that raw text. `json(data, { headers })` answers with those headers, readable through `response.headers.get(name)` case-insensitively.
  - `{ throws: error }` rejects with that error.
  - `{ hang: true }` stays pending until `init.signal` aborts, then rejects with `init.signal.reason`. Test it with `AbortSignal.timeout(10)`.
  - `{ textRejects: true, status: 200 }` resolves the response and then rejects `response.text()` with `new TypeError('terminated')`.
  - An operation with no route pushes its name (or `'(anonymous)'`) to `fetch.unrouted` and rejects with `Error('fake linear: no route for <name>')`.
- [ ] **Step 2: Run** `node --test scripts/fake-linear-api.test.mjs`. Expect failure (modules missing).
- [ ] **Step 3: Implement.** `isMutation(document)` follows `assertQuery` in `verify-api.mjs`: remove `#` to end of line, trim, test `/^mutation\b/i`. `operationName` uses the same stripping and `/^(query|mutation|subscription)\s+([A-Za-z_]\w*)/`. Responses in the fake are plain objects `{ status, ok: status >= 200 && status < 300, headers: new Headers(headers), text: async () => ... }`.
- [ ] **Step 4: Run** the test. Expect pass.
- [ ] **Step 5: Commit** `test: add a fake Linear fetch (PMK-30)`.

### Task 3: Client creation and the tracker config checks

**Files:** modify `scripts/lib/linear/client.mjs`, `scripts/lib/user-store.mjs`; create `scripts/lib/linear/client.test.mjs`.

**Interfaces:**
- Consumes: `linearCredential` (Task 1), `fakeLinearFetch`, `FAKE_KEY` (Task 2), `isCredentialKey` and `isCredentialString` from `user-store.mjs`.
- Produces: `secretKeyPaths(tracker)`, `createLinearClient(options)` that validates and returns the frozen object. `request`, `paginate`, `session` and `rateLimit` exist but are filled in by Tasks 4 to 7.

- [ ] **Step 1: Write the failing tests** in `client.test.mjs`.
  - At the top of the file, before any client exists: replace `globalThis.fetch` with a function that counts calls and throws, and add `after(() => assert.equal(realFetchCalls, 0))`. Keep a list of fakes made through a local helper `fake(routes, options)` and check `assert.deepEqual(f.unrouted, [])` for each in `afterEach`.
  - `secretKeyPaths` returns `['tracker.token']`, `['tracker.scope.api_key']`, `['tracker.scope.apiKey']` and `['tracker.scope.note']` for `{ token: 'x' }`, `{ scope: { api_key: 'x' } }`, `{ scope: { apiKey: 'x' } }` and `{ scope: { note: FAKE_KEY } }`. It returns `[]` for `{ system: 'linear', scope: { workspace: 'acme', team: 'ACME' } }`. It walks arrays (`tracker.scope.teams[0].secret`).
  - `createLinearClient` with `tracker: { system: 'linear', scope: { workspace: 'acme', token: FAKE_KEY } }` throws `INVALID_INPUT`, message `.pmkit/config.yaml holds a secret-like key at tracker.scope.token`, next step `Remove it from .pmkit/config.yaml and keep the Linear key in LINEAR_API_KEY`. The message, next step and `JSON.stringify(error.details)` do not contain `TESTKEY`. The fake has zero calls. Two paths are joined with `, `.
  - A tracker with no `scope.workspace` throws `NOT_CONFIGURED`, `tracker.scope.workspace is not set`, next step `/pmkit:setup`. With `requireWorkspace: false` it does not throw.
  - `env: {}` throws `AUTH` from `linearCredential` with zero calls.
  - A valid client sends nothing at creation, and the returned object is frozen with exactly the keys `request`, `paginate`, `session`, `rateLimit`.
  - `isMutation` cases from Review Focus line 5: `query MutationReport { a }` false, `# mutation note\nquery Q { a }` false, `  # note\n  mutation Create { a }` true, `mutation{a}` true, `{ a }` false.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/client.test.mjs`. Expect failures.
- [ ] **Step 3: Implement.** Change `function isCredentialString` to `export function isCredentialString` in `user-store.mjs`. `secretKeyPaths` walks like `assertNoCredentials` in `user-store.mjs`, starting at label `tracker`, collecting paths instead of throwing. The creation order is the secret check, then the workspace check, then `linearCredential(env)`. Keep the key in one closure variable.
- [ ] **Step 4: Run** the test, then `node --test scripts/user-store.test.mjs`. Expect pass.
- [ ] **Step 5: Commit** `feat: create the Linear client from the tracker config (PMK-30)`.

### Task 4: Sending a request and the workspace pin

**Files:** modify `scripts/lib/linear/client.mjs`, `scripts/lib/linear/client.test.mjs`.

**Interfaces:**
- Consumes: Task 3.
- Produces: `request(document, variables)`, `session()`, and an internal `send(document, variables)` that runs one logical call (Tasks 5 and 6 add mapping and retries to it). `send` returns `data` from a 2xx JSON response with `data` and no errors.

- [ ] **Step 1: Write the failing tests.**
  - `request('query Q { a }', { x: 1 })` sends `PmkitSession` first, then one call with `url === LINEAR_ENDPOINT`, `method === 'POST'`, `headers['Content-Type'] === 'application/json'`, `headers.Authorization === FAKE_KEY`, and `body` equal to `{ query: 'query Q { a }', variables: { x: 1 } }`. It resolves to the route's `data`. `variables` defaults to `{}`.
  - Two `request` calls and one `session` call started together send `PmkitSession` once.
  - `session()` resolves to `{ source: 'LINEAR_API_KEY', viewer: { id: 'user-1', name: 'Test User' }, workspace: { urlKey: 'acme', name: 'Acme' }, pinned: true, warnings: [] }`.
  - Workspace `acme` with `previousUrlKeys: ['acme']` and `urlKey: 'acme-new'` passes with the warning `Linear renamed workspace acme to acme-new; set tracker.scope.workspace to acme-new in .pmkit/config.yaml`.
  - `urlKey: 'other'` gives `AUTH`, `LINEAR_API_KEY belongs to workspace other, and .pmkit/config.yaml names acme`, next step `Export a LINEAR_API_KEY created in the acme workspace`. A later `request` rejects with the same error and sends no new call.
  - `data: { viewer: {...} }` with no `organization` gives `UPSTREAM`, `Linear returned no organization for this key`.
  - `requireWorkspace: false` and no workspace: `session()` has `pinned: false` and `warnings: []`.
- [ ] **Step 2: Run** the file. Expect failures.
- [ ] **Step 3: Implement** `send` with `fetch(LINEAR_ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(timeoutMs) })`, then `response.text()`, then `JSON.parse`. Store the session promise on first use and return the same promise on every later call.
- [ ] **Step 4: Run** the file. Expect pass.
- [ ] **Step 5: Commit** `feat: send Linear requests pinned to the workspace (PMK-30)`.

### Task 5: Error mapping

**Files:** modify `scripts/lib/linear/client.mjs`, `scripts/lib/linear/client.test.mjs`.

**Interfaces:**
- Consumes: `send` (Task 4).
- Produces: every thrown error from `send` is a `PmkitError` whose `details.linear` is `{ status, errors: [{ code, type, path, userError }] }` when Linear answered, from `extensions.code`, `extensions.type`, `path` and `extensions.userError`. Task 6 decides retries from the kind of failure, never from `details`.

- [ ] **Step 1: Write the failing tests.** One test per row of the spec's "Error mapping" table, each asserting `code`, `message` and `nextStep` verbatim, run on a query `Q` after a passing session:
  - HTTP 401, and HTTP 200 with `extensions.code: 'AUTHENTICATION_ERROR'`: `AUTH`, `Linear rejected LINEAR_API_KEY`.
  - HTTP 403, and `FORBIDDEN`: `AUTH`, `Linear refused the request for this key`.
  - HTTP 429, and HTTP 400 with `RATELIMITED`: `RATE_LIMITED`. With `x-ratelimit-requests-remaining: 0` and `x-ratelimit-requests-reset: 1793000000000`, the message names `requests` and the next step is `Wait until 2026-10-26T07:33:20.000Z and retry`. With `x-ratelimit-complexity-remaining: 0` it names `complexity`. With no reset header the next step is `Wait a few minutes and retry`.
  - HTTP 400 with `GRAPHQL_VALIDATION_FAILED`, and with `GRAPHQL_PARSE_FAILED`: `UPSTREAM`, `Linear rejected pmkit's query: <message>`.
  - HTTP 200 with `data: null` and one error with `path: ['issue']`, `userPresentableMessage: 'Could not find referenced Issue.'` and `extensions: { code: 'INPUT_ERROR', type: 'invalid input', userError: true }`: `UPSTREAM`, `Linear answered with an error: Could not find referenced Issue.`, and `details.linear.errors[0]` equals `{ code: 'INPUT_ERROR', type: 'invalid input', path: ['issue'], userError: true }`.
  - HTTP 400 with text `not json`, and HTTP 200 with `{}`: `UPSTREAM`, `Linear returned an unreadable answer (HTTP 400)` and `(HTTP 200)`.
  - HTTP 418 with JSON `{ data: null }`: `UPSTREAM`, `Linear answered HTTP 418`.
  - Errors with partial `data` still throw.
  - Review Focus line 1: `{ data: { a: 1 }, errors: [] }` resolves to `{ a: 1 }`.
  - Review Focus line 2: an error `{}` gives `Linear answered with an error: no message`. A message of 300 characters with `\n` gives a single-line message whose Linear part is 200 characters.
- [ ] **Step 2: Run** the file. Expect failures.
- [ ] **Step 3: Implement** one classifier that checks the rows in the spec's order and stops at the first match. `<Linear message>` is `userPresentableMessage ?? message ?? 'no message'`, with whitespace runs replaced by one space, cut to 200 characters. `resetAt` is `new Date(Number(header)).toISOString()`. Network failures and 5xx are Task 6.
- [ ] **Step 4: Run** the file. Expect pass.
- [ ] **Step 5: Commit** `feat: map Linear failures to pmkit error codes (PMK-30)`.

### Task 6: Network failures, retries, timeouts and the rate state

**Files:** modify `scripts/lib/linear/client.mjs`, `scripts/lib/linear/client.test.mjs`.

**Interfaces:**
- Consumes: Tasks 4 and 5.
- Produces: `rateLimit()`, and retry behavior inside `send`. Delays come from the injected `sleep(ms)`.

- [ ] **Step 1: Write the failing tests.** Inject `sleep` as a function that records `ms` and resolves at once.
  - A query route `[{ throws: econnreset }, { throws: econnreset }, json({ a: 1 })]`, where `econnreset` is `new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })`, resolves to `{ a: 1 }` with sleeps `[500, 2000]` and three calls to `Q`.
  - Three failures give `UPSTREAM`, `Linear did not answer: ECONNRESET`, next step `Retry, and check status.linear.app if it keeps failing`.
  - A `cause.code` of `econnreset` (lower case) or no cause gives `network error`. A thrown error whose message holds `FAKE_KEY` gives a message without it.
  - HTTP 503 on a query is retried. `{ status: 503, text: '<html>' }` is retried and ends with the unreadable message.
  - `{ hang: true }` with `timeoutMs: 20` and `retries: 0` gives `Linear did not answer: timed out after 0.02 s`.
  - `{ textRejects: true }` is a network failure and is retried.
  - A mutation `mutation M { a }` that hangs, with `timeoutMs: 20`, makes one call and gives `Linear did not confirm the change: timed out after 0.02 s`, next step `Check in Linear whether the change was applied before you retry`. A mutation that gets 503 makes one call.
  - 401, 429, `RATELIMITED` and `GRAPHQL_VALIDATION_FAILED` make one call each and no sleep.
  - `rateLimit()` is `null` before any response. After a response with the six `x-ratelimit-*` headers and `x-complexity: 3`, it equals the numbers, `resetAt` as ISO strings, and `lastComplexity: 3`.
  - After a response with `x-ratelimit-requests-remaining: 0` and a reset at `now() + 60_000`, the next `request` throws `RATE_LIMITED` with zero new calls. After `now` moves past the reset, it sends.
  - Review Focus line 4: a response with only `x-ratelimit-requests-remaining: abc`, and one with `-remaining: 0` and no `-reset`, leave the next request free to send, and `rateLimit()` holds `null` for each missing or unreadable field (no `NaN`, no `Invalid Date`).
- [ ] **Step 2: Run** the file. Expect failures.
- [ ] **Step 3: Implement.** Treat an error as a timeout when its `name` is `TimeoutError` or the attempt's signal has `reason?.name === 'TimeoutError'`. `<n>` is `timeoutMs / 1000`. The delay list is `[500, 2000]`, and attempt `i` waits `delays[Math.min(i, 1)]`, so a larger `retries` keeps 2000. Record the headers before parsing the body. Never sleep for a rate limit.
- [ ] **Step 4: Run** the file. Expect pass.
- [ ] **Step 5: Commit** `feat: retry Linear reads and track the rate limit (PMK-30)`.

### Task 7: Paging

**Files:** modify `scripts/lib/linear/client.mjs`, `scripts/lib/linear/client.test.mjs`.

**Interfaces:**
- Consumes: `request` (Task 4).
- Produces: `paginate(document, variables = {}, { select, pageSize = 100, limit, maxPages })` resolving to `{ nodes, hasMore }`.

- [ ] **Step 1: Write the failing tests.** The document is `query Issues($first: Int!, $after: String) { issues(first: $first, after: $after) { pageInfo { hasNextPage endCursor } nodes { id } } }` and the route a function that reads `body.variables`.
  - Three pages come back in order. The first call has `after` undefined or null, and each later `after` equals the previous `endCursor`. Caller variables such as `teamId` reach every page.
  - `limit: 250` with `pageSize: 100` asks `first` 100, 100, 50, and returns 250 nodes with `hasMore: true` when the third page had a next page.
  - No `limit` and a connection with endless pages: 10 calls to `Issues`, 1000 nodes, `hasMore: true`.
  - `limit: 1500`, `pageSize: 100`, endless pages: 15 calls, 1500 nodes, `hasMore: true`.
  - `maxPages: 2` gives 2 calls and `hasMore: true`. `hasNextPage: false` on page 1 gives 1 call and `hasMore: false`.
  - A nested `select: (data) => data.team.issues` works.
  - `UPSTREAM`, `Linear returned a broken page for Issues` for a connection with no `pageInfo`, one with no `nodes`, a next page with `endCursor: null`, and an `endCursor` equal to the one before. Review Focus line 3: `select` returning `null` and `undefined` gives the same error.
  - `TypeError` with zero calls for `pageSize` 0, 251 and 1.5, `maxPages` 0, `limit` 0, and a missing `select`.
- [ ] **Step 2: Run** the file. Expect failures.
- [ ] **Step 3: Implement.** Each page sends `{ ...variables, first: Math.min(pageSize, limit - nodes.length), after }`. The page cap is `maxPages ?? (limit === undefined ? 10 : Infinity)`. Pages run one after another. An anonymous document names `an anonymous query` in the broken-page message.
- [ ] **Step 4: Run** the file. Expect pass.
- [ ] **Step 5: Commit** `feat: page through Linear connections (PMK-30)`.

### Task 8: The key-leak sweep

**Files:** modify `scripts/lib/linear/client.test.mjs`.

**Interfaces:**
- Consumes: every earlier task.

- [ ] **Step 1: Write the test** `no failure path exposes the key`. Build a table of cases, each a route set and a call, that covers every row of the spec's "Error mapping" table, the workspace mismatch, the rename warning, the secret in `tracker.scope`, the bad credential `'Bearer ' + FAKE_KEY`, the broken page, the pre-send rate-limit refusal, and a `fetch` that throws `new Error('header ' + FAKE_KEY)` with no cause. For each, collect `error.message`, `error.nextStep`, `JSON.stringify(error.details ?? null)`, `String(error)`, `error.stack`, and for passing cases `JSON.stringify(await client.session())` and `JSON.stringify(client.rateLimit())`. Assert that none contains `FAKE_KEY` or `TESTKEY`.
- [ ] **Step 2: Run** the file. Expect pass. To prove the test can fail, put the key into one message temporarily, see the test fail, and revert.
- [ ] **Step 3: Commit** `test: check that no Linear failure exposes the key (PMK-30)`.

### Task 9: The live check

**Files:** create `scripts/lib/linear/client-live.mjs`.

**Interfaces:**
- Consumes: `createLinearClient`, `isMutation`, `linearCredential`.

- [ ] **Step 1: Write the file.** A header comment with the command `set -a; . ./.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=<url key> node --test scripts/lib/linear/client-live.mjs`. One skip reason for every test: `set PMKIT_LIVE=1 to run the live check` without `PMKIT_LIVE=1`, `set PMKIT_LIVE_WORKSPACE to the sandbox workspace URL key` without it, and `LINEAR_API_KEY is not usable: <message>` when `linearCredential(process.env)` throws. The key for the leak assertions comes from `linearCredential(process.env).authorization`, so Task 1's sweep stays green. A `guardedFetch` wraps `globalThis.fetch` and rejects any body whose `query` `isMutation` says is a mutation. Tests:
  - `session` pins to `PMKIT_LIVE_WORKSPACE` with `pinned: true`.
  - A client with `scope.workspace: 'pmkit-no-such-workspace'` rejects with `AUTH`.
  - A client with `env: { LINEAR_API_KEY: 'lin_api_' + 'x'.repeat(40) }` rejects with `AUTH`, `Linear rejected LINEAR_API_KEY`.
  - `paginate` over `issues` with `pageSize: 1`, `limit: 2` returns two nodes with distinct ids, and `rateLimit().requests.limit` is a number.
  - An unknown field gives `UPSTREAM` with `details.linear.errors[0].code === 'GRAPHQL_VALIDATION_FAILED'`.
  - `issue(id: "00000000-0000-4000-8000-000000000000")` gives `UPSTREAM` with `details.linear.errors[0].code === 'INPUT_ERROR'`.
  - Each test asserts that no message, next step or `JSON.stringify(details)` holds the key.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/client-live.mjs` with no variables. Expect every test skipped and no request. Run `npm test` and confirm the file is not loaded.
- [ ] **Step 3: Run live only when the brief for the run allows it.** Use the command in the header comment with the sandbox workspace URL key in `PMKIT_LIVE_WORKSPACE`, typed on the command line of that run only, never in a file. Expect every test to pass. Record the result in the PR body, not in a file in the repository.
- [ ] **Step 4: Commit** `test: add an opt-in live check of the Linear client (PMK-30)`.

### Task 10: Full verification

**Files:** none, unless a check fails.

- [ ] **Step 1:** Run `npm test`. Expect every test to pass, `plugin.test.mjs` included (`package.json` unchanged), and no leftover temp entries.
- [ ] **Step 2:** Run `git diff --stat main -- scripts package.json`. Expect only the files in the File Map, and no change to `package.json` or `scripts/lib/adapters.mjs`.
- [ ] **Step 3:** Run the private-name check. Expect no output.
- [ ] **Step 4:** Run `git grep -n 'process.env' -- scripts/lib/linear/client.mjs scripts/lib/linear/credential.mjs`. Expect no output.
- [ ] **Step 5: Commit** only if a check needed a fix, with a subject that names the fix and `(PMK-30)`.
