# PMK-85 design: the GitHub GraphQL client

Issue PMK-85, epic EPC-8 (GitHub Issues tracker adapter), milestone `github-issues`. Status: approved by the user on 2026-11-16. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The GitHub Issues adapter reads and writes issues, sub-issues, dependencies and Projects v2 fields. Projects v2 has only a GraphQL API, so the adapter needs a GraphQL client before PMK-86 (discovery and setup) and PMK-87 (issues, sub-issues and dependencies) can start. ADR 0007 settles how the client reaches GitHub: it runs `gh api graphql` as a subprocess, reuses the `gh` login and never touches a token.

Acceptance criteria:

1. Calls the GitHub GraphQL API, reusing the `gh` login.
2. Maps failures to the pmkit error codes.

## Facts checked against `gh`

Checked on 2026-11-16 with gh 2.93.0 on this machine, with read-only queries on the user's own login.

| Check | Result |
|---|---|
| Host of `gh api graphql` | In a repository whose origin is `git@ghes.example.invalid:acme/widgets.git`, the call still went to `https://api.github.com/graphql`. `gh api` reads `--hostname`, else `GH_HOST`, else github.com. It never reads the git remote. |
| Body on stdin | `gh api graphql --input -` with `{"query": ..., "variables": {...}}` on stdin sends the body as it is. No variable passes through argv, so `gh`'s `-F` rules (a value that starts with `@` reads a file, `{owner}` is replaced) never apply. |
| `--include` | Prints the status line (`HTTP/2.0 200 OK`), the headers, a blank line and the body on stdout. The headers include `X-Ratelimit-Limit`, `X-Ratelimit-Remaining`, `X-Ratelimit-Reset` (Unix seconds), `X-Ratelimit-Used` and `X-Ratelimit-Resource`. |
| A GraphQL error | `gh` exits 1, prints the reply on stdout and `gh: <first message>` on stderr. The HTTP status stays 200. |
| Missing scope | `{"errors":[{"type":"INSUFFICIENT_SCOPES","message":"Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project'], but your token has only been granted the: [...] scopes. ..."}]}` |
| Not found | `{"data":{"repository":null},"errors":[{"type":"NOT_FOUND","path":["repository"],"message":"Could not resolve to a Repository with the name 'o/r'."}]}`. Partial data comes with the error. |
| Invalid query | A validation error has `extensions.code` (such as `undefinedField`) and no `type`. A parse error has neither. |
| No login | Exit 4, empty stdout, stderr `To get started with GitHub CLI, please run:  gh auth login`. The same holds for a GHES host with no login. |
| Bad token | Exit 1, stderr `gh: Bad credentials (HTTP 401)`. |
| No network | Exit 1, empty stdout, stderr `error connecting to <host>`. |
| `gh auth refresh` | Adds OAuth scopes to the token `gh` stores, for the host given with `-h`, else the default host. It cannot change a fine-grained PAT, which `gh` only gets from `GH_TOKEN` or `GH_ENTERPRISE_TOKEN`. |

## Goals

- One module, `scripts/lib/github/client.mjs`, that sends a GraphQL document through `gh api graphql` and returns `data`, or throws a `PmkitError`.
- An error table that maps each `gh` and GraphQL failure to a pmkit code, a message and a next step, following ADR 0007.
- Paging over GraphQL connections, as the Linear client does.
- Tests on an injected runner, so `npm test` starts no `gh` and opens no socket.

## Non-goals

- The tracker adapter, `discover`, the config key that names the host, and the GHES version check. PMK-86 owns them (ADR 0007, consequences table).
- Any query or mutation for issues, Projects or fields. PMK-86 and PMK-87 write them on top of this client.
- A live check against GitHub, like `scripts/lib/linear/client-live.mjs`. It is a follow-up candidate.
- REST calls. The client speaks GraphQL only. `gh api meta` belongs to PMK-86.

## Anti-goals

- The client never reads `GH_TOKEN`, `GH_ENTERPRISE_TOKEN` or any token, never passes one as an argument and never puts one in a message, a next step or `details`. It hands `env` to the runner and nothing else.
- The client never puts a variable value on the `gh` command line.
- The client never sends a mutation twice.

