# PMK-367: check the Jira issue flows against a live site

Issue PMK-367 (EPC-14, chore), follow-up of PMK-77. Written on 2026-11-24 by a dispatched worker; the owner's answers come through the coordinator.

## Intent

PMK-77 built the Jira work-item, transition, link, history and JQL operations from Atlassian's OpenAPI documents and checked them only against the stateful fake (`scripts/fake-jira-issues.mjs`). Run the issue flows on the owner's Jira Cloud site, record what holds, fix the adapter or the fake where the site answers differently, and leave a check that reruns in one line (the opt-in harness of PMK-364, `scripts/lib/jira/client-live.mjs`, `PMKIT_LIVE`).

## Acceptance criteria (from the issue)

1. `issues link A B --kind blocks` makes A block B on the site (the inwardIssue/outwardIssue direction), and related and duplicate read back as pmkit shows them.
2. `issues parent X none` clears the parent, and a description with acceptance criteria round-trips through ADF as a Jira task list.
3. `issues list --text`, the assignable-users read, the changelog in `search/jql` and the `pmkit.branch` property read in search match the documented shapes.
4. A move through a transition with a required Resolution screen lists the field in the dry run and succeeds with `--field`.
5. Jira's development panel links a branch named with the lower-case key (`eng-12-slug`); if not, `issues branch` on Jira keeps the key upper case.

## What a live probe found (2026-11-24)

Site: the owner's (host, email and token kept out of the repository, the PR and the issue). Space Kudos (team-managed, Portuguese, Backlog, Sprints and Estimation on, Releases off; empty). Each probe created its work items in Kudos and deleted them; Kudos is empty again.

| Check | AC | Live answer | Holds? |
|---|---|---|---|
| `POST /issueLink` type `Blocks`, `inwardIssue: A`, `outwardIssue: B` (what `relation-ops.mjs` sends for `link A B --kind blocks`) | 1 | A's `issuelinks` has `{ type: Blocks, outwardIssue: B }` (A blocks B), B's has `{ inwardIssue: A }` (B is blocked by A). `issues.mjs` reads `outwardIssue` as `blocks` and `inwardIssue` as `blockedBy`; the fake answers the same way | yes |
| link type names | 1 | `Blocks`, `Cloners`, `Duplicate`, `Relates`, in English on a Portuguese site (inward/outward descriptions too) | yes: `LINK_NAMES` matches |
| transitions with `expand=transitions.fields` | 4 | five transitions, `fields: {}` on each, the done one included. A team-managed space has no transition screens | the Resolution half cannot run here |
| `search/jql` with `properties=pmkit.branch&expand=changelog` | 3 | each issue has `properties: { "pmkit.branch": "<value>" }` and `changelog: { startAt, maxResults, total, histories }` | yes |
| `summary ~ "<word>"` in `search/jql` | 3 | found a work item created 3 s before | yes (index lag to watch in the test) |
| `user/assignable/search?project=KAN` | 3 | array of users with `accountId`, `accountType`, `active`, `displayName` (and email, avatar, locale) | yes |
| development panel | 5 | the site has no GitHub for Jira app (`com.github.integration.production` not found; the only user-installed app is Jira Toolkit), so nothing feeds the panel | cannot run here |

### The branch name case (AC 5)

No live check is possible on this site. What the sources say:

- Atlassian's "Reference work items in your development work" uses upper-case keys in every example (`git checkout -b JRA-123-<branch-name>`) and does not say lower case works.
- GitHub for Jira's "Support lower case issue keys" (integrations/jira#220) reports that the app stopped linking `lief-12155-...` branches the old DVCS connector linked; Smart Commits officially need upper case. JENKINS-66390 reports an empty development panel for lower-case keys in GitHub branch names.
- No source shows lower case linking today.

So the AC's "if not" branch applies on the evidence: `issues branch` on Jira should keep the key upper case (`KAN-12-ship-it`). This is Q1 for the owner.

## Approaches

- **A. Extend `client-live.mjs` with one live test per flow, running the real CLI in a temporary repository on the throwaway space (recommended).** The PMK-368 pattern: `init` with every recommendation, then the CLI commands the ACs name, checked against Jira's own raw answers (`client().request`). Each test records the keys it creates and deletes them in `finally` with the raw client (Jira has no trash), so a failing step leaves nothing behind. Opt-in, so `npm test` does not run it.
- **B. Drive the adapter (`issueOperations`) directly, without the CLI.** Fewer moving parts, but the ACs name CLI commands (`issues link`, `issues parent ... none`, `issues list --text`, `issues move --field`), and the CLI is what the runbook documents. Rejected.
- **C. A new live harness file.** The task says reuse PR #391's. Rejected.

A.

## Design (approach A)

### Live test, in `client-live.mjs`

