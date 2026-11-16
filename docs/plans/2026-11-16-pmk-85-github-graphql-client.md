# PMK-85 GitHub GraphQL client implementation plan

> **For agentic workers:** use superpowers:executing-plans to run this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `scripts/lib/github/client.mjs`, a GraphQL client that runs `gh api graphql`, reuses the `gh` login and maps every failure to a pmkit error code.

**Architecture:** The client builds one `gh api [--hostname <host>] graphql --include --input -` call per attempt and sends `{ query, variables }` on stdin. It reads the status line, the headers and the body from stdout, and stderr when no answer came. A pure `classify` function turns one result into data or a `PmkitError`. `request` adds retries and the rate-limit check, and `paginate` loops over a connection. The runner is injected, so tests start no `gh`.

**Tech stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. `npm test` runs the suite.

**Spec:** `docs/specs/2026-11-16-pmk-85-github-graphql-client-design.md`. Where this plan and the spec differ, the spec wins.

## Global constraints

- The client reads no variable from `env`, and no token goes on argv, in a message, a next step or `details`.
- No variable value goes on the `gh` command line. The query and the variables go on stdin.
- A mutation is sent once.
- `npm test` starts no `gh` process. `package.json` gains no dependency. `package-lock.json` stays untracked.
- Every commit message carries `(PMK-85)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- All prose follows `~/.claude/skills/unslop/SKILL.md`.

## Criteria map

| Criterion | Tasks |
|---|---|
| 1. Calls the GitHub GraphQL API, reusing the `gh` login | Task 2 (request), Task 5 (paging) |
| 2. Maps failures to the pmkit error codes | Task 3 (error table), Task 4 (retries and rate limit) |

## Task 1: move the GraphQL helpers

- [ ] Write `scripts/graphql.test.mjs`: `isMutation` and `operationName` imported from `./lib/graphql.mjs` (a mutation after a fragment counts, a `"mutation"` in a string does not, an unreadable document counts as a mutation, names skip fragments). Run it and see it fail on the missing module.
- [ ] Create `scripts/lib/graphql.mjs` with `definitions`, `isMutation` and `operationName` moved from `scripts/lib/linear/client.mjs`. In the Linear client, import both and re-export them.
- [ ] Run `node --test scripts/graphql.test.mjs scripts/lib/linear/client.test.mjs scripts/fake-linear-api.test.mjs`. All pass.
- [ ] Commit: `refactor: move the GraphQL document helpers to lib/graphql.mjs (PMK-85)`.

## Task 2: the request path

- [ ] In `scripts/lib/github/client.test.mjs`, write a fake runner (a queue of results or throwers that records `cmd`, `args`, `input`, `timeout`) and an `answer({ status, headers, body, stderr, exit })` helper that writes the `--include` format. Tests: a query returns `data`; argv is `['api', 'graphql', '--include', '--input', '-']`; stdin is `{ query, variables }`; with `host` argv is `['api', '--hostname', host, 'graphql', ...]`; an invalid `host` throws `INVALID_INPUT` before any call; `timeout` is 30 000 by default; a token-shaped `GH_TOKEN` in `env` never shows in argv or stdin. See them fail.
- [ ] Export `INSTALL_STEP` from `host.mjs`. Write `createGithubClient`, the stdout split into head and body, and the success path.
- [ ] Run the file. All pass. Commit: `feat: add the GitHub GraphQL client request path (PMK-85)`.

## Task 3: the error table

- [ ] One test per row of the spec's table, in order: ENOENT, ENOBUFS, no login (with and without the host step, `github.com` gets none, `acme.ghe.com` gets one), HTTP 401, INSUFFICIENT_SCOPES (`project` and `read:org`), the PAT error, SAML, RATE_LIMITED, 429 and a 403 rate limit, other FORBIDDEN and 403, NOT_FOUND with partial data, parse and validation errors, other GraphQL errors, an unreadable body, an unknown failure with no answer. Each checks `code`, `message`, `nextStep`, and `details.github` where the row has one. A test sets `GH_TOKEN` and checks that no message, next step or `details` of these errors holds it. See them fail.
- [ ] Write `classify(result, { mutation, host })` and the helpers for the host step and the scope step.
- [ ] Run the file. All pass. Commit: `feat: map gh and GraphQL failures to pmkit error codes (PMK-85)`.

## Task 4: retries, timeouts and the rate limit

- [ ] Tests: a query retried after ETIMEDOUT, `error connecting to` and HTTP 502, with sleeps of 500 and 2000 ms and at most `retries + 1` attempts; a mutation never retried, with "did not confirm the change"; an unknown failure with no answer on a mutation is "did not confirm"; no retry on AUTH, NOT_FOUND or a GraphQL error; `rateLimit()` is null at first and then reads the headers; a call after an answer with `remaining: 0` and a future reset throws `RATE_LIMITED` with no runner call; `Retry-After` and the reset time in the next step. See them fail.
- [ ] Write the retry loop, the header reader, `rateLimit()` and the check before sending.
- [ ] Run the file. All pass. Commit: `feat: retry GitHub queries and track the rate limit (PMK-85)`.

## Task 5: paging

- [ ] Tests: two pages joined, with `first` and `after` in the variables; `limit` cuts the last page and gives `hasMore`; `maxPages` defaults to 10 without `limit`; `pageSize` above 100 throws `TypeError`; a missing `select`, `nodes` or `pageInfo`, a missing cursor and a repeated cursor throw. See them fail.
- [ ] Write `paginate`.
- [ ] Run the file. All pass. Commit: `feat: page through GitHub GraphQL connections (PMK-85)`.

## Task 6: verification

- [ ] Run `npm test`. Only the four known failures of PMK-333 may fail.
- [ ] Check that no runbook applies: no command calls the client yet.
- [ ] Commit the plan and any fix.
