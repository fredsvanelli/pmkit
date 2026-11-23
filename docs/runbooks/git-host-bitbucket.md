# Runbook: the Bitbucket Cloud git host

The git host commands on a repository whose `origin` is on Bitbucket Cloud (PMK-81, ADR 0018): link the repository, create the issue branch, open a draft pull request and mark it ready, read its status, diff, failed pipeline steps and the deployments, see `pr blockers` refused, and sync the issues after a merge and after a decline. `scripts/runbook-git-host-bitbucket.test.mjs` runs every step below with the real CLI, a stateful fake Bitbucket in place of `fetch` (`fakeBitbucketRepo` in `scripts/fake-bitbucket-api.mjs`, its state saved to a file between runs) and a local bare repository that receives the pushes, so `npm test` checks this runbook. It also checks that no output holds the token.

Live check: skipped. No Bitbucket account exists, so no step has run against a real repository; the live check of the Bitbucket host (token scopes, Bearer with a user API token, `next` links, the diff size limit, the build number lookup) goes to EPC-14.

## Before you start

- A repository on Bitbucket Cloud (Data Center is not supported), with `origin` set to it, such as `git@bitbucket.org:acme/widgets.git`, and `main` pushed. `git remote set-head origin --auto` has run, so `origin/HEAD` names `main`.
- An Atlassian API token with the scopes `read:repository:bitbucket`, `read:pullrequest:bitbucket`, `write:pullrequest:bitbucket` and `read:pipeline:bitbucket`, exported in the shell profile or in `~/.claude/settings.json` under `env`, never in a file inside the repository:

  ```
  export BITBUCKET_TOKEN=<token>
  ```

- pmkit is set up with the Local tracker and `git_host.system: none`.
- Titles go through files in `tmp/`, written with the file tool, and `tmp/` is ignored by git:
  - `tmp/title-1.txt`: `Retry the sync`
  - `tmp/title-2.txt`: `Drop the cache`
- The repository has Pipelines: each push of a branch runs a pipeline whose `Test` step fails, and the pipeline reports its build status on the pull request. The repository has deployments to `Production` (succeeded) and `Staging` (failed).

## Link the repository

1. Without the token, the preview stops before it reads anything:

   ```
   node scripts/pmkit.mjs link-repo --dry-run --json
   ```

   Expect exit code 2 and `error` `{ code: "AUTH", message: "BITBUCKET_TOKEN is not set", nextStep: "/pmkit:setup" }`, and `.pmkit/config.yaml` unchanged. Export the token and continue.

2. Preview the link, then write it. Both runs read the repository once, so a wrong repository or token fails the preview as it would fail the write:

   ```
   node scripts/pmkit.mjs link-repo --dry-run --json
   node scripts/pmkit.mjs link-repo --json
   ```

   Expect `gitHost` `none` -> `bitbucket`, `repo` `acme/widgets` and `defaultBranch` `main`, each with `source: "remote"`, and `remote.host` `bitbucket.org`. The dry run writes nothing. The real run writes `.pmkit/config.yaml`:

   ```yaml
   git_host:
     system: bitbucket
     repo: acme/widgets
     default_branch: main
   ```

## Branch and pull request

3. Create the two issues, then commit them with the link and push `main`, so the issue branches start from a `main` that has them:

   ```
   node scripts/pmkit.mjs issues create --title-file tmp/title-1.txt --type feature --json
   node scripts/pmkit.mjs issues create --title-file tmp/title-2.txt --type feature --json
   git add -A
   git commit -m "Link Bitbucket"
   git push origin main
   ```

   Expect two issue ids, `<issue-id>` and `<second-issue-id>`.

