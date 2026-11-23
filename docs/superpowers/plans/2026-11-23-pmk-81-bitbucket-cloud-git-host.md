# Bitbucket Cloud git host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `git_host.system: bitbucket` makes pmkit's branch, pull request, pipeline and deploy commands work against Bitbucket Cloud with the same JSON they give on GitHub.

**Architecture:** A new `scripts/lib/bitbucket/` host calls `api.bitbucket.org/2.0` with an injected `fetch` and a `BITBUCKET_TOKEN` Bearer header. The git-only methods of the GitHub host move to a shared `scripts/lib/git-local.mjs`. The CLI awaits every host call (a no-op for the synchronous GitHub host) and refuses or degrades the GitHub-only reads on Bitbucket.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`, the existing fake-fetch pattern (`scripts/fake-jira-api.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-23-pmk-81-bitbucket-cloud-git-host-design.md` (read it; the method mapping table there is the contract for Tasks 4 and 5). ADR: `docs/adr/0018-bitbucket-cloud-only-with-a-scoped-token-from-the-environment.md`.

## Global Constraints

- No dependency, no `curl`, no `.env` reading. Node 18 runs the scripts and `npm test`.
- Only `scripts/lib/bitbucket/credential.mjs` reads `BITBUCKET_TOKEN`. Header: `Authorization: Bearer <token>`.
- The token never appears in stdout, stderr, an error `message`/`nextStep`/`details`, or a file. Every Bitbucket test that runs the CLI asserts this with the fake token.
- Requests go only to `https://api.bitbucket.org/2.0/repositories/<workspace>/<repo_slug>/...`; `next` links are followed only on host `api.bitbucket.org`.
- Error codes: missing/malformed token and 401 → `AUTH`; 403 → `UPSTREAM` with `httpStatus: 403`; 404 on the repository → `NOT_CONFIGURED`; 429 → `RATE_LIMITED`; network/5xx → `UPSTREAM` (reads retried twice, writes never).
- `git_host.repo` on Bitbucket: `workspace/repo_slug`, each part `[A-Za-z0-9._-]+`.
- GitHub host behavior and its existing tests stay unchanged.
- Every commit message ends with `(PMK-81)`.

## Review Focus

- A token pasted with a `Bearer ` prefix or quotes → `AUTH` "BITBUCKET_TOKEN is not a bare Bitbucket token", no request sent (Task 3).
- A branch name with `"` or spaces in `getPullRequest({ head })` → the `q` filter escapes it and never matches another branch (Task 4).
- A `next` link to another host → `UPSTREAM`, never followed with the token (Task 3).
- A repository whose PR read is refused (403) inside `risks` → the PR section says "not checked", the command still ends (Task 6).
- `pr sync` with a `DECLINED` pull request → the issue is not moved to done (Task 4 mapping, Task 8 E2E).

---

### Task 1: Config, schema and remote detection

**Files:**
- Modify: `scripts/lib/config.mjs` (`GIT_HOSTS`, `validatePmkitConfig`), `schemas/pmkit.config.schema.json` (`git_host.system` enum and description), `scripts/lib/git-remote.mjs` (`inferHost`, `webHost`)
- Test: `scripts/config.test.mjs`, `scripts/git-remote.test.mjs`

**Interfaces:**
- Produces: `GIT_HOSTS = ['github', 'bitbucket', 'none']`; `BITBUCKET_REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/` exported from `config.mjs`; `inferHost(url)` returns `{ system: 'bitbucket', repo: 'ws/slug', host: 'bitbucket.org' }` for `https://bitbucket.org/ws/slug.git`, `https://user@bitbucket.org/ws/slug`, `git@bitbucket.org:ws/slug.git`; `webHost(url, 'ws/slug')` → `'bitbucket.org'`.

