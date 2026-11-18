# PMK-341 design: name the Discussions permission in the fine-grained PAT hint

Issue PMK-341, epic EPC-8 (GitHub Issues tracker adapter), milestone `github-issues`. Found while working PMK-90 (PR #313). Status: approved by the user on 2026-11-17. The user answered one question on 2026-11-17, and "Decision from the user" records the answer. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

When GitHub refuses a fine-grained PAT ("Resource not accessible by personal access token"), the GitHub client returns `AUTH` with one next step for every call: `Give the token read and write access to Projects and Issues in its GitHub settings, or unset GH_TOKEN and run gh auth refresh -s project` (PMK-85, question 2). A `github discussions` call fails because the token lacks the Discussions permission, so that step names the wrong permissions and a scope the call does not need.

Acceptance criterion:

1. A discussions call refused for a fine-grained PAT gives a next step that names the Discussions permission.

## Decisions already made

- ADR 0007: pmkit reaches GitHub through `gh api graphql`, holds no token, and maps a fine-grained PAT's "not accessible" error to `AUTH`.
- PMK-85, question 2: the PAT row of the error table and its next step. This spec keeps that step for every call that does not name a permission.
- PMK-90: the `github discussions list`, `get` and `comment` calls live in `scripts/lib/github/discussions.mjs` and use the shared client. The `repo` scope that `gh auth login` grants covers reading and commenting on discussions.

## Decision from the user

The next step of a refused discussions call reads:

`Give the token read and write access to Discussions in its GitHub settings, or unset GH_TOKEN to use the gh login`

Why: discussions need the PAT's Discussions repository permission, and the gh login's default `repo` scope covers them, so `gh auth refresh -s project` would send the user after a scope the call does not need. The message of the error does not change: `GitHub refused the personal access token: <GitHub message>`.

## Design

### The client

`client.request(document, variables, options)` takes an optional third argument. `options.permissions` is a string that names the fine-grained PAT permissions the call needs, such as `'Discussions'`. With it, the PAT row's next step is `Give the token read and write access to <permissions> in its GitHub settings, or unset GH_TOKEN to use the gh login`. Without it, the step stays the PMK-85 one, with `gh auth refresh -s project<host step>`.

- A value of `permissions` that is not a non-empty string throws a `TypeError` before any call, as `request` does for a bad document. That is a bug in the caller **(builder's call)**.
- Only the PAT row reads `permissions`. Every other row of the error table, the retries and the rate-limit buckets stay as they are.
- `paginate` and `rest` take no permissions for now: no caller needs them. Adding them later means passing the same option to the shared refusal check **(builder's call)**.

### The discussions calls

`discussionOperations` sends every request (`PmkitDiscussionCategories`, `PmkitDiscussions`, `PmkitDiscussion`, `PmkitAddDiscussionComment`) with `{ permissions: 'Discussions' }`. The issue created by `/pmkit:github:discussions` goes through `issues create`, which keeps the existing step.

### Files

| File | What changes |
|---|---|
| `scripts/lib/github/client.mjs` | `request` takes `options`, and the PAT row of `refusal` builds its step from `options.permissions`. |
| `scripts/lib/github/discussions.mjs` | Every request passes `{ permissions: 'Discussions' }`. |
| `docs/runbooks/discussions-github.md` | A new step: a token without the Discussions permission. |
| `scripts/runbook-discussions-github.test.mjs` | Runs that step with the fake `gh`. |
| `docs/specs/2026-11-16-pmk-85-github-graphql-client-design.md` | A note on the PAT row: a caller can name the permissions. |
| `CHANGELOG.md` | One entry. |

No ADR changes, and CONTEXT.md gets no new term. The manifest does not change, and nothing new is `NOT_SUPPORTED`.

## Tests

- Unit (`scripts/lib/github/client.test.mjs`): the PAT refusal with `permissions: 'Discussions'` gives the Discussions step on github.com and on a GHES host; without options the step is unchanged; a bad `permissions` value throws `TypeError` and runs no `gh`.
- Unit (`scripts/lib/github/discussions.test.mjs`): `list`, `get` and `comment` refused for a fine-grained PAT give the Discussions step.
- E2E: the runbook step runs `github discussions get 1 --json` after the fake GitHub refuses the PAT once, and expects exit code 2, `AUTH` and the Discussions step.

## Non-goals

- A different hint for other GitHub-only calls (draft issues, Project reads). They keep the PMK-85 step.
- Naming `GH_ENTERPRISE_TOKEN` in the step on GHES. The PMK-85 step names `GH_TOKEN` only, and this one follows it.
