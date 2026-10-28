# PMK-30 design: the Linear API client

Issue PMK-30, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: ready for planning. The user answered the three open questions on 2026-10-27, and "Resolved questions" records the answers. Decisions come from an autonomous brainstorming run on 2026-10-27 with no user dialogue, from the issue, ADR-0003, ADR-0005, the PMK-28, PMK-29, PMK-31 and PMK-32 specs, the code, and read-only calls to the sandbox workspace. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

EPC-5 needs one module that talks to Linear. PMK-33 (discovery and the capability manifest) and PMK-35 (the issue operations) both send GraphQL to `https://api.linear.app/graphql`, and neither should handle the credential, the workspace pin, paging, retries or the error codes on its own. Today `scripts/lib/linear/` holds only the PMK-29 verification tool, which reads `LINEAR_API_KEY` itself and throws plain `Error`s.

Sources: Unified model, Q1 decision D (direct APIs behind pmkit's own contract, with full control over pagination and errors); Technical spec, "Errors" (`AUTH` for missing or expired credentials, `RATE_LIMITED`, `UPSTREAM` for a tracker that failed, and a next step on every error). ADR-0005 fixes the credential, the header, the workspace pin and the first rows of the error table.

Acceptance criteria:

1. Calls the Linear GraphQL API with the credential chosen in the auth decision.
2. Pages through results.
3. Maps failures to `AUTH`, `RATE_LIMITED` and `UPSTREAM` with a next step.
4. `package.json` gains no dependency.

User decisions that bind this issue:

- The key comes from `LINEAR_API_KEY` only.
- The client compares `tracker.scope.workspace` with `organization.urlKey` and fails with `AUTH` on a mismatch.
- This issue refuses secret-like config keys, such as `token` and `api_key`, in the tracker config.
- Tests use a fake `fetch` and never the network.
- Live checks run only behind an explicit environment variable.

## Facts checked against the Linear API

Read-only calls on 2026-10-27 against the sandbox workspace, with a personal key loaded by the shell:

| Call | Result |
|---|---|
| `{ viewer { id } organization { urlKey previousUrlKeys } }` | HTTP 200, `x-complexity: 3`. Headers `x-ratelimit-requests-limit: 2500`, `x-ratelimit-complexity-limit: 3000000`, each with `-remaining` and `-reset`. The reset is epoch milliseconds. |
| `issues(first: 2, after: $after)` twice | Both pages hold 2 nodes and share none. `pageInfo.endCursor` is a string, and `hasNextPage` is `true` on page 1. |
| A field that does not exist | HTTP 400, `extensions.code: GRAPHQL_VALIDATION_FAILED`, `type: "graphql error"`, no rate-limit headers. |
| A syntax error | HTTP 400, `extensions.code: GRAPHQL_PARSE_FAILED`. |
| `issue(id: <unknown uuid>)` | HTTP 200, `data: null`, `extensions.code: INPUT_ERROR`, `type: "invalid input"`, `userPresentableMessage: "Could not find referenced Issue."`, `path: ["issue"]`. |
| `issues(first: 251)` | HTTP 200, `extensions.code: INVALID_INPUT`, "first must not be greater than 250". |
| `issues(first: 250)` with three nested connections of 250 | HTTP 200, `x-complexity: 56`. Linear counts complexity on the data it returns, so a small workspace never reaches a per-query cap. |
| A body that is not JSON | HTTP 400 with a JSON error body that has no `errors` key. |

PMK-28 recorded the rest: HTTP 401 with `AUTHENTICATION_ERROR` for an unknown key, HTTP 400 for a key sent as a Bearer token, `previousUrlKeys` on `Organization`, and one `ETIMEDOUT` that passed on retry. No call in this run hit a rate limit, so the rate-limit response shape (HTTP 429 or HTTP 400 with `RATELIMITED`) comes from PMK-28's table and is not verified live.

## Goals

- `scripts/lib/linear/credential.mjs`, the only reader of `LINEAR_API_KEY`, as ADR-0005 specifies.
- `scripts/lib/linear/client.mjs` with `createLinearClient`, which sends GraphQL with that credential, pins the workspace, pages through connections, retries what is safe to retry, times out, tracks the rate-limit headers and maps every failure to a `PmkitError` with a next step.
- The refusal of secret-like keys in the `tracker` block of `.pmkit/config.yaml`.
- A fake Linear `fetch` for tests that PMK-33 and PMK-35 reuse.
- An opt-in live check of the client against the sandbox workspace.

## Non-goals

- Discovery queries for teams, states, labels, members and estimate scales, the capability manifest and the user-store cache (PMK-33).
- Registering `linear` in `ADAPTERS` in `scripts/lib/adapters.mjs` (PMK-33, resolved question 3). Until then `tracker.system: linear` keeps failing with `NOT_SUPPORTED`.
- GraphQL documents for issues, relations and search, and the mapping of Linear errors to `NOT_FOUND`, `INVALID_INPUT` or `CONFLICT` (PMK-35).
- The contract suite against a sandbox team (PMK-39).
- Any CLI command. No user-visible behavior changes in this issue.

## Anti-goals

- A credential in a file, a fixture, a test name, a log, an error message, `details` or a command-line argument.
- A request from `npm test`.
- A query builder, a generated schema or an SDK port.
- Waiting out a rate limit inside the client.

## Approaches

1. **A thin client over `fetch` with GraphQL documents as strings.** `request(document, variables)` returns `data`, and `paginate` loops over one Relay connection. Callers write their own documents with variables. This is about 250 lines with no dependency, and every failure path can run against a fake `fetch`.
2. **A small query builder on top of approach 1.** Callers describe fields as JS objects and the builder writes the document. It saves PMK-35 some string work, but it is a second language to test and to keep in step with Linear's schema, and string documents read the same as Linear's docs.
3. **Port the shape of `@linear/sdk`, with model objects that load their relations on access.** ADR-0003 forbids the package itself. Lazy relations also send one request per relation read, and the measured budget for a personal key is 2500 requests per hour.

Chosen: approach 1. PMK-35 writes each document once, as a string with variables, and the client stays small enough to test every failure path.

## Design

### Where the client stops

The client knows HTTP, GraphQL envelopes, Relay pages, the credential, the workspace and the error codes. It knows no team, no issue, no workflow state and no contract operation. It returns `data` as Linear sends it. A caller that needs a contract shape (PMK-35) or a manifest (PMK-33) builds it from that `data`.

### Files

| File | Change |
|---|---|
| `scripts/lib/linear/credential.mjs` | New. `linearCredential(env)`. |
| `scripts/lib/linear/client.mjs` | New. `createLinearClient`, `LINEAR_ENDPOINT`, `secretKeyPaths`, `isMutation`. |
| `scripts/lib/linear/credential.test.mjs`, `scripts/lib/linear/client.test.mjs` | New. Fake `fetch` only. |
| `scripts/fake-linear-api.mjs` | New. `fakeLinearFetch`, next to `fake-gh.mjs` and `fake-hosted.mjs`, for this issue's tests and for PMK-33 and PMK-35. |
| `scripts/lib/linear/client-live.mjs` | New. The opt-in live check. The name does not end in `.test.mjs`, so `npm test` never loads it. |
| `scripts/lib/user-store.mjs` | Export `isCredentialString`, which exists and is private today. |
| `scripts/lib/linear/verify-api.mjs` | Read the key through `linearCredential(env)` instead of `env.LINEAR_API_KEY`, so credential.mjs is the only reader. The exit codes and messages stay. |

### The credential

```js
/** The Authorization header value and its source. Throws AUTH when the key is missing or malformed. */
export function linearCredential(env) // => { authorization: string, source: 'LINEAR_API_KEY' }
```

- A missing or empty `LINEAR_API_KEY` throws `AUTH`, `LINEAR_API_KEY is not set`, next step `/pmkit:setup` (ADR-0005).
- A value with a space, a tab, a line break or any character outside printable ASCII throws `AUTH`, `LINEAR_API_KEY is not a bare Linear key`, next step `Export the key as Linear shows it, with no quotes, spaces or Bearer prefix`. This catches `Bearer lin_api_...` and a key with a trailing newline. The reason goes beyond style. Node's `fetch` rejects a header value with a line break, and its error message quotes the value, so the key would reach the output through the CLI's `unexpected:` branch **(builder's call)**.
- The value goes into the header as it is, with no `Bearer` prefix. pmkit does not check the `lin_api_` prefix (ADR-0005).
- `env` is the one `run(argv, { env })` received. No library module reads `process.env`.

### The tracker config

`createLinearClient` takes the `tracker` block of `.pmkit/config.yaml`, because it needs `tracker.scope.workspace` and because this issue refuses secrets there.

- `secretKeyPaths(tracker)` walks the block at any depth and returns the paths of keys that `isCredentialKey` from `user-store.mjs` matches (`token`, `secret`, `password`, `passwd`, `api_key`, `apiKey`, `credential`, `authorization`), and of string values that `isCredentialString` matches (a `lin_api_` key or a `Bearer` header). The pattern lives in one place, the user store.
- When the list is not empty, `createLinearClient` throws `INVALID_INPUT`, `.pmkit/config.yaml holds a secret-like key at tracker.scope.token`, next step `Remove it from .pmkit/config.yaml and keep the Linear key in LINEAR_API_KEY`. The message names paths, never values. It throws before any request, so a read fails too, not only a write.
- A missing `tracker.scope.workspace` throws `NOT_CONFIGURED`, `tracker.scope.workspace is not set`, next step `/pmkit:setup`. The option `requireWorkspace: false` turns that off for one caller, PMK-33's `discover` during setup, which must call Linear before it knows the URL key. Without a workspace the client still runs the session query and reports `pinned: false`.

### The client

```js
export function createLinearClient({
  env,                   // required
  tracker,               // the tracker block of .pmkit/config.yaml
  requireWorkspace = true,
  fetch = globalThis.fetch,
  timeoutMs = 30_000,
  retries = 2,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}) // => frozen { request, paginate, session, rateLimit }
```

`createLinearClient` sends nothing. It runs the secret check, reads the workspace and calls `linearCredential(env)`, so a missing key fails at creation with no request. The first `request` or `session` call sends the session query.

- `request(document, variables = {})` resolves to `data` or throws a `PmkitError`. Callers pass every user value through `variables` and never build it into the document.
- `paginate(document, variables, options)` resolves to `{ nodes, hasMore }`. See "Paging".
- `session()` resolves to `{ source, viewer: { id, name }, workspace: { urlKey, name }, pinned, warnings }`. PMK-33's `discover --json` returns it as its `auth` block.
- `rateLimit()` returns `{ requests: { limit, remaining, resetAt }, complexity: { limit, remaining, resetAt }, lastComplexity }` from the last response with the headers, with `resetAt` as an ISO time, or `null` before the first response.

### Workspace pin

The session query is `query PmkitSession { viewer { id name } organization { urlKey name previousUrlKeys } }`. It costs 3 complexity points. The client sends it once per client, which is once per CLI run, and keeps the promise, so concurrent first calls share one request and a failed check fails every later call the same way.

| Answer | Result |
|---|---|
| `urlKey` equals `tracker.scope.workspace` | Pass. |
| Only `previousUrlKeys` holds it | Pass. `session().warnings` holds `Linear renamed workspace <old> to <new>; set tracker.scope.workspace to <new> in .pmkit/config.yaml`. The caller adds it to the command's warnings. |
| Neither | `AUTH`, `LINEAR_API_KEY belongs to workspace <urlKey>, and .pmkit/config.yaml names <workspace>`, next step `Export a LINEAR_API_KEY created in the <workspace> workspace` (ADR-0005). |
| No `organization` in `data` | `UPSTREAM`, `Linear returned no organization for this key`. |
| No workspace and `requireWorkspace: false` | Pass with `pinned: false`. |

### Sending a request

Each attempt sends `POST LINEAR_ENDPOINT` with `Content-Type: application/json`, `Authorization: <key>`, a body of `{ query, variables }` and `signal: AbortSignal.timeout(timeoutMs)`. Node 18 has both `fetch` and `AbortSignal.timeout`. The client reads the response as text, records the rate-limit headers, then parses the JSON.

Before it sends, the client checks the rate state. When the last response said a bucket has 0 remaining and its reset is still in the future, the client throws `RATE_LIMITED` and sends nothing.

### Error mapping

The client checks the rows in order and stops at the first match. The first three rows and the `AUTH` next steps come from ADR-0005.

| Case | Code | Message | Next step | Retried |
|---|---|---|---|---|
| `LINEAR_API_KEY` missing, empty or malformed | `AUTH` | see "The credential" | see "The credential" | no |
| HTTP 401, or an error with `extensions.code` `AUTHENTICATION_ERROR` | `AUTH` | `Linear rejected LINEAR_API_KEY` | `Create a key in Linear, Settings, Security & access, and export it as LINEAR_API_KEY` | no |
| Key of another workspace | `AUTH` | see "Workspace pin" | see "Workspace pin" | no |
| HTTP 403, or `FORBIDDEN` | `AUTH` | `Linear refused the request for this key` | `Check the key's permissions in Linear, Settings, Security & access` | no |
| HTTP 429, `RATELIMITED`, or a bucket at 0 before sending | `RATE_LIMITED` | `Linear's <requests or complexity> limit for this key is used up` | `Wait until <resetAt> and retry`, or `Wait a few minutes and retry` with no reset header | no |
| Network failure, timeout, HTTP 5xx | `UPSTREAM` | `Linear did not answer: <reason>` | `Retry, and check status.linear.app if it keeps failing` | queries only |
| The same, on a mutation | `UPSTREAM` | `Linear did not confirm the change: <reason>` | `Check in Linear whether the change was applied before you retry` | no |
| `GRAPHQL_VALIDATION_FAILED` or `GRAPHQL_PARSE_FAILED` | `UPSTREAM` | `Linear rejected pmkit's query: <Linear message>` | `Update pmkit; if it still fails, report the query error` | no |
| Any other GraphQL error | `UPSTREAM` | `Linear answered with an error: <Linear message>` | `Check the request against Linear's message` | no |
| A body that is not JSON, or JSON with neither `data` nor `errors` | `UPSTREAM` | `Linear returned an unreadable answer (HTTP <status>)` | `Retry, and check status.linear.app if it keeps failing` | queries only when HTTP 5xx |
| The same, on a mutation, at any status | `UPSTREAM` | `Linear did not confirm the change: unreadable answer (HTTP <status>)` | `Check in Linear whether the change was applied before you retry` | no |
| Any other HTTP status that is not 2xx, with an envelope and no errors | `UPSTREAM` | `Linear answered HTTP <status>` | `Retry, and check status.linear.app if it keeps failing` | no |
| The same, on a mutation | `UPSTREAM` | `Linear did not confirm the change: HTTP <status>` | `Check in Linear whether the change was applied before you retry` | no |

Rules that apply to every row:

- `<reason>` is `timed out after <n> s`, or the `code` of the `fetch` error's `cause` when it matches `^[A-Z][A-Z0-9_]*$` (such as `ETIMEDOUT` or `ENOTFOUND`), or `network error`. The client never copies a `fetch` error's message, which can quote a header **(builder's call)**.
- `<Linear message>` is the first error's `userPresentableMessage`, or its `message`, cut to 200 characters. Linear writes it, and it never holds the request headers.
- `details.linear` holds `{ status, errors: [{ code, type, path, userError }] }`. PMK-35 reads it to turn `INPUT_ERROR` on `path: ["issue"]` into `NOT_FOUND`, and `INVALID_INPUT` into `INVALID_INPUT`. The client does not guess those codes from messages. The CLI prints no `details`.
- When `errors` comes with partial `data`, the client still throws. No caller in EPC-5 needs partial results, and a silent partial page would break paging **(builder's call)**.
- `<resetAt>` is the reset time of the bucket that ran out, from `x-ratelimit-requests-reset` or `x-ratelimit-complexity-reset`, as an ISO time in UTC.

### Retries and timeouts

- One attempt waits up to `timeoutMs`, 30 s by default. The two calls PMK-28 measured took 0.3 s to 1.1 s, so 30 s leaves room for a slow page and still stops a hung socket.
- A query that fails with a network error, a timeout or HTTP 5xx is sent again, at most `retries` times (2 by default), after 500 ms and then 2000 ms through the injected `sleep`. The worst case is 3 attempts and about 92 s.
- A mutation is sent once. A timeout, a 5xx or an unreadable answer after the body left gives no way to tell whether Linear applied the change, so the client hands that choice to the user through the next step.
- `isMutation(document)` decides. A document is safe to retry only when it holds no `mutation` operation at all. The client reads the keyword that opens each top-level definition (`query`, `mutation`, `subscription`, `fragment`, or `{` for an anonymous query), and skips strings, block strings and `#` comments, so `fragment F on Issue { id } mutation M { ... }` counts as a mutation and a `"mutation"` inside a string does not. A document it cannot read counts as a mutation: an unclosed string, unbalanced brackets or an unknown keyword. A wrong yes costs a retry. A wrong no can apply a change twice. PMK-35 will send documents that hold fragments.
- The client never retries `AUTH`, `RATE_LIMITED` or a GraphQL error, and never sleeps until a rate-limit reset. A personal key's window is one hour, which is longer than a CLI run should wait.

### Paging

Linear lists are Relay connections. The caller writes the document with `$first: Int!` and `$after: String`, and requests `pageInfo { hasNextPage endCursor }` and `nodes` on the connection.

```js
await client.paginate(
  'query Issues($teamId: ID, $first: Int!, $after: String) { issues(first: $first, after: $after, filter: { team: { id: { eq: $teamId } } }) { pageInfo { hasNextPage endCursor } nodes { id identifier } } }',
  { teamId },
  { select: (data) => data.issues, pageSize: 100, limit: 500 },
) // => { nodes, hasMore }
```

- `select(data)` returns the connection. The caller picks it because a connection can sit at any depth, such as `team.issues`.
- Each page asks for `first = min(pageSize, limit - nodes so far)` and passes the last `endCursor` as `after`. Pages run one after another.
- `pageSize` defaults to 100 and must be an integer from 1 to 250, Linear's maximum. A value outside that range throws a `TypeError` before any request, because it is a bug in the caller.
- The loop stops when `hasNextPage` is false, when it holds `limit` nodes, or after `maxPages` pages. `hasMore` is true when it stopped while Linear still had a next page, so `hasMore: true` is how the result says it was truncated. PMK-35 turns that into a warning or passes `limit` through from `IssueFilter.limit`.
- A connection without `pageInfo` or `nodes`, a next page with no `endCursor`, or an `endCursor` equal to the one before throws `UPSTREAM`, `Linear returned a broken page for <operation name>`. The last check stops a loop that would never end.
- When the caller gives no `limit`, `maxPages` defaults to 10, so an unbounded call stops at 10 requests and at most 1000 nodes with the default page size, 0.4% of the hourly budget, and returns `hasMore: true` when Linear had more. When the caller gives a `limit`, the limit bounds the loop and there is no default page cap. An explicit `maxPages` applies in both cases and must be an integer of at least 1, or `paginate` throws a `TypeError` before any request (resolved question 2).

### Keeping the key out of output

- The key lives in one closure variable of the client. No returned object, error, `details`, warning or `rateLimit()` value holds it.
- Messages and next steps are fixed templates filled with status codes, error codes, URL keys, Linear's own messages and times.
- The client logs nothing and writes no file.

### Fake fetch

`scripts/fake-linear-api.mjs` exports `fakeLinearFetch(routes)`. It returns a `fetch` that records each call as `{ url, method, headers, body }` and answers from `routes`, keyed by GraphQL operation name. A route is a response `{ status, headers, json | text }`, a list of responses for successive calls (the last one repeats), a function of the parsed body, or `{ throws: error }` and `{ hang: true }`, which never answers until the signal aborts. A session route answers `PmkitSession` with workspace `acme` by default. A call to an operation with no route fails the test, as the fake `gh` does. `fake-hosted.mjs` stays as it is.

### Live check

`scripts/lib/linear/client-live.mjs` is a `node:test` file that skips every test unless `PMKIT_LIVE` is `1`, as `scenarios-live.mjs` and `verify-api.mjs` do.

```
set -a; . ./.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=<url key> node --test scripts/lib/linear/client-live.mjs
```

- `PMKIT_LIVE_WORKSPACE` names the expected URL key, so the real key and workspace stay out of the repository. Without it every test skips with a message.
- It wraps `globalThis.fetch` in a guard that refuses a mutation document, so the check stays read-only.
- It checks the session and the pin, `AUTH` for a wrong workspace and for a fake key, paging `issues` with `pageSize: 1` and `limit: 2` (two distinct nodes, filled `rateLimit()`), `UPSTREAM` with `GRAPHQL_VALIDATION_FAILED` for an unknown field, and `UPSTREAM` with `details.linear.errors[0].code` `INPUT_ERROR` for an unknown issue id.
- Every test checks that no error message, next step or `details` holds the key from the environment.

## Acceptance criteria map

| Criterion | Design part | Tests |
|---|---|---|
| 1. Calls the Linear GraphQL API with the credential chosen in the auth decision | "The credential", "The client", "Sending a request", "Workspace pin" | `credential.test.mjs`: the header equals the key with no `Bearer`; missing and empty keys give `AUTH` with `/pmkit:setup`; a key with a space, a newline or a `Bearer ` prefix gives `AUTH` and the message holds no part of the value. `client.test.mjs`: one request is a `POST` to `LINEAR_ENDPOINT` with the two headers and a body of `{ query, variables }`; creating a client sends nothing; a missing key fails at creation with zero calls; the session query goes first and only once, also for two concurrent calls; each row of the pin table; `requireWorkspace: false`. A test reads every `.mjs` file under `scripts/` and finds `env.LINEAR_API_KEY` or `env['LINEAR_API_KEY']` only in `credential.mjs` and in test files **(builder's call)**. |
| 2. Pages through results | "Paging" | Three pages of a fake connection come back in order, with each `after` equal to the previous `endCursor`; `limit` cuts the last page's `first` and sets `hasMore`; with no `limit`, the loop stops after 10 pages and sets `hasMore`; with a `limit` of 1500 and `pageSize` 100, it runs 15 pages; an explicit `maxPages` sets `hasMore`; `maxPages` 0 throws `TypeError`; `hasNextPage: false` stops; a missing `pageInfo`, a null cursor and a repeated cursor give `UPSTREAM`; `pageSize` 0, 251 and 1.5 throw `TypeError` with zero calls; a nested `select` works. |
| 3. Maps failures to `AUTH`, `RATE_LIMITED` and `UPSTREAM` with a next step | "Error mapping", "Retries and timeouts" | One test per table row asserts the code, the message and the next step. Retries: a query that fails twice with `ECONNRESET` and then passes resolves after two `sleep` calls of 500 and 2000; three failures give `UPSTREAM`; a mutation that times out gives the mutation message after one call; 401, 429, `RATELIMITED` and a validation error get one call each. A `hang` route with `timeoutMs: 20` gives `timed out`. A 0 remaining header makes the next request fail with zero calls until `now` passes the reset. `rateLimit()` reads the headers. A sweep runs every failure path with the fake key `lin_api_TESTKEYTESTKEYTESTKEY` and asserts that the key is in no message, next step, `JSON.stringify(details)`, `String(error)` or warning, including a `fetch` that throws an error whose message holds the key. |
| 4. `package.json` gains no dependency | Global `fetch` and `AbortSignal.timeout`, string documents | `plugin.test.mjs` already fails on a `dependencies` or `devDependencies` key. No new test. |
| Binding decision: secret-like keys in the tracker config | "The tracker config" | `secretKeyPaths` finds `tracker.token`, `tracker.scope.api_key`, `tracker.scope.apiKey` and a `lin_api_` value under `tracker.scope`; finds nothing in `{ system: 'linear', scope: { workspace: 'acme', team: 'ACME' } }`; `createLinearClient` throws `INVALID_INPUT` naming the path and not the value, with zero calls. |
| Binding decision: tests use a fake `fetch` | "Fake fetch" | `client.test.mjs` replaces `globalThis.fetch` with a function that fails the test for the whole file, so a client created without `fetch` in a test fails loudly **(builder's call)**. |
| Binding decision: live checks behind a variable | "Live check" | `client-live.mjs` skips without `PMKIT_LIVE=1`, and `npm test` does not load it. |

## Decisions

| Decision | Reason |
|---|---|
| A thin client with string documents (approach 1) | It is the smallest code that meets the criteria with no dependency, and PMK-35 writes each document once. |
| The client takes the `tracker` block, not a bare workspace string | It needs `scope.workspace` and must refuse secrets in the same block. One argument covers both. |
| The secret refusal throws at client creation, for reads and writes | A secret in a committed file needs attention before pmkit runs on it. Resolved question 1 keeps it in the client only. |
| `requireWorkspace` defaults to true | Every command except setup's `discover` must run pinned. Setup needs one call before it knows the URL key. |
| Retry queries on network errors, timeouts and 5xx, twice | PMK-28 saw one `ETIMEDOUT` pass on retry. A query has no side effect, so a retry is safe. |
| Never retry a mutation | After a timeout or a 5xx, nobody can tell whether Linear applied the change. A blind retry could create an issue twice. |
| No waiting for a rate-limit reset | The window is an hour. The error gives the reset time, and the agent or user decides. |
| GraphQL errors outside `AUTH` and `RATE_LIMITED` become `UPSTREAM` with `details.linear` | The client cannot tell a missing issue from a bad filter without the operation's context. PMK-35 has that context and remaps. |
| Default page size 100, cap 250 | Linear counts complexity on returned data, so the 2500 requests per hour budget is the tighter limit, and bigger pages spend fewer requests. 250 is Linear's maximum. |
| `paginate` returns `{ nodes, hasMore }` | A caller with a `limit` or a page cap needs to know that results were cut. |
| A default cap of 10 pages applies only when no `limit` is given | The user chose 10 pages over the 50 this spec first proposed. A careless query then costs at most 10 requests, and a caller that wants more passes a `limit` or a `maxPages`. |
| `verify-api.mjs` reads the key through `linearCredential` | ADR-0005 allows one reader of `LINEAR_API_KEY`. The tool then gets the same malformed-key check. |
| The live check uses `PMKIT_LIVE`, plus `PMKIT_LIVE_WORKSPACE` | `PMKIT_LIVE` already gates both live tools in the repository. The workspace comes from the environment, so the real URL key stays out of the public repository. |
| No ADR | ADR-0005 already records the credential, the pin and the error codes. The rest is design inside one module. |

## Risks

- The rate-limit response is not verified live. The client accepts both HTTP 429 and `RATELIMITED` at any status. PMK-39 or a later live run should record the real shape in `API-VERIFICATION.md`.
- Linear's docs mention a cap on complexity per query, which this run did not reach on a small workspace. A large workspace with nested connections may hit it. The error then maps to `UPSTREAM` with Linear's message, and PMK-35 lowers `pageSize` for that document.
- Node 18 prints an `ExperimentalWarning` on stderr at the first `fetch`. Tests use the fake and never see it. A Node 18 user will see one line per run. Node 22 prints nothing.
- `session().warnings` reaches the user only if the caller copies it into the command's warnings. PMK-33 owns that step.
- The secret check matches key names by substring, as the user store does, so a scope key such as `tokenizer` is refused. No Linear scope key needs such a name.
- No CLI command uses the client yet, so the CLI-level check "the fake key appears in no stdout or stderr" from the PMK-28 spec runs at the error level here and repeats in PMK-33 with `discover`.

## Resolved questions

The user answered these on 2026-10-27.

1. **Where else should the secret-key refusal run?** Only in `createLinearClient`. `validatePmkitConfig` and the schema do not change. `pmkit validate` lists the problem once PMK-33 adds `secretKeyPaths` to the Linear descriptor's `configProblems`.
2. **What is the default page cap of `paginate` when the caller gives no `limit`?** 10 pages, not the 50 this spec first recommended. Past the cap, the result returns `hasMore: true` to say it was truncated. See "Paging".
3. **Which issue registers `linear` in `ADAPTERS`?** PMK-33. Until then `tracker.system: linear` stays `NOT_SUPPORTED`, and this issue does not touch `scripts/lib/adapters.mjs`.

## Left to the builder

- The exact module layout inside `client.mjs` (one classifier function per stage is enough).
- Whether `fakeLinearFetch` keys routes by operation name only or also accepts a matcher function.
- The wording of messages beyond the templates above, as long as each names no secret.

## Self-review

- Placeholders: none. Each builder's call leaves every criterion as designed.
- Consistency: the error table, the retry rules and the tests name the same rows. "Session query" means `PmkitSession` everywhere. The workspace example is `acme` and the team example is `ACME`.
- Scope: two new modules, two test files, one test helper, one live check, a one-word export in `user-store.mjs` and a one-line change in `verify-api.mjs`. No command, no schema change, no ADR, no write to Linear.
- Boundaries: discovery, the manifest, the registry entry and the issue documents belong to PMK-33 and PMK-35, and "Where the client stops" says so.
