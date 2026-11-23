# PMK-81 design: the Bitbucket Cloud git host

Issue PMK-81, epic EPC-7 (Jira tracker adapter and Bitbucket git host), milestone `jira`. Status: approved by the coordinator on 2026-11-23, with the Interview answers below. The owner chose the credential (1A), the scope (2A) and the build approach (3A) on 2026-11-23, through the coordinator. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The acceptance criterion: "Implements the git host contract for Bitbucket Cloud: branches, pull requests, pipelines and deployments." Today `git_host.system` is `github` or `none` (`scripts/lib/config.mjs` `GIT_HOSTS`), and `makeHost` in `scripts/pmkit.mjs` builds only `createGithubHost` (`scripts/lib/github/host.mjs`). That host reaches GitHub through `gh` and `git` with `spawnSync`. A team on Jira with Bitbucket, the pairing EPC-7 exists for, gets no pull request, CI or deploy state from pmkit.

ADR 0013 decided the Jira credential and left the Bitbucket Cloud credential to this issue.

## Facts checked (2026-11-23, Atlassian docs and the published OpenAPI spec; no live Bitbucket account)

| Fact | Source |
|---|---|
| App passwords are retired: no new ones since 2025-09-09, all disabled on 2026-06-09 (third-party reports say the final cut moved to 2026-07-28). Only API tokens work. | atlassian.com/blog/bitbucket, phase two of app password deprecation |
| A token used for Bitbucket APIs "must have scopes". The classic unscoped token ADR 0013 uses for Jira is not one of them. | support.atlassian.com/bitbucket-cloud/docs/using-api-tokens |
| A scoped user API token authenticates REST as `Authorization: Bearer <token>`, which the page says "removes the need to provide the Atlassian email tied to the API token", or as Basic `email:token`. Repository and workspace access tokens are Bearer. | same page, checked 2026-11-23; not checked live (follow-up in EPC-14). If the live check shows Bearer fails for user tokens, a new ADR decides the fallback |
| API tokens expire after 1 to 365 days, chosen at creation. | same page and atlassian.com API token docs |
| Scopes: `read:repository:bitbucket`, `read:pullrequest:bitbucket`, `write:pullrequest:bitbucket`, `read:pipeline:bitbucket`. Deployments read with `read:pipeline:bitbucket`. | `x-atlassian-oauth2-scopes` in api.bitbucket.org swagger |
| A pull request has `id`, `title`, `state` (`OPEN`, `MERGED`, `DECLINED`, `SUPERSEDED`), `draft`, `source`/`destination` (branch name, short commit hash), `author`, `participants` (state `approved`, `changes_requested` or none), `created_on`, `updated_on`, `links.html`. No `merged_on`. | swagger `pullrequest` |
| Endpoints used: `GET/POST /2.0/repositories/{ws}/{slug}/pullrequests` (`q`, `state`, `sort`, `pagelen`), `GET/PUT .../pullrequests/{id}`, `.../pullrequests/{id}/statuses`, `.../pullrequests/{id}/diff`, `GET .../pipelines` (filters `target.branch`, `sort`), `.../pipelines/{uuid}/steps`, `.../pipelines/{uuid}/steps/{step_uuid}/log`, `GET .../deployments`, `GET .../environments`. Lists page with `next` URLs. | swagger paths |
| Commit status states: `SUCCESSFUL`, `FAILED`, `INPROGRESS`, `STOPPED`. | swagger `commitstatus` |

## Decisions from the owner

1. **Credential (1A).** One environment variable, `BITBUCKET_TOKEN`, sent as `Authorization: Bearer <token>`. It accepts a scoped user API token and a repository or workspace access token (CI). No email. pmkit stores nothing, never prints the token, and reads no `.env` file, as ADR 0013 says for Jira. `git push` keeps the user's own git credentials. A new ADR records it.
2. **Scope (2A).** Bitbucket serves: `issues branch`, `pr open`, `pr ready`, `pr status`, `pr sync`, `pr diff`, `ci logs`, `deploys list`, and the host reads that `risks`, `release-readiness` and `issues track-agents` make. `pr review`, `pr blockers` and the review requests of `inbox list` answer `NOT_SUPPORTED` on Bitbucket with a next step, and are filed as follow-ups in EPC-14. `pr status` shows the pull request, its build statuses and its approvals, with blockers "not verified on Bitbucket".
3. **Build (3A).** The Bitbucket host calls the REST API with `fetch`, injected so `npm test` opens no socket, like the Jira client. Every caller `await`s each host call; for the GitHub host, which stays synchronous and unchanged, the `await` is a no-op.