## Decisions from the user

### Question 1: the host

Answer: the client takes an optional `host`. When `host` is set, every call runs `gh api --hostname <host> graphql`. When it is not set, the client passes no flag, so `gh` uses `GH_HOST` or github.com. PMK-86 picks the config key that stores the host and fills it at setup. PMK-85 changes no config schema.

When `host` is set and is not `github.com`, every next step that names a `gh auth` command adds `-h <host>`: `gh auth login -h <host>`, `gh auth refresh -s project -h <host>`. That covers GHE.com (`*.ghe.com`) as well as GHES, because `gh auth` without `-h` acts on github.com. ADR 0007 names GHES only, and this extends it to GHE.com.

Why: `gh api` never reads the git remote (see the facts above), so the host has to come from the caller. The config reader arrives with the adapter in PMK-86, and reading the remote on each run would guess wrong for a fork or an SSH alias.

### Question 2: the fine-grained PAT error

Answer: a GraphQL `FORBIDDEN` error whose message holds "not accessible by personal access token" becomes `AUTH`, as ADR 0007 says, with its own next step: `Give the token read and write access to Projects and Issues in its GitHub settings, or unset GH_TOKEN and run gh auth refresh -s project` (plus `-h <host>`). `INSUFFICIENT_SCOPES` keeps the ADR's step, `gh auth refresh -s project`. No ADR changes.

Why: a fine-grained PAT reaches `gh` only through `GH_TOKEN` or `GH_ENTERPRISE_TOKEN`. It has permissions, not scopes, so `gh auth refresh` cannot fix it.

The user also accepted three related mappings:

- `INSUFFICIENT_SCOPES` names the scopes the field needs. When none of them is `project` or `read:project`, the next step names the first one, as in `gh auth refresh -s read:org`. Otherwise it is `-s project`.
- Any other `FORBIDDEN` error, or HTTP 403 that is not a rate limit, becomes `AUTH` with `Check that the gh account can read and write the repository and its Project`.
- A SAML refusal becomes `AUTH` with `Authorize the gh token for the organization's single sign-on on GitHub, then retry`.

## Design

### Files

