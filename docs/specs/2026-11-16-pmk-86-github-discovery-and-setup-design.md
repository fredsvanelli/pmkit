# PMK-86 design: GitHub discovery and the setup questions

Issue PMK-86, epic EPC-8 (GitHub Issues tracker adapter), milestone `github-issues`. Status: draft, waiting for the user's approval. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The GitHub Issues adapter has a client (PMK-85) but no tracker: `tracker.system: github` still fails with `NOT_SUPPORTED`, and `/pmkit:setup` offers only Local and Linear. Before PMK-87 can read and write issues, pmkit must know which host, repository and Project a repository uses, which Project Status option stands for each category, and which issue type and field hold each pmkit type and field role. A Project's Status options are free-form names with no type, so pmkit cannot infer the categories as it does for Linear states. The issue quotes the planning doc: "discovery needs user confirmation the first time" and "Always asked: GitHub Status options".

Acceptance criteria:

1. `discover` returns issue types and Project fields.
2. Setup asks which Status option maps to each category.

## Decisions already made

ADR 0007 and the PMK-84 and PMK-85 specs settle these, and this spec does not reopen them:

- pmkit reaches GitHub through `gh api graphql` with the `gh` login and holds no token. The client is `createGithubClient` in `scripts/lib/github/client.mjs`.
- The `project` scope is needed only when the repository uses a Project. `discover` reads the configured Project once, so a missing scope fails at setup with `AUTH`.
- The minimum GitHub Enterprise Server (GHES) version is 3.19. On GHES, `discover` reads `installed_version` from `gh api meta` and fails with `NOT_SUPPORTED` below 3.19. github.com and GHE.com get no check.
- Each field role reads an issue field first, then a Project field, then `none`. The status comes from the Project's Status field plus open or closed. GitHub's issue status preview is out of scope.
- The client takes an optional `host` and passes `--hostname` when it is set.

## Facts checked against GitHub

Checked on 2026-11-16 with gh 2.93.0, by schema introspection and read-only queries on github.com.

| Check | Result |
|---|---|
| Issue types | `Repository.issueTypes` and `Organization.issueTypes` list `IssueType { id name description isEnabled }`. On fredsvanelli/pmkit, a repository of a personal account, they are Task, Bug and Feature, all enabled. |
| Issue fields | `Repository.issueFields` and `Organization.issueFields` return the union `IssueFields`: `IssueFieldDate`, `IssueFieldNumber`, `IssueFieldSingleSelect` (with `options { id name }`), `IssueFieldText` and `IssueFieldMultiSelect`. Each has `id`, `name` and `dataType`. fredsvanelli/pmkit has none. |
| Project fields | `ProjectV2.fields` returns the union `ProjectV2FieldConfiguration`: `ProjectV2Field`, `ProjectV2IterationField`, `ProjectV2SingleSelectField` (with `options { id name }`) and `ProjectV2MultiSelectField`. Each has `id`, `name`, `dataType` and `isIssueField`, true when the Project shows an issue field as a column. |
| Linked Projects | `Repository.projectsV2` lists the Projects linked to the repository, each with `number`, `title` and `owner { login }`. Reading a Project needs `read:project` or `project`; the user's token has neither, so the read fails with `INSUFFICIENT_SCOPES`. |
| `gh api meta` | Returns the REST `/meta` document. On GHES it carries `installed_version`, such as `3.19.2`. |

## Goals

- A `github` adapter in `scripts/lib/adapters.mjs` whose `discover` returns the host, the repository, its issue types and issue fields, the configured Project with its fields and Status options, the statuses with their categories, and the common keys every command reads.
- `init --tracker github`, which reads GitHub, applies what it can infer and returns the questions setup must ask: the Project, every Status category, each field role and each pmkit type.
- `/pmkit:setup` sections for a first GitHub run and an existing GitHub config.
- The GHES version check.
- A runbook for GitHub setup with an E2E test that runs the CLI against a fake `gh`.
- ADR 0007's host wording corrected with a dated note.