4. Create the branch of the first issue, do the work and commit it. Commit only the work: the tracker files that pmkit changes stay uncommitted, so they follow you from branch to branch:

   ```
   node scripts/pmkit.mjs issues branch <issue-id> --json
   git add src/retry.mjs
   git commit -m "Retry the sync"
   ```

   Expect `branch` `<issue-id-lowercase>-retry-the-sync` and `from: "main"`. The branch is created locally and checked out; nothing is sent to Bitbucket.

5. Push the branch and open a draft pull request:

   ```
   node scripts/pmkit.mjs pr open --issue <issue-id> --draft --json
   ```

   Expect `number: 1`, `isDraft: true`, `existing: false`, `state: "OPEN"`, `title: "Retry the sync (<issue-id>)"`, `headRefName` the branch and `url` `https://bitbucket.org/acme/widgets/pull-requests/1`. The branch is on `origin` at the commit of step 4.

6. Mark it ready for review:

   ```
   node scripts/pmkit.mjs pr ready --issue <issue-id> --json
   ```

   Expect `number: 1` and `isDraft: false`.

## Read the pull request

7. Read its status on the current branch:

   ```
   node scripts/pmkit.mjs pr status --json
   ```

   Expect `pr.number: 1`, `pr.isDraft: false`, one check `Pipeline #1` with `bucket: "fail"` and `runId: 1` (the build number `ci logs --run` takes), `reviews: []`, and `blockers.unchecked` `[{ area: "blockers", code: "NOT_SUPPORTED", message: "blockers are not verified on Bitbucket" }]` with `blocked: null`.

8. Read its diff:

   ```
   node scripts/pmkit.mjs pr diff --json
   ```

   Expect `source: "pull_request"`, `pr.number: 1`, and `src/retry.mjs` among `files`, with its added line in `diff`. `uncommitted: true` with a note: the tracker files pmkit changed are not in the pull request.

9. Read the log of the failed pipeline of the branch:

   ```
   node scripts/pmkit.mjs ci logs --json
   ```

   Expect `run.runId: 1`, `run.conclusion: "failure"`, `run.failed: true`, `run.url` `https://bitbucket.org/acme/widgets/pipelines/results/1` and `run.log` starting with `== Test ==`, followed by the step's log.

10. List the deployments:

    ```
    node scripts/pmkit.mjs deploys list --json
    ```

    Expect `Staging` with state `failure`, then `Production` with state `success`, newest first, each with `ref: null` (a Bitbucket deployment names a pipeline, not a git ref).

11. Ask for the blockers:

    ```
    node scripts/pmkit.mjs pr blockers --json
    ```

    Expect exit code 2 and `error` `{ code: "NOT_SUPPORTED", message: "pr blockers is not supported on Bitbucket yet", nextStep: "Read the merge checks on the pull request page" }`.

## Sync after a merge

12. Move the issue to review, merge the pull request on Bitbucket, then sync:

    ```
    node scripts/pmkit.mjs issues move <issue-id> in_review --json
    node scripts/pmkit.mjs pr sync --json
    ```

    Expect `checked: 1` and `moved: [{ id: "<issue-id>", pr: 1 }]`; `issues get <issue-id> --json` shows the status category `done`.

## A declined pull request

13. Open a pull request for the second issue, move the issue to review, decline the pull request on Bitbucket, then sync:

    ```
    node scripts/pmkit.mjs issues branch <second-issue-id> --json
    git add src/cache.mjs
    git commit -m "Drop the cache"
    node scripts/pmkit.mjs pr open --issue <second-issue-id> --json
    node scripts/pmkit.mjs issues move <second-issue-id> in_review --json
    node scripts/pmkit.mjs pr status --json
    node scripts/pmkit.mjs pr sync --json
    ```

    Expect `pr open` to give `number: 2` and `isDraft: false`, and `pr status` after the decline to show `pr.state: "CLOSED"` (Bitbucket's `DECLINED`). `pr sync` gives `checked: 1` and `moved: []`: a declined pull request is not merged, so the issue stays in review (`issues get <second-issue-id> --json` shows the category `in_review`).