- [ ] **Step 1: Failing tests.** `config.test.mjs`: `bitbucket with repo acme/widgets is valid`; `bitbucket without repo` → problem `git_host.repo must be workspace/repo_slug when git_host.system is bitbucket`; `bitbucket with repo a/b/c` → same problem; `git_host.system gitlab` → `git_host.system must be github, bitbucket or none`. `git-remote.test.mjs`: the three URL forms above; `bitbucket.org/ws` (one segment) → `system: null`; `webHost` as above.
- [ ] **Step 2: Run** `node --test scripts/config.test.mjs scripts/git-remote.test.mjs` → the new tests FAIL.
- [ ] **Step 3: Implement.** The problem message joins `GIT_HOSTS` with commas and "or" (`github, bitbucket or none`); update any existing test that asserts the old `github or none` text and the `--git-host must be` usage messages in `scripts/pmkit.mjs` (lines ~4029, 4265, 4494) the same way. Schema enum `["github", "bitbucket", "none"]`; description adds "bitbucket opens pull requests through the Bitbucket Cloud REST API with BITBUCKET_TOKEN".
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: accept git_host bitbucket and detect bitbucket.org remotes (PMK-81)`.

### Task 2: Move the git-only methods to git-local.mjs

**Files:**
- Create: `scripts/lib/git-local.mjs`
- Modify: `scripts/lib/github/host.mjs`
- Test: `scripts/lib/git-local.test.mjs` (move the tests of these methods out of the GitHub host tests if any exist there; otherwise one test per method against a temp repo from `makeRepo` + `git init`)

**Interfaces:**
- Produces: `createGitLocal({ root, env, exec })` → `{ currentBranch, createBranch(name, { from }), push(branch), localDiff({ branch, base }), workingTree(branch), branchHas(branch, oidOf), unpushedCommits(branch) }`, same behavior and errors as today. Also exports `defaultExec`, `refArg(what, value)` and a `gitFailure(cmd, args, result)` for the plain git error (UPSTREAM with first stderr line). A missing `git` binary is `NOT_CONFIGURED` "git is not installed" with next step "Install git".
- `createGithubHost` returns `{ ...createGitLocal({ root, env, exec }), ...githubMethods }`; its `gh` failures keep using the GitHub `failure()`.

- [ ] **Step 1: Failing test** `git-local.test.mjs`: `createBranch` then `currentBranch` returns the new name; `refArg('branch', '-x')` throws `INVALID_INPUT`; a fake `exec` that throws `ENOENT` for `git` → `NOT_CONFIGURED` "git is not installed".
- [ ] **Step 2: Run** `node --test scripts/lib/git-local.test.mjs` → FAIL (module missing).
- [ ] **Step 3: Move** the seven methods and their helpers verbatim; the GitHub host spreads them in.
- [ ] **Step 4: Run** `npm test` → PASS, with every existing GitHub host and `pr diff` test unchanged.
- [ ] **Step 5: Commit** `refactor: share the git-only host methods in git-local (PMK-81)`.

### Task 3: Bitbucket credential, client and ADR test

**Files:**
- Create: `scripts/lib/bitbucket/credential.mjs`, `scripts/lib/bitbucket/client.mjs`, `scripts/fake-bitbucket-api.mjs`
- Test: `scripts/lib/bitbucket/credential.test.mjs`, `scripts/lib/bitbucket/client.test.mjs`, `scripts/adr-bitbucket-auth.test.mjs`

**Interfaces:**
- Produces:
  - `bitbucketCredential(env)` → `{ authorization: 'Bearer <token>', source: 'BITBUCKET_TOKEN' }`; throws `AUTH` "BITBUCKET_TOKEN is not set" (next step `/pmkit:setup`) or "BITBUCKET_TOKEN is not a bare Bitbucket token" (next step "Export the token as Atlassian shows it, with no quotes, spaces or Bearer prefix"); bare = `/^[\x21-\x7E]+$/`.
  - `createBitbucketClient({ env, repo, fetch = globalThis.fetch, timeoutMs = 30_000, retries = 2, sleep })` → `{ get(path, query?) → json, getText(path) → string, list(path, query?, { limit }) → { values, cut }, post(path, body) → json, put(path, body) → json }`. `path` is relative to the repository (`'pullrequests'`, `'pullrequests/7/statuses'`) and must match `/^[a-z_]+(\/[A-Za-z0-9{}_-]+)*$/` (else `TypeError`). `list` follows `next` until `limit` values or no `next`; `cut: true` when it stopped at `limit` with a `next` left. `repo` is checked against `BITBUCKET_REPO` (else `NOT_CONFIGURED` "git_host.repo must be workspace/repo_slug").
  - `scripts/fake-bitbucket-api.mjs`: `FAKE_BB_TOKEN = 'ATATTBBTESTTOKENTESTTOKEN'`, `FAKE_BB_ENV = { BITBUCKET_TOKEN: FAKE_BB_TOKEN }`, `BB = '/2.0/repositories/acme/widgets'`, and `fakeBitbucketFetch(routes)` = `fakeJiraFetch` from `fake-jira-api.mjs` (reuse it; it ignores the host, so client tests assert `call.url` starts with `https://api.bitbucket.org`).
