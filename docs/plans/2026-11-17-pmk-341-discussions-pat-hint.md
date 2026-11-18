# PMK-341 plan: name the Discussions permission in the fine-grained PAT hint

Design: `docs/specs/2026-11-17-pmk-341-discussions-pat-hint-design.md`. Small task, run in sequence by one agent, test first.

## Task 1: the client takes the permissions of a call

1. In `scripts/lib/github/client.test.mjs`, add failing tests: the PAT refusal with `{ permissions: 'Discussions' }` gives `Give the token read and write access to Discussions in its GitHub settings, or unset GH_TOKEN to use the gh login` on github.com and on `github.acme.com`; a query with options but no `permissions` keeps the PMK-85 step; `permissions` of `''`, `7` or `null` throws `TypeError` and runs no `gh`.
2. Run `node --test scripts/lib/github/client.test.mjs` and see them fail.
3. In `scripts/lib/github/client.mjs`, `request(document, variables, options)` checks `options.permissions` and passes it through `send`, `attemptGraphql` and `classify` to `refusal`, whose PAT row builds the step from it.
4. Run the file again and see it pass.

## Task 2: the discussions calls name Discussions

1. In `scripts/lib/github/discussions.test.mjs`, add a failing test: with `fake.failNext(<operation>, <PAT refusal>)`, `list`, `get` and `comment` reject with `AUTH` and the Discussions step.
2. Run it and see it fail.
3. In `scripts/lib/github/discussions.mjs`, send every request with `{ permissions: 'Discussions' }`.
4. Run it and see it pass.

## Task 3: the runbook

1. Add step 9 to `docs/runbooks/discussions-github.md`: a token without the Discussions permission, `github discussions get 1 --json`, exit code 2, `AUTH` and the Discussions step.
2. Add its E2E check in `scripts/runbook-discussions-github.test.mjs`: seed `failNext('PmkitDiscussion', ...)` in the fake's state, run the command, assert the error.
3. Run `node --test scripts/runbook-discussions-github.test.mjs`.

## Task 4: docs and the full suite

1. Add a dated note under the PAT row of the PMK-85 design, and a CHANGELOG entry under Unreleased.
2. Run `npm test` and compare the failures with the known PMK-333 list.
