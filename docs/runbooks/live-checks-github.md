# Runbook: live checks of the GitHub adapter

The opt-in checks of `scripts/lib/github/client-live.mjs` run the GitHub adapter against github.com and, when you have one, a GitHub Enterprise Server (GHES) host. They confirm what the tests of `npm test` take from the published schema and a fake `gh`:

- the error shapes of the client: no `gh` login, a token GitHub rejects, a repository that does not exist, the rate-limit headers, and a token without the `project` scope;
- `discover` on a repository with a Project;
- `openCycle` keeps every item's iteration when it adds a sprint;
- converting a draft issue into an issue on GHES 3.19.

`npm test` never loads the entry, and `scripts/runbook-live-checks-github.test.mjs` runs every step below against a fake `gh` first on `PATH`, so `npm test` checks this runbook without reaching GitHub. The checks use the `gh` login of your shell. They write only to the throwaway Projects you name, check those first, and clean up after themselves.

## Prepare the accounts

1. Log `gh` in to github.com with the `project` scope:

   ```
   gh auth login
   gh auth refresh -s project
   ```

2. Pick a github.com repository you can write to. A throwaway repository is best; the github.com checks add no issue to it.
3. Create a Project under the same owner, link it to the repository, and give it a title that starts with `pmkit-live`, such as `pmkit-live checks`. Add an iteration field (the Project's default `Iteration` works) with at least one iteration. Leave the Project empty: a check refuses a Project that holds any item, or whose title does not start with `pmkit-live`.
4. For the missing-scope check (optional): create a classic personal access token with the `repo` scope and without `project` (GitHub settings, Developer settings, Personal access tokens, Tokens (classic)). Give it a short expiry.
5. For the GHES check (optional): on a GHES host, ideally 3.19, log `gh` in with `gh auth login -h <host>` and `gh auth refresh -h <host> -s project`, create a throwaway repository with issues turned on, and a Project titled `pmkit-live ...` linked to it. The check converts a draft into a real issue of that repository, then deletes it. Only a repository admin can delete an issue, so use a repository you administer.

## Set the variables

Export them in the shell that runs the checks, never in a file inside the repository:

| Variable | Needed by | Value |
|---|---|---|
| `PMKIT_LIVE` | every check | `1` |
| `PMKIT_LIVE_GITHUB_REPO` | discover, openCycle | `owner/name` of the github.com repository |
| `PMKIT_LIVE_GITHUB_PROJECT` | discover, openCycle | `owner/number` of the throwaway Project |
| `PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN` | the missing-scope check | the classic token without `project` |
| `PMKIT_LIVE_GHES_HOST` | the GHES check | the host name, such as `github.example.com` |
| `PMKIT_LIVE_GHES_REPO` | the GHES check | `owner/name` of the throwaway repository on that host |
| `PMKIT_LIVE_GHES_PROJECT` | the GHES check | `owner/number` of the throwaway Project on that host |

To keep the token off your shell history, read it with `read -rs PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN && export PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN`. The checks pass it to `gh` only as `GH_TOKEN` for one read, and never print it.

## Run the checks

1. Run the entry without `PMKIT_LIVE` first:

   ```
   node scripts/lib/github/client-live.mjs
   ```

   Expect all eight tests skipped with `set PMKIT_LIVE=1 to run the live check`, and exit code 0. Nothing reaches `gh`.

2. Run it with the github.com variables:

   ```
   PMKIT_LIVE=1 node scripts/lib/github/client-live.mjs
   ```

   Expect seven passes. The GHES test is skipped with `no GHES host configured: set PMKIT_LIVE_GHES_HOST, PMKIT_LIVE_GHES_REPO and PMKIT_LIVE_GHES_PROJECT to convert a draft on GHES`. Each test prints what it asserted as a diagnostic. `discover` prints counts only, such as `issue types 3, issue fields 4, Project fields 9 (iteration 1), Status options 3, capabilities 21`. The openCycle check adds one draft per iteration (up to six), adds the sprint that starts the day after the last iteration ends, reads every draft back, then deletes the drafts and prints `restored the <n> iterations of the field <name>`.

3. With the GHES variables set too, expect eight passes. The GHES test prints the server version, a note when it is not 3.19, `converted the draft into issue #<n>: <link>` and `deleted issue #<n>`. When GitHub refuses the delete, it prints `closed issue #<n> as not planned instead: <link>; delete it by hand`.

A test that is skipped names the variable it lacks, or the one whose value has the wrong form, such as `PMKIT_LIVE_GITHUB_PROJECT must be owner/number, such as acme/7`.

## Read a failure

- `the title of the Project <owner/number> does not start with pmkit-live`, or `the Project <owner/number> holds <n> items`: the check stopped before any write. Name a throwaway Project, or empty it.
- `openCycle cleared the iteration of <n> of <m> items: <item ids>`: GitHub did not keep the iteration ids that `openCycle` sent. This is the PMK-88 assumption failing; report it with the output.
- `expected AUTH ..., got ...`: the client mapped a GitHub answer to another error. Report the whole line; the check prints no token.
- `the live check refused <operation>`: a check tried a write it did not plan. Nothing was sent. Report it.

## Clean up after a stopped run

Run the entry with plain `node`, as above, not `node --test`: under `node --test` the runner exits on Ctrl-C before the checks can clean up.

Ctrl-C (or SIGTERM) during a writing check stops the run after that check's cleanup. The run prints, on stderr:

```
SIGINT: stopping the live checks after cleaning up what they wrote
deleted the draft <item id>
restored the 2 iterations of the field Sprint
the run was interrupted: check the throwaway Project for drafts titled pmkit-live, as "Clean up after a stopped run" step 1 in docs/runbooks/live-checks-github.md says
```

and exits with code 130 (143 for SIGTERM). A step it could not finish prints `cleanup failed, <step>: <error>; remove it by hand at <link>, as "Clean up after a stopped run" step <n> ... says`, with the Project's link and the item id for a draft, its settings link for the iterations, or the issue's link on GHES. A draft whose add was in flight at Ctrl-C may be left with no line, so check the Project.

A check cannot clean up after a forced stop (SIGKILL) or a lost connection. When a run stops that way, prints `cleanup failed`, or ends with the interrupted line:

1. List what the Project holds and delete the drafts whose title starts with `pmkit-live`:

   ```
   gh project item-list <number> --owner <owner> --format json
   gh project item-delete <number> --owner <owner> --id <item id>
   ```

2. When the openCycle check stopped after it added a sprint, open the Project settings on GitHub and delete the iteration named `pmkit-live <date>`.
3. On GHES, find the issue titled `pmkit-live conversion check` in the throwaway repository and delete it (`gh issue delete <number> -R <owner/name>` with `GH_HOST=<host>`).

Then run the checks again: each one checks first that its Project is empty.