- Error mapping per Global Constraints. 404 on any path is `UPSTREAM` with `httpStatus: 404`, except a 404 from `GET ''` (the repository itself), which is `NOT_CONFIGURED` "git_host.repo <repo> was not found or the token cannot read it" with next step `/pmkit:setup`. 401 message: "Bitbucket refused BITBUCKET_TOKEN (HTTP 401): it may have expired or lack a scope". A write with no answer: `UPSTREAM` "Bitbucket did not confirm the change", next step "Check the pull request on Bitbucket before you retry". Bitbucket's `error.message` is read from the body, one line, at most 200 characters.

- [ ] **Step 1: Failing tests.** credential: unset, empty, `Bearer x`, `"x"` → `AUTH`; good token → header. client: sends `Authorization: Bearer FAKE`; URL is `https://api.bitbucket.org/2.0/repositories/acme/widgets/pullrequests?state=OPEN`; `list` follows two pages and stops at `limit` with `cut: true`; a `next` on `evil.example` → `UPSTREAM` and no second call; 401/403/404/429/500 mapping (500 retried twice on GET, not on POST); `repo: 'a'` → `NOT_CONFIGURED`; the fake token is in no error's `message`, `nextStep` or `JSON.stringify(details)`. ADR test (`adr-bitbucket-auth.test.mjs`, shaped as `adr-jira-auth.test.mjs`): the ADR has a title, `## Status` `Accepted`, `## Considered options`, `## Consequences`; names `BITBUCKET_TOKEN`, `Bearer`, `scripts/lib/bitbucket/credential.mjs`, `api.bitbucket.org`, `2029-03-28`, the four scopes; matches `/stores no credential/`; `CONTEXT.md` **Git host** names `bitbucket` and `BITBUCKET_TOKEN`.
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement** the two modules (follow `scripts/lib/jira/client.mjs` for timeout with `AbortSignal.timeout`, retries and the "never copy the fetch error message" rule).
- [ ] **Step 4: Run** → PASS; `npm run lint` clean.
- [ ] **Step 5: Commit** `feat: Bitbucket credential and REST client (PMK-81)`.

### Task 4: Bitbucket host, pull requests

**Files:**
- Create: `scripts/lib/bitbucket/host.mjs`
- Test: `scripts/lib/bitbucket/host.test.mjs`