## Non-goals

- Every contract operation besides `discover` and `capabilities`. They answer `NOT_SUPPORTED` until PMK-87 implements them.
- Labels as a type fallback and the degraded flow for a repository without a Project. PMK-89 owns both.
- Iterations, milestones and Project status updates (PMK-88).
- A discovery cache in the user store. `discover` always reads GitHub, and no other operation reads discovery yet. PMK-87 adds the cache with the first operation that needs it **(builder's call)**.

## Anti-goals

- pmkit never asks a user without a Project for the `project` scope.
- Setup never picks a Status option for the user without asking. Every Status category is a question on the first run.
- pmkit never reads, prints or stores a token (ADR 0007).

## Decisions from the user

### Question 1: the config keys for the scope

Answer: `tracker.scope` holds three keys, and the schema needs no new shape, since `tracker.scope` already takes any string key.

```yaml
tracker:
  system: github
  scope:
    host: github.com     # host of the origin remote; always written, also for github.com
    repo: acme/widgets   # owner/name of the repository that holds the issues
    project: acme/7      # Project owner login and number, or none
```

Why: writing `host` even for github.com means a stray `GH_HOST` never sends calls elsewhere. A separate `tracker.scope.repo` lets the issues live in another repository than the code and keeps the tracker apart from the git host. `owner/number` because a Project can belong to an organization other than the repository's owner.

### Question 2: the Status mapping

Answer: keep `mappings.status.<category>: <option name>` or `none`. Setup asks every category but triage, one question each: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled`, plus `blocked`. Each question lists the Status options, recommends the one whose name matches the category, and offers `none`. One option cannot answer two categories. `todo`, `in_progress` and `done` refuse `none`, because PMK-87 must be able to move an issue to them. An option no category names gets a warning in `discover` and in setup's summary: issues in it count as `in_progress`.

Reading rule, which `discover` reports and PMK-87 applies: a closed issue is `done`, or `canceled` when GitHub's state reason is not planned or duplicate, whatever its option; an open issue takes its option's category; an open issue with no option counts as `todo`.

### Question 3: how a field mapping records its source

Answer: `mappings.fields.<role>` stays a string, with a source prefix:

```yaml
mappings:
  fields:
    priority: issue:Priority
    estimate: project:Story points
    start_date: issue:Start date
    target_date: none
```

`issue:<name>` reads the issue field with that name, `project:<name>` the field of the configured Project, and `none` no field. The prefix ends at the first colon, so a name may hold colons. Setup asks four roles, each with fields of the matching type: `priority` a single select, `estimate` a number or a single select (read as sizes), `start_date` and `target_date` a date. It recommends the issue field whose name matches (Priority, Effort, Start date, Target date), else a Project field whose name matches, else `none`. A Project field with `isIssueField: true` is listed once, as `issue:`. The adapter's config check refuses any other value.

### Question 4: pmkit types

Answer: `mappings.types.<pmkit type>: <GitHub issue type name>`, the same key and shape as Linear. `discover` returns the enabled issue types and the pmkit types the config maps. Setup asks one question per pmkit type, recommends the issue type with the same name (case-insensitive) and offers `none`. One issue type answers at most one pmkit type. A repository whose issue types are all disabled gets no type question and a note. No label fallback (PMK-89).

### Question 5: which Projects setup offers

Answer: setup first reads the repository, its issue types and its issue fields with the default scopes. Then it asks one question, `tracker.scope.project`: the Projects linked to the repository (`owner/number` and title), and `none`. It reads `Repository.projectsV2` only for this question. When that read fails with `AUTH`, the question offers `none` and shows the step `gh auth refresh -s project` (plus `-h <host>` off github.com). With a Project, `discover` reads it once and setup asks the Status and field questions. With `none`, setup writes `tracker.scope.project: none`, asks no Status question, offers only issue fields for the roles, and `discover` reports two statuses, open as `todo` and closed as `done`, with a warning that PMK-89 adds the rest. A configured Project the account can no longer read is a broken mapping.

## Design

### Files

| File | What changes |
|---|---|
| `scripts/lib/github/discovery.mjs` | New. The queries, `checkGhesVersion`, `fetchDiscovery` (the raw data) and `discoveryView` (the `discover` result). |
| `scripts/lib/github/mappings.mjs` | New. `proposeGithubSetup`, which says what setup applies, asks and finds broken; `parseFieldSource`; the name matching. |
| `scripts/lib/github/tracker.mjs` | New. `createGithubTracker`: `discover`, `capabilities`, and a `NOT_SUPPORTED` stub for every other contract operation. |
| `scripts/lib/github/adapter.mjs` | New. `githubDescriptor({ exec })`, the descriptor `ADAPTERS` holds, with the config check. Tests pass a fake `exec`. |
| `scripts/lib/adapters.mjs` | Registers `github`. |
| `scripts/pmkit.mjs` | `init --tracker github` (`runInitGithub`), the `--host`, `--repo` and `--project` flags of `init`, and the GitHub lines of `discover`'s text output. |
| `schemas/pmkit.config.schema.json` | Descriptions only: `tracker.scope` names `host`, `repo` and `project`; `mappings.fields` names the `issue:` and `project:` prefixes; `mappings.types` says "label or issue type". |
| `commands/setup.md` | Step 1 offers GitHub Issues. New sections "GitHub first run" and "Existing GitHub config". |
| `docs/runbooks/setup-github.md` | New. The runbook of GitHub setup. |
| `scripts/runbook-setup-github.test.mjs` | New. The E2E test of the runbook: the real CLI, as a subprocess, with a fake `gh` first on `PATH`. |
| `docs/adr/0007-...md` | A dated note that corrects the host wording. |
| `CONTEXT.md` | One term, **GitHub Project**. |

### Discovery

`fetchDiscovery(client, { host, repo, project, exec })` runs, in order:

1. The GHES check, when `host` is set, is not `github.com` and does not end in `.ghe.com`: `gh api --hostname <host> meta` through `exec`, with no other argument. It reads `installed_version`. Below 3.19 it throws `NOT_SUPPORTED`, `GitHub Enterprise Server <found> is older than 3.19, the oldest version pmkit supports`, next step `Upgrade the server to 3.19 or later, or use tracker.system local`. A version it cannot read throws `UPSTREAM`, `gh api meta did not return installed_version for <host>`, next step `Check that <host> is a GitHub Enterprise Server host`. The command's own failures map as the git host maps them: no `gh` is `NOT_CONFIGURED` with `INSTALL_STEP`, no login is `AUTH` with `gh auth login -h <host>` **(builder's call)**.
2. `PmkitRepo`: `viewer { login name }` and `repository(owner, name) { id nameWithOwner owner { login __typename } issueTypes(first: 50) issueFields(first: 50) labels(first: 100) }`, with the default scopes. A missing repository is `NOT_FOUND` from the client.
3. `PmkitProject`, only when `project` is an `owner/number`: `repositoryOwner(login) { ... on Organization { projectV2(number) } ... on User { projectV2(number) } }` with `id number title url fields(first: 50) { ... }`. A missing scope is `AUTH` from the client. A Project that does not exist, or the account cannot see, is `NOT_FOUND`.
4. `PmkitLinkedProjects`, only for setup's Project question: `repository.projectsV2(first: 20) { nodes { number title owner { login } } }`.

Issue types, issue fields and Project fields read one page of 50 each, and labels one page of 100. When `hasNextPage` is true, `discover` warns that it kept the first page **(builder's call: a repository with more than 50 types or fields is unlikely, and paging can come later)**.

`discoveryView(raw, pmkit)` returns:

```js
{
  host: 'github.com',
  repo: 'acme/widgets',
  viewer: { id: 'octocat', name: 'The Octocat' },
  project: { owner: 'acme', number: 7, title: 'Roadmap', url } | null,
  issueTypes: [{ name: 'Bug', description }],          // enabled types only
  issueFields: [{ name: 'Priority', dataType: 'SINGLE_SELECT', options: ['P0', 'P1'] }],
  projectFields: [{ name: 'Status', dataType: 'SINGLE_SELECT', options: ['Todo', 'In Progress', 'Done'], issueField: false }],
  statusOptions: ['Todo', 'In Progress', 'Done'],       // empty without a Project
  statuses: [{ name: 'Todo', category: 'todo' }, ...],  // every option, with the mapped or fallback category
  types: ['feature', 'bug'],                            // pmkit types the config maps
  priorities: ['urgent', 'high', 'medium', 'low'],
  labels: ['documentation', ...],
  members: [{ id: 'octocat', name: 'The Octocat' }],    // the viewer only; PMK-87 reads assignable users
  estimate: { unit: 'points', scale: [] },
  warnings: [...],
}
```

`statuses` lists each Status option with the category its mapping names, and `in_progress` with a warning for an option no category names. Without a Project it lists `Open` as `todo` and `Closed` as `done`, with the warning `tracker.scope.project is none; statuses are open and closed only until PMK-89`. The view keeps the raw discovery as a hidden property, as the Linear view does, so setup reads the ids from it **(builder's call)**.

### The tracker

`createGithubTracker(config, { env, exec, now })` creates the client with `host` from `tracker.scope.host`. A missing `host` or `repo` throws `NOT_CONFIGURED` with `/pmkit:setup` before any call. `discover()` runs `fetchDiscovery` and `discoveryView`, then checks the mappings: a Project, Status option, field or issue type the config names and GitHub no longer has goes into `warnings` in `discover` **(builder's call: discover reports, it does not refuse, so setup can still read)**. `capabilities()` returns a manifest whose entries are all `absent` with the hint `The GitHub adapter does not serve <id> yet (EPC-8)`, except `linked_code`, which follows the git host as the Local manifest does. Every other operation throws `NOT_SUPPORTED`, `the GitHub adapter does not implement <operation> yet`, next step `Set tracker.system to local in .pmkit/config.yaml to use this command now`, as the Linear stubs did before PMK-35.

The config check (`configProblems`) requires `tracker.scope.host` and `tracker.scope.repo` (`owner/name`), allows `tracker.scope.project` as `owner/number` or `none`, and refuses a `mappings.fields` value that is not `none`, `issue:<name>` or `project:<name>`.

### Setup: `init --tracker github`

```
init --tracker github [--git-host github|none] [--host h] [--repo owner/name] [--project owner/number|none]
     [--status key=option ...] [--field role=issue:<name>|project:<name>|none ...] [--type-label type=<issue type> ...] [--update] [--dry-run]
```

1. The host and repository come from `--host` and `--repo`, else from the file on `--update`, else from the `origin` remote through `parseRemoteUrl`. `www.github.com` and `ssh.github.com` become `github.com`. With neither, it throws `INVALID_INPUT`, next step `Pass --host <host> --repo <owner/name>`. A notes line says where each came from, so the user sees a host that is really an SSH alias.
2. It reads the repository (step 2 of discovery), after the GHES check.
3. The Project: `--project`, else the file, else a question. The question lists the linked Projects (step 4 of discovery) and `none`. When step 4 fails with `AUTH`, the question offers only `none` and carries the error's next step in `note`.
4. With a Project picked, it reads the Project (step 3 of discovery). Then `proposeGithubSetup` walks the Status categories, the field roles and the types, in that order, and returns `{ applied, questions, broken, notes, values }`, the same shape as Linear's `proposeMappings`, so `/pmkit:setup` asks them the same way. A question is `{ path, flag, candidates, recommended, none, required?, broken? }`. `required: true` marks `todo`, `in_progress` and `done`, which take no `none`.
5. It writes `.pmkit/config.yaml` from the template, as the Linear path does: only the lines that change, the schema line, and a refusal when questions remain on a real run.

Name matching for the recommendations, case-insensitive, first match wins **(builder's call)**:

| Key | Matches |
|---|---|
| `backlog` | Backlog |
| `todo` | Todo, To do, Ready |
| `in_progress` | In progress, Doing |
| `in_review` | In review, Review |
| `done` | Done, Closed |
| `canceled` | Canceled, Cancelled, Won't do |
| `blocked` | Blocked |
| `priority` | Priority |
| `estimate` | Effort, Estimate, Story points, Points, Size |
| `start_date` | Start date, Start |
| `target_date` | Target date, Due date, End date |

On `--update`, a held value that GitHub still has is kept and not asked. A held value GitHub no longer has is asked again with `broken: { was, problem }`. A held category is never asked again unless it broke, so a second run with nothing changed reports `keep`.

### `/pmkit:setup`

Step 1 offers three trackers: Local (Recommended), Linear and GitHub Issues. "GitHub first run" runs `init --tracker github --dry-run --json`, shows `notes`, asks `tracker.scope.project` alone, runs the dry run again with `--project`, then asks the other questions in batches of four, as the Linear section does, with one change: a `required` question offers no `none`. It shows one summary (host, repository, Project, each Status option with its category, each field and type, the warnings) and writes after approval. On `AUTH` it shows the next step and asks the user to run setup again. On `NOT_SUPPORTED` it names the GHES version found and 3.19. "Existing GitHub config" follows "Existing Linear config".

### ADR 0007 note

A section `## Note, 2026-11-16 (PMK-86)` at the end of the ADR says: `gh api` never reads the git remote; it reads `--hostname`, else `GH_HOST`, else github.com, so the config names the host in `tracker.scope.host`, which setup fills from the remote. `-h <host>` applies to every host but github.com, GHE.com included, not only on GHES. The decision itself does not change.

### Glossary

`CONTEXT.md` gains **GitHub Project**: a Projects v2 board that a GitHub user or organization owns, named in `tracker.scope.project` as `owner/number`. The GitHub Issues adapter reads each issue's status from the board's Status field. _Avoid_: project (alone), board **(builder's call)**.

## Acceptance criteria map

| Criterion | Where |
|---|---|
| `discover` returns issue types and Project fields | `discoveryView` returns `issueTypes`, `issueFields`, `projectFields` and `statusOptions`. Unit tests on a fake `exec`, and the E2E test runs `pmkit discover --json` against the fake `gh`. |
| Setup asks which Status option maps to each category | `proposeGithubSetup` returns one question per category, `blocked` included; `commands/setup.md` asks them. Unit tests, and the E2E test walks the dry run, the answers and the write. |

## Testing and verification

- Unit tests with `node:test` on an injected `exec` for discovery (each query, the GHES check above and below 3.19, github.com and GHE.com with no check, `AUTH` on the Project read, `NOT_FOUND`), for `proposeGithubSetup` (recommendations, required categories, one option per category, broken values, `none` Project) and for the config check.
- `runbook-setup-github.test.mjs` runs `node scripts/pmkit.mjs` as a subprocess in a temporary git repository whose origin is a GitHub URL, with a fake `gh` (a small Node script) first on `PATH` that answers from a fixture file and records its argv. It follows the runbook: dry run, Project question, Status and field questions, the write, then `discover --json` and `capabilities --json`, and checks that no call sent a token.
- `npm test` passes apart from the four known failures (PMK-333).
- The Check phase runs the runbook through its E2E test.

## Left for later issues

- Assignable users as `members`, the discovery cache and the mapping check before each operation: PMK-87.
- Labels as the type fallback, and the full degraded flow without a Project: PMK-89.
- A live check of discovery against github.com: a follow-up candidate.