| File | What changes |
|---|---|
| `scripts/lib/graphql.mjs` | New. `isMutation(document)` and `operationName(document)` move here from `scripts/lib/linear/client.mjs`, unchanged. Both clients need them, and the GitHub client must not import the Linear one **(builder's call)**. |
| `scripts/lib/linear/client.mjs` | Imports both from `../graphql.mjs` and re-exports them, so its callers and tests do not change. |
| `scripts/lib/github/host.mjs` | Exports `INSTALL_STEP`, so the client's `NOT_CONFIGURED` step is the git host's. |
| `scripts/lib/github/client.mjs` | New. `createGithubClient`. |
| `scripts/lib/github/client.test.mjs` | New. Unit tests on an injected runner. |
| `scripts/graphql.test.mjs` | New. A few tests that pin the moved helpers at their new path. |

### The client

```js
import { createGithubClient } from './lib/github/client.mjs'

const client = createGithubClient({ root, env, host }) // host is optional
const data = await client.request('query Repo($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id } }', { owner, name })
const { nodes, hasMore } = await client.paginate(document, variables, { select: (data) => data.repository.issues, pageSize: 100, limit: 500 })
client.rateLimit() // { limit, remaining, used, resource, resetAt } from the last answer, or null
```

Options of `createGithubClient`:

- `root` and `env`: the working folder and the environment of the `gh` process. They go to the runner unchanged.
- `host`: optional. It must be a host name, with an optional port (letters, digits, dots, dashes, then `:<digits>`), or the client throws `INVALID_INPUT` before any call. That check keeps a value such as `--jq` from reading as a `gh` option **(builder's call)**.
- `exec`: the runner, `defaultExec({ root, env })` from `host.mjs` by default. Tests inject a fake.
- `timeoutMs` (30 000), `retries` (2), `sleep` and `now`: as in the Linear client.

`request` and `paginate` return promises, as the Linear client's do, so the adapters share one shape **(builder's call)**.

### Sending a request

Each attempt runs:

```
gh api [--hostname <host>] graphql --include --input -
```

with `JSON.stringify({ query, variables })` on stdin and `timeout: timeoutMs`. The client splits stdout at the first blank line into the head (status line and headers) and the body. With no head, as when `gh` fails before an answer, the HTTP status is unknown and only stderr and the exit code count.

### Error mapping

The client checks the rows in order and stops at the first match. `<host step>` is ` -h <host>` when `host` is set and is not `github.com`, and empty otherwise.

| Case | Code | Message | Next step | Retried |
|---|---|---|---|---|
| The runner throws `ENOENT` | `NOT_CONFIGURED` | `gh is not installed` | `INSTALL_STEP` from `host.mjs` | no |
| The runner throws `ENOBUFS` | `UPSTREAM` | `gh api graphql output is too large to read` | `Ask for fewer nodes per page` | no |
| No answer and stderr names `gh auth login` | `AUTH` | `GitHub CLI is not logged in` | `gh auth login<host step>` | no |
| HTTP 401 | `AUTH` | `GitHub rejected the token of the gh login` | `Run gh auth login<host step>, or fix the token in GH_TOKEN or GH_ENTERPRISE_TOKEN` | no |
| `INSUFFICIENT_SCOPES` | `AUTH` | `The gh login lacks a scope this query needs: <GitHub message>` | `gh auth refresh -s <scope><host step>`, `<scope>` as in question 2 | no |
| `FORBIDDEN` with "not accessible by personal access token" | `AUTH` | `GitHub refused the personal access token: <GitHub message>` | the PAT step of question 2 | no |
| A message with "SAML" | `AUTH` | `The organization's single sign-on blocks the gh token: <GitHub message>` | `Authorize the gh token for the organization's single sign-on on GitHub, then retry` | no |
| `RATE_LIMITED`, HTTP 429, or HTTP 403 with "rate limit" in the body or stderr | `RATE_LIMITED` | `GitHub's rate limit for this login is used up` | `Wait <n> s and retry` from `Retry-After`, `Wait until <resetAt> and retry` when the limit is at 0, else `Wait a few minutes and retry` | no |
| `FORBIDDEN`, or HTTP 403 | `AUTH` | `GitHub refused the request for the gh login: <GitHub message>` | `Check that the gh account can read and write the repository and its Project` | no |
| `NOT_FOUND` | `NOT_FOUND` | `GitHub found nothing: <GitHub message>` | `Check the owner, repository and Project number, and that the gh account can see them` | no |
| The runner throws `ETIMEDOUT`, stderr says `error connecting to`, or HTTP 5xx, on a query | `UPSTREAM` | `GitHub did not answer: <reason>` | `Retry, and check githubstatus.com if it keeps failing` | yes |
| The same on a mutation, or any other failure with no answer on a mutation | `UPSTREAM` | `GitHub did not confirm the change: <reason>` | `Check on GitHub whether the change was applied before you retry` | no |
| A GraphQL error without `type` (a parse or validation error) | `UPSTREAM` | `GitHub rejected pmkit's query: <GitHub message>` | `Update pmkit; if it still fails, report the query error` | no |
| Any other GraphQL error | `UPSTREAM` | `GitHub answered with an error: <GitHub message>` | `Check the request against GitHub's message` | no |
| A body that is not JSON, or JSON with neither `data` nor `errors` | `UPSTREAM` | `GitHub returned an unreadable answer (HTTP <status>)` | `Update the GitHub CLI and retry` | no |
| The same on a mutation | `UPSTREAM` | `GitHub did not confirm the change: unreadable answer (HTTP <status>)` | `Check on GitHub whether the change was applied before you retry` | no |
| Any other HTTP status that is not 2xx, with data and no errors | `UPSTREAM` | `GitHub answered HTTP <status>` (on a mutation: `GitHub did not confirm the change: HTTP <status>`) | `Retry, and check githubstatus.com if it keeps failing` | no |
| Any other failure with no answer, on a query | `UPSTREAM` | `gh api graphql failed: <first stderr line>` | `Check the output of the same command in a terminal` | no |

Rules for every row:

- Any other error the runner throws, such as `EACCES`, is thrown as it is, as `host.mjs` does.
- `<GitHub message>` is the first error's `message` on one line, cut to 200 characters. For a 401 or 403 answer without `errors`, it is the body's `message`. GitHub writes it, and it never holds the token.
- `<reason>` is `timed out after <n> s`, `error connecting to <host>`, or `HTTP <status>`.
- `<first stderr line>` goes through `hideAbsolutePaths`, as in `host.mjs`.
- `details.github` holds `{ status, errors: [{ type, code, path }] }`, with `status` null when no answer came. PMK-87 reads it to tell, for example, which node a `NOT_FOUND` names. The CLI prints no `details`.
- When `errors` comes with partial `data`, the client still throws, as the Linear client does. No caller needs partial results yet, and a silent partial page would break paging **(builder's call)**.

### Retries and timeouts

As in the Linear client **(builder's call)**:

- One attempt waits up to `timeoutMs`, 30 s by default. `spawnSync` kills `gh` at the limit and the runner throws `ETIMEDOUT`.
- A query that times out, cannot connect or gets HTTP 5xx is sent again, at most `retries` times, after 500 ms and then 2000 ms.
- A mutation is sent once. `isMutation` from `scripts/lib/graphql.mjs` decides, and a document it cannot read counts as a mutation.
- The client never retries `AUTH`, `RATE_LIMITED`, `NOT_FOUND` or a GraphQL error, and never sleeps until a rate-limit reset.

### Rate limit

The client reads the `X-Ratelimit-*` headers of each answer it gets. `rateLimit()` returns the last values as `{ limit, remaining, used, resource, resetAt }`, with `resetAt` an ISO time, or null before the first answer. When the last answer said `remaining` is 0 and the reset is in the future, the next call throws `RATE_LIMITED` without starting `gh`.

### Paging

`paginate(document, variables, { select, pageSize, limit, maxPages })` works as the Linear client's does: the document takes `$first: Int!` and `$after: String`, `select(data)` returns the connection, and the result is `{ nodes, hasMore }`. `pageSize` is an integer from 1 to 100, GitHub's maximum for `first`. Without a `limit`, `maxPages` defaults to 10. A connection without `nodes` or `pageInfo`, a next page with no cursor, or a cursor equal to the one before throws `UPSTREAM`, `GitHub returned a broken page for <operation name>`.

### Keeping the token out

- The client reads no variable from `env`. It passes `env` to the runner.
- Argv holds only `api`, `--hostname <host>`, `graphql`, `--include` and `--input -`. The query and the variables go on stdin.
- Messages and next steps are fixed templates filled with the host, scopes, HTTP statuses, times and GitHub's own error messages.
- A test sets `GH_TOKEN` to a token-shaped value and checks that no argv, stdin, message, next step or `details` holds it.

### Fake runner

Tests inject `exec(cmd, args, { input, timeout })` that records each call and answers `{ status, stdout, stderr }` from a queue, or throws an error with a `code`. Helpers build an answer from a status, headers and a body in the `--include` format.

## Acceptance criteria map

| Criterion | Where |
|---|---|
| Calls the GitHub GraphQL API, reusing the `gh` login | `request` and `paginate` run `gh api graphql` through the runner, with the body on stdin and no token. Tests check the argv, the stdin and the `--hostname` flag. |
| Maps failures to the pmkit error codes | The error mapping table, one test per row. |

## Testing and verification

- `scripts/lib/github/client.test.mjs` covers each row of the error table, the retries (queries yes, mutations no), the host flag and the host steps, `rateLimit()` and the check before sending, paging, the `host` check and the token rule.
- `scripts/graphql.test.mjs` pins the moved helpers. The Linear tests keep passing through the re-export.
- `npm test` passes, apart from the four known failures on this machine (PMK-333).
- No runbook applies. The client is a library that no command calls yet, so no user flow changes. PMK-86 wires it to `/pmkit:setup`, and that issue adds the runbook.

## Left for later issues

- The config key for the host, and filling it from the git remote at setup: PMK-86.
- The GHES version check through `gh api meta`: PMK-86.
- A live check of the client against github.com, gated like the Linear live checks: a follow-up candidate.