**Interfaces:**
- Consumes: `createGitLocal` (Task 2), `createBitbucketClient` (Task 3).
- Produces: `createBitbucketHost({ root, env, repo, fetch, exec })` → `{ system: 'bitbucket', ...createGitLocal(...), getPullRequest, openPullRequest, markReady, prChecks, prRefs, prDiff, listPullRequests }`, all PR methods `async`, shapes and mapping exactly as the spec's method table. `createGithubHost` gains `system: 'github'`.
- `getPullRequest({ head })` query: `q=source.branch.name="<head>"` with `\` and `"` escaped by a backslash, `state` all four, `sort=-created_on`, `pagelen=50`; picks the first `OPEN`, else the first. Returns null when none.
- `prChecks` `runId`: the number in a status `url` matching `/\/pipelines\/results\/(\d+)/`, else null. `bucket` map: `SUCCESSFUL→pass`, `FAILED→fail`, `STOPPED→cancel`, `INPROGRESS→pending`.
- `listPullRequests` limit 200; `statusCheckRollup` = `[{ context: s.key, state }]` with state `SUCCESSFUL→SUCCESS`, `FAILED→FAILURE`, `STOPPED→ERROR`, `INPROGRESS→PENDING`; a statuses read that fails with `UPSTREAM`/403 leaves `statusCheckRollup: null` on that pull request (risks then counts it as not failing) and the error rethrows for any other code.
- `prDiff`: `getText('pullrequests/<n>/diff')` (redirect followed by fetch); HTTP 413/406 or a body over 50 MB → null.
- `openPullRequest({ title, body, head, base, draft })` posts `{ title, description: body, source: { branch: { name: head } }, destination: { branch: { name: base } }, draft: draft === true }` and returns the mapped pull request from the POST answer.

- [ ] **Step 1: Failing tests**, one per method with the fake: open → merged → declined → superseded state mapping; `mergedAt` set only for MERGED; draft open; markReady sends `PUT` with `{ draft: false }`; the escaped `q` for head `a"b`; two PRs on a head, one OPEN one MERGED → the OPEN one; `prChecks` buckets and runId; `prRefs` → `{ baseRefName, headRefOid }`; `prDiff` text and the 413 → null; `listPullRequests` with a 403 on one PR's statuses → `statusCheckRollup: null` for it only; `author.is_bot` true for `type: 'app_user'`; `detail.reviews` from participants.
- [ ] **Step 2: Run** `node --test scripts/lib/bitbucket/host.test.mjs` → FAIL.
- [ ] **Step 3: Implement** in `host.mjs`; keep the shape mapping in one `toPullRequest(raw)` function.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: Bitbucket host pull request methods (PMK-81)`.

### Task 5: Bitbucket host, pipelines and deployments

**Files:**
- Modify: `scripts/lib/bitbucket/host.mjs`
- Test: `scripts/lib/bitbucket/host.test.mjs`

**Interfaces:**
- Produces: `listRuns({ branch })`, `ciLogs({ branch, runId })`, `listDeploys({ environment, ref, limit = 20 })`, all `async`, returning the GitHub host's shapes (spec table). `ciLogs` returns `{ runId, workflowName, url, conclusion, status, createdAt, headSha, newerRun?, log }` like GitHub's; `log` is each failed step's log (`steps` with `state.result.name` `FAILED` or `ERROR`) under a line `== <step name> ==`. `--run` lookup walks `pipelines?sort=-created_on&pagelen=100` for up to 5 pages; not found → `INVALID_INPUT` "pipeline run <n> was not found in the 500 newest runs". Run `url` = `https://bitbucket.org/<repo>/pipelines/results/<build_number>`.
- `listDeploys`: environments read once (`environments`, uuid→name); deploys from `deployments` (sorted newest first by `release.created_on`), filtered by `environment` name; `ref` given → `[]` (Bitbucket deploys have no git ref); `state`: `COMPLETED` + status `SUCCESSFUL→success`, `FAILED→failure`, `STOPPED→inactive`; `IN_PROGRESS→in_progress`; `UNDEPLOYED→pending`.