One `test('issue flows on the throwaway space', { skip: NEEDS_SPACE })` (PMK-367), in a temporary git repository with one commit on `main`, `git_host` GitHub (a placeholder repo; `issues branch` only creates the branch locally and writes the property, nothing is pushed), and `init --tracker jira` with every recommendation (the setup test's flag building moves into a shared helper). Steps, each checked through the CLI's JSON and against the raw item:

1. **Create.** `issues create` A (type `feature`, criteria file with two lines), B and C. Raw `GET issue/A`: `description` is ADF holding a `taskList` with two `taskItem`s, `state: TODO`; `issues get A` reads the two criteria back, none done (AC 2).
2. **Check a criterion.** `issues update A --check 1`: raw `taskItem` 1 is `DONE`, `issues get A` reads it done (AC 2, round trip).
3. **Blocks.** `issues link A B --kind blocks`: raw A has `outwardIssue: B` of type Blocks, raw B has `inwardIssue: A`; `issues get B` has `blockedBy: [A]`; `issues list --blocked` lists B and not A (AC 1).
4. **Related and duplicate.** `issues link A C --kind related`: `issues get A` and `issues get C` each list the other in `related`. `issues link C A --kind duplicate`: raw C has `outwardIssue: A` of type Duplicate; `issues get C` has `duplicateOf: [A]`, `issues get A` has none (AC 1).
5. **Parent.** An epic E (`epic create`), `issues parent B E`: raw B `fields.parent.key` is E. `issues parent B none`: raw B has no parent, `issues get B` has no `parent` (AC 2). A team-managed space takes only an epic as a story's parent, so the parent is an epic.
6. **Branch property in search.** `issues branch A`: the branch is created locally with the name Q1 settles; raw `GET issue/A/properties/pmkit.branch` holds it; `issues list --json` shows `branch` on A, read from `search/jql`'s `properties` (AC 3, AC 5).
7. **Text search.** `issues list --text <random word in A's title>` lists only A; retried for up to 10 s, since Jira's index trails a create (AC 3).
8. **Assignable users.** `issues assign A me` succeeds (the member list comes from `user/assignable/search`), and the raw read's items have `accountId`, `displayName`, `accountType` (AC 3).
9. **Move.** `issues move A in_progress`, then `issues move A done --dry-run`: `requiredFields` equals the required fields of Jira's raw transition (empty on team-managed); `issues move A done` succeeds, raw status category `done` (AC 4, team-managed half).
10. **Changelog in search.** `metrics cycle-time --since <today>` lists A: it reads `metricEvents` (`history-ops.mjs`), the one path that takes the changelog from `search/jql` with `expand=changelog`; the raw search item carries `changelog.histories` with the status changes (AC 3).
11. **Cleanup.** `finally`: unlink nothing; raw `DELETE issue/<key>?deleteSubtasks=true` for each created key, children first, then a search proves the space holds none of them. Each key is printed (`t.diagnostic`) as soon as it exists, so a delete that fails leaves the key to remove by hand.

Output prints keys, counts and ids only; the harness's `scrub`, `hostless` and `assertNoSecret` cover every CLI answer. The email and the host never reach the repository.

### Fixes

Test-first, in this PR, for any difference the live run finds in the adapter or the fake. The probe found none in AC 1 and AC 3. If Q1 is "upper case": the Jira descriptor's `settings` gains `branchKeyCase: 'upper'` (or the narrowest equivalent the builder finds), and `issues branch` on Jira names `KAN-12-ship-it`; `ids.test.mjs`/CLI test first, then the runbook step and the fake's expectations.

### Docs

`docs/runbooks/issues-jira.md`: the live-check line records the run, what passed and what stayed skipped (Resolution screen and company-managed: owner's decision; development panel: no integration on the site); step 9's branch name if Q1 changes it, verified by `scripts/runbook-issues-jira.test.mjs`.

## Goals, non-goals, anti-goals

- Goals: each AC checked live or skipped with its reason; any difference fixed test-first; the result recorded on PMK-367.
- Non-goals: company-managed space and non-admin token checks (owner's decision, open in the PR); installing GitHub for Jira on the site.
- Anti-goals: any write to Jira outside Kudos; anything left in Kudos; the host, email, token or account in the repository, the PR or the issue.

## Check (SPEC-SS C)

`scripts/runbook-issues-jira.test.mjs` (with the branch-name step if Q1 changes it), the other Jira runbook tests, then `client-live.mjs` against the live site.

## Open questions for the owner

- **Q1. Branch name case on Jira.** The development panel cannot be checked on this site (no GitHub for Jira app). (a) Name Jira branches with the upper-case key (`KAN-12-ship-it`) now, on the documentation and reports above; Local, Linear and GitHub keep lower case. (b) Keep lower case and leave AC 5 open with a follow-up in EPC-14 for a site with the app. Recommend (a): upper case is the form every source shows linking, and lower case is reported broken; the cost is one setting and a runbook line.
- **Q2. AC 4 on a team-managed space.** Team-managed workflows have no transition screens, so no Resolution field can be required. The live test checks that the dry run's `requiredFields` matches Jira's transition fields (empty) and the move succeeds; the Resolution half stays open with the company-managed checks (owner's decision). Recommend: yes, leave it open in the PR, no follow-up beyond the existing company-managed one.

## Interview

Answered on 2026-11-24 by the coordinator on the owner's behalf; the design is approved.

- Q1: (a). `issues branch` on Jira keeps the work-item key upper case (`KAN-12-ship-it`), test-first; Local, Linear and GitHub keep lower case. AC 5's live half stays open in the PR (no git integration on the site).
- Q2: yes. The Resolution half of AC 4 stays open in the PR with the company-managed checks; no new follow-up.
- Q3: yes. No new `CONTEXT.md` term; ADR 0015's consequence line now says Jira branches keep the key upper case, and why. No new ADR.

## Left to the builder

Assertion wording, the shared init helper's shape, the random word and the retry interval of the text search.