Also approved: Bitbucket Cloud (`api.bitbucket.org`) only, no Data Center (Atlassian ends it on 2029-03-28, as ADR 0013 notes); `git_host.system: bitbucket` with `git_host.repo: <workspace>/<repo_slug>`.

## Goals

- `git_host.system: bitbucket` loads, validates and is detected from a `bitbucket.org` origin by `init` and `link-repo`.
- Every command of decision 2 works on Bitbucket with the same JSON shape it has on GitHub, so `/pmkit:*` command files need no Bitbucket branch.
- The commands outside decision 2 fail with `NOT_SUPPORTED` and a next step, never with a crash or an empty answer that reads as "nothing".

## Non-goals

- `pr review`, `pr blockers`, inbox review requests on Bitbucket (follow-ups in EPC-14).
- Bitbucket Data Center, OAuth 2.0 apps, app passwords, Basic `email:token`.
- Bitbucket as a tracker (Bitbucket has no issue tracker worth adapting; Jira is the tracker).
- Live checks against a real Bitbucket account (none exists; follow-up in EPC-14, as for Jira).

## Anti-goals

- The token in output, an argument, an error message or its `details`, a file, or the transcript.
- A Bitbucket answer that looks like GitHub's "no checks" or "no deploys" when the read failed or was cut.
- Changing the GitHub host's behavior or its tests.

## Approaches considered

- **3A, fetch with awaited callers. Chosen.** Mirrors the Jira client (injected `fetch`, fake in tests). The cost is adding `await` at each host call site and making the few sync helpers that call the host (`reviewRequests` in inbox, the `collectBlockers` call sites) async or GitHub-only.
- 3B, `curl` through `spawnSync`. Rejected: adds a binary pmkit does not otherwise need, and the token would have to go through stdin to stay out of `ps`.
- 3C, synchronous fetch in a worker thread with `Atomics.wait`. Rejected: much more code to keep a contract that one `await` per call site keeps as well.
- 1B, Basic `email:token`. Rejected by the owner: two variables and no access tokens.
- 2B, full GitHub parity. Rejected by the owner for this issue: about double the 8-point estimate.

## Design

### Config and detection

- `GIT_HOSTS` becomes `['github', 'bitbucket', 'none']`. `git_host.repo` is required for `bitbucket`, as `workspace/repo_slug` (two segments, each `[A-Za-z0-9._-]+`); validation names the problem.
- `inferHost` (`scripts/lib/git-remote.mjs`) reads `bitbucket.org` (https and `git@bitbucket.org:` forms) as `{ system: 'bitbucket', repo: 'workspace/slug' }`. `webHost` returns `bitbucket.org` for it.
- `init --git-host bitbucket` and `link-repo --git-host bitbucket` write it; `--git-host` messages list the three values.
- The schema in `schemas/` gains `bitbucket` in the enum.

### The host