- [ ] **Step 1: Failing tests:** runs status/conclusion mapping (`PENDING`/`IN_PROGRESS` → `status` not `completed`, `conclusion: null`); `ciLogs` by branch picks the newest failed run and sets `newerRun` when a later run of the same `workflowName` succeeded; by `runId` found on page 2; not found after 5 pages; a successful run reads no step log (assert no `/log` call); `listDeploys` names environments, filters by name, `ref` → `[]`, limit honored.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: Bitbucket host pipelines and deployments (PMK-81)`.

### Task 6: CLI wiring

**Files:**
- Modify: `scripts/pmkit.mjs` (`makeHost`, `run` options, every `host.*` call site listed by `grep -n "host\.\w\+(" scripts/pmkit.mjs`, `reviewRequests`, `pr review`, `pr blockers`, `pr status`, track-agents, `release-readiness` call site), `scripts/lib/release-readiness.mjs` (`matches`), `scripts/lib/capabilities.mjs` (`linked_code` detail), shared messages that say "GitHub" where the host may be Bitbucket (`'GitHub rate limit reached earlier in this run'`, `'a pull request could not be read from GitHub'`)
- Test: `scripts/cli-bitbucket.test.mjs` (new), `scripts/capabilities.test.mjs`, `scripts/lib/release-readiness.test.mjs`

**Interfaces:**
- Consumes: `createBitbucketHost` (Tasks 4-5), `system` on both hosts.
- Produces: `run(argv, { env, cwd, adapters, fetch })`; `makeHost` returns `createBitbucketHost({ root, env, repo: git_host.repo, fetch: ctx.fetch })` for `bitbucket`, with `fetch` defaulting to `globalThis.fetch` at call time. NOT_SUPPORTED next steps: `pr review` → "Post the review on the pull request page, or post it on the issue with pmkit issues comment"; `pr blockers` → "Read the merge checks on the pull request page". Unchecked entry on Bitbucket: `{ area: 'blockers', code: 'NOT_SUPPORTED', message: 'blockers are not verified on Bitbucket' }` with `blocked: null`. Inbox: `{ verified: false, requested: null, teamRequests: null, complete: false, reason: 'review requests are not read on Bitbucket yet', code: 'NOT_SUPPORTED' }`. `matchesRelease` is `null` when `deploy.ref === null`, and readiness skips the two tag lookups when `host.system === 'bitbucket'`. `linked_code.detail` for Bitbucket: `{ source: 'git', host: 'bitbucket', unsupported: ['pr review', 'pr blockers'] }`.

- [ ] **Step 1: Failing tests** in `cli-bitbucket.test.mjs` (a `makeRepo` fixture whose config has `git_host: { system: bitbucket, repo: acme/widgets }`, `env: { ...FAKE_BB_ENV }`, `run(args, { cwd, env, fetch })`): `pr status --branch b --json` returns the PR, checks and `blockers.blocked: null` with the NOT_SUPPORTED unchecked entry; `pr blockers` and `pr review` exit 2 with `NOT_SUPPORTED`; `inbox list --json` returns review requests `verified: false` with `code: 'NOT_SUPPORTED'` and still lists the issues; `deploys list --json` shape; `ci logs --branch b --json`; `risks --json` with a 403 on pull requests → warning "pull requests not checked" and exit 0; `release-readiness` with a release tag → deploys `matchesRelease: null`; unset `BITBUCKET_TOKEN` → `AUTH` on `pr status`; the fake token in no stdout/stderr of any test. `capabilities --json` detail as above.
- [ ] **Step 2: Run** `node --test scripts/cli-bitbucket.test.mjs scripts/capabilities.test.mjs scripts/lib/release-readiness.test.mjs` → FAIL.
- [ ] **Step 3: Implement**: add `await` before every host call (the enclosing functions are already `async` except `reviewRequests` and the track-agents row loop helpers, made `async`); the `host.system === 'bitbucket'` checks at the top of `pr review` and `pr blockers` and around `collectBlockers` in `pr status` and track-agents.
- [ ] **Step 4: Run** `npm test` → PASS (GitHub CLI tests unchanged).
- [ ] **Step 5: Commit** `feat: wire the Bitbucket host into the CLI (PMK-81)`.

### Task 7: init, link-repo and setup

**Files:**
- Modify: `scripts/pmkit.mjs` (`runLinkRepo`, `init --git-host`, `withGithubRepo`/`originRepo`: treat `github` and `bitbucket` as `REPO_HOSTS = ['github', 'bitbucket']` where a repo is required or inferred), `commands/setup.md`, `commands/link-repo.md`, `README.md`
- Test: `scripts/cli-link-repo.test.mjs`, `scripts/cli-init.test.mjs`

**Interfaces:**
- Produces: `link-repo` infers `bitbucket` + `workspace/slug` from a `bitbucket.org` origin (`hostSource: 'remote'`); `--git-host bitbucket --repo ws/slug` works with any remote; a non-dry run with `bitbucket` first calls the client's `get('')` and maps its errors (`AUTH`, `NOT_CONFIGURED`) before writing; the dry run makes the same read. `init --git-host bitbucket` requires `--repo` or a bitbucket.org origin (same rule as github). Setup text: on `bitbucket`, tell the user to create an Atlassian API token with scopes `read:repository:bitbucket`, `read:pullrequest:bitbucket`, `write:pullrequest:bitbucket`, `read:pipeline:bitbucket` (or a repository access token with those rights) and export `BITBUCKET_TOKEN` in the shell profile or `~/.claude/settings.json` under `env`, never in the repository; setup never asks for the token.

- [ ] **Step 1: Failing tests:** link-repo with origin `git@bitbucket.org:acme/widgets.git` → writes `git_host: system: bitbucket, repo: acme/widgets`; the same without `BITBUCKET_TOKEN` → `AUTH`, file unchanged; a 404 on the repository → `NOT_CONFIGURED`, file unchanged; `init --git-host bitbucket` with no repo and a GitHub origin → usage error naming `--repo`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** and update the three docs.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: set up the Bitbucket git host with init and link-repo (PMK-81)`.

### Task 8: E2E runbook

**Files:**
- Create: `docs/runbooks/git-host-bitbucket.md`, `scripts/runbook-git-host-bitbucket.test.mjs`
- Modify: `scripts/fake-bitbucket-api.mjs` (add `fakeBitbucketRepo()`: a stateful route set holding pull requests, statuses, pipelines with steps and logs, environments and deployments; `merge(id)` and `decline(id)` helpers)

**Interfaces:**
- Consumes: everything above. Launcher pattern of `scripts/runbook-cycles-jira.test.mjs` (a script that sets `globalThis.fetch` to the fake, loads state from `state.json`, runs `run`, saves state). A bare local repository as `origin` with remote URL rewritten by `git config url.<bare>.insteadOf git@bitbucket.org:acme/widgets.git` so `link-repo` infers Bitbucket and `push` reaches the bare repository.

- [ ] **Step 1: Write the runbook** (sections as `docs/runbooks/setup-jira.md`: Before you start, steps with command and "Expect"), "Live check: skipped" with the EPC-14 follow-up. Steps: `link-repo --dry-run` then real; `issues branch`; commit; `pr open --draft`; `pr ready`; `pr status`; `pr diff`; `ci logs`; `deploys list`; `pr blockers` refused; merge in the fake, `pr sync` moves the issue to done; a declined pull request leaves its issue in review.
- [ ] **Step 2: Write the test** that runs each step and asserts each "Expect", plus the fake token in no output → run it → FAIL until the fake state exists.
- [ ] **Step 3: Implement** `fakeBitbucketRepo()`.
- [ ] **Step 4: Run** `npm test` and `npm run lint` → PASS.
- [ ] **Step 5: Commit** `test: runbook for the Bitbucket git host (PMK-81)`.

### Task 9: Follow-ups in EPC-14

- [ ] Create, through `pmkit issues create --parent EPC-14` (dry run first), four issues from the spec's "Follow-ups for EPC-14": live check, `pr review` on Bitbucket, `pr blockers` on Bitbucket, inbox review requests on Bitbucket. Link each `related` to PMK-81. Commit `chore: file the PMK-81 follow-ups in EPC-14 (PMK-81)`.