`scripts/lib/bitbucket/host.mjs` exports `createBitbucketHost({ root, env, repo, fetch })`. **(builder's call)** The git-only methods of the GitHub host (`currentBranch`, `createBranch`, `push`, `localDiff`, `workingTree`, `branchHas`, `unpushedCommits`) move unchanged into a shared `scripts/lib/git-local.mjs` that both hosts spread in, so neither host duplicates them and the GitHub host's behavior does not change.

`scripts/lib/bitbucket/credential.mjs` is the only reader of `BITBUCKET_TOKEN`: missing or empty is `AUTH` "BITBUCKET_TOKEN is not set" with next step `/pmkit:setup`; a value that is not bare printable ASCII (quotes, spaces, a `Bearer ` prefix) is `AUTH` with the same "export it as shown" step as Jira.

Requests go only to `https://api.bitbucket.org/2.0/repositories/<workspace>/<slug>/...`, with the path segments URI-encoded and branch names only in query values or JSON bodies. The client follows `next` links only when they stay on `api.bitbucket.org`.

Error mapping, as ADR 0013 does for Jira: 401 is `AUTH` (the message says the token may have expired or lack a scope), 403 is `UPSTREAM` with `httpStatus: 403` (so readers that tolerate a refused read keep doing so), 404 on the repository is `NOT_CONFIGURED` ("git_host.repo ... not found or not visible to the token"), 429 is `RATE_LIMITED`, network failures and 5xx are `UPSTREAM`, retried twice for reads only. A write that gets no answer says to check Bitbucket before retrying.

Method mapping, returning the GitHub host's shapes:

| Method | Bitbucket call | Mapping |
|---|---|---|
| `getPullRequest({ head \| number }, { detail })` | `GET pullrequests?q=source.branch.name="<head>"&state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED&sort=-created_on`, or `GET pullrequests/{id}` | The open one first, else the newest **(builder's call: gh's order)**. `state` `DECLINED`/`SUPERSEDED` → `CLOSED`; `mergedAt` = `updated_on` when `MERGED`, else null; `isDraft` = `draft`; `headRefName` = source branch; `author` = `{ login: nickname, is_bot: type === 'app_user' }`. `detail` carries `baseRefName` and `reviews` from `participants` (`APPROVED`, `CHANGES_REQUESTED`). |
| `openPullRequest` | `POST pullrequests` `{ title, description, source, destination, draft }` | then `getPullRequest({ head })` |
| `markReady(n)` | `PUT pullrequests/{n}` `{ draft: false }` | |
| `prChecks(n)` | `GET pullrequests/{n}/statuses` (all pages) | `{ name, state, bucket, link, runId }`: `SUCCESSFUL` pass, `FAILED` fail, `STOPPED` cancel, `INPROGRESS` pending; `runId` = the pipeline build number from a Pipelines status link, else null |
| `listPullRequests()` | `GET pullrequests?state=OPEN&sort=-created_on` up to 200, plus `statuses` per pull request | `statusCheckRollup` as GitHub status contexts (`{ context, state }`). **ponytail:** one statuses call per open pull request; a repository with many open pull requests makes many calls |
| `prRefs(n)` | `GET pullrequests/{n}` | `baseRefName`, `headRefOid` (Bitbucket's short hash; `branchHas` works with it) |
| `prDiff(n)` | `GET pullrequests/{n}/diff` (text, redirect followed) | null on a too-large refusal, as GitHub's 406 |
| `listRuns({ branch })` | `GET pipelines?target.branch=<b>&sort=-created_on&pagelen=50` | `{ databaseId: build_number, workflowName: target.selector.pattern ?? target.selector.type, status, conclusion, url, createdAt, headSha }`; `COMPLETED` → `completed`, result `SUCCESSFUL` → `success`, `FAILED`/`ERROR` → `failure`, `STOPPED` → `cancelled` |
| `ciLogs({ branch \| runId })` | the run as above, then `pipelines/{uuid}/steps` and each failed step's `log` | the failed steps' logs joined with a header per step; `--run` takes the build number, found by walking `GET pipelines?sort=-created_on` **(ponytail: up to 500 runs; a newer API filter if one appears)** |
| `listDeploys({ environment, ref, limit })` | `GET environments` (names) and `GET deployments` | `{ id: uuid, environment: name, ref: null, sha: release.commit.hash, createdAt, state, url: release.url }` (a Bitbucket release names a pipeline, such as `#42`, not a git ref, so `ref` is null and a `ref` filter matches nothing); `state` from `state.status.name` (`successful`, `failed`, `stopped` → `inactive`) or `in_progress`; filters applied to the list read |

`postReview`, `prThreads`, `branchProtection`, `branchRules` and `listReviewRequests` are absent. `makeHost` returns `{ system, ...methods }` for both hosts. `inbox list` keeps working on Bitbucket: its review requests come back in the existing degraded shape, `{ verified: false, code: 'NOT_SUPPORTED', reason: 'review requests are not read on Bitbucket yet' }`, shown as "review requests not verified" **(builder's call: refusing the whole inbox would break the tracker part for every Jira and Bitbucket user)**. `pr review` and `pr blockers` name Bitbucket in their `unsupportedOn` property, and the command runner throws `NOT_SUPPORTED` when the command first asks for the host, before any read: "pr blockers is not supported on Bitbucket yet" with next step "Read the merge checks on the pull request page" (each command names its own). `pr status` and `issues track-agents` skip `collectBlockers` on Bitbucket and report `blocked: null` with one `unchecked` entry `{ area: 'blockers', code: 'NOT_SUPPORTED', message: 'blockers are not verified on Bitbucket' }`, which their existing text already shows as "not verified".

`release-readiness` matches a deploy to the release by its git ref. Bitbucket deploys have none (`ref: null`), so `matchesRelease` is `null` for them, not `false`, and the text says the tag match is not verified on Bitbucket; the two tag lookups by `ref` are skipped on Bitbucket **(builder's call: never report "not deployed" from a read that cannot tell)**.

Messages that say "GitHub" in shared commands (for example "GitHub rate limit reached earlier in this run") name the configured host **(builder's call)**.

### Capability manifest

`linked_code` stays `derived` with `source: 'git'`; for Bitbucket its detail gains `host: 'bitbucket'` and lists `pr review` and `pr blockers` as `unsupported`, with inbox review requests noted **(builder's call)**, so `capabilities` tells an agent before it calls them.

### Setup

`/pmkit:setup` and `link-repo` accept `bitbucket`. On `bitbucket`, setup tells the user to create an Atlassian API token with the four scopes above at id.atlassian.com (or a repository access token), and to export `BITBUCKET_TOKEN` in the shell profile or `~/.claude/settings.json` `env`, never in the repository. Setup never asks for the token. **(builder's call)** setup reads `GET repositories/<workspace>/<slug>` once to confirm the token and repo before writing, reporting `AUTH` or `NOT_CONFIGURED` as above.

### Docs

- ADR 0018: "Bitbucket Cloud only, with a scoped token from `BITBUCKET_TOKEN` sent as Bearer".
- `CONTEXT.md`: **Git host** lists `bitbucket`; Bitbucket's "workspace" is the first half of `git_host.repo` and is not the Linear **Workspace** (added to its _Avoid_ list or a note).
- README and the command files that name `github` as the only git host.

## Tests

- Unit (`node:test`, injected `fetch`): credential rules, each method's mapping, paging, the error mapping, a fake token in no output, and the `NOT_SUPPORTED` paths.
- E2E: `docs/runbooks/git-host-bitbucket.md` with `scripts/runbook-git-host-bitbucket.test.mjs`, the real CLI as a subprocess with `globalThis.fetch` replaced by a stateful fake Bitbucket (as `fake-jira-api.mjs`), and a local bare repository as origin for branch and push: `link-repo` detection, `issues branch`, `pr open` (draft), `pr ready`, `pr status`, `pr diff`, `pr sync` after a merge, `ci logs`, `deploys list`, `pr blockers` refused.
- The GitHub tests stay as they are; they must pass unchanged after the `await` change.

## Left to the builder

The order of tasks, the shape of the fake, the per-step log header text, and where the `host.system` check sits, within the decisions above.

## Follow-ups for EPC-14

- Live check against a Bitbucket Cloud repository (token scopes, Bearer with a user API token, `next` links, diff size limit, build number lookup).
- `pr review` on Bitbucket (inline comments through `pullrequests/{id}/comments`).
- `pr blockers` on Bitbucket (merge checks, branch restrictions, tasks, unresolved comments).
- Inbox review requests on Bitbucket (reviewers of open pull requests).

## Interview answers (2026-11-23, approved through the coordinator)

- Q1. `inbox list` keeps working on Bitbucket; only its review requests come back `verified: false` with `code: 'NOT_SUPPORTED'`.
- Q2. `release-readiness`: Bitbucket deploys have `ref: null`, so `matchesRelease` is `null` ("not verified on Bitbucket"), never `false`.
- Q3. `pr open` does not set `close_source_branch`; the repository default applies.
- Q4. Setup and `link-repo` on `bitbucket` read `GET repositories/<workspace>/<slug>` once to confirm the token and repo before writing; they never ask for the token.
- Q5. Accepted ceilings: one statuses read per open pull request in `listPullRequests` (up to 200), and `ci logs --run <build number>` searches the 500 newest pipelines.
- ADR 0018 records the credential. `CONTEXT.md` updates **Git host** and lists the Bitbucket workspace under **Workspace**'s _Avoid_.
