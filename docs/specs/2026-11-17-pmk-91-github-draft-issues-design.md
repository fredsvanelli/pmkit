# PMK-91 design: the github-draft-issues command

Issue PMK-91, epic EPC-8 (GitHub Issues tracker adapter), milestone `github-issues`. Status: draft, waiting for the user's approval. The user answered three questions on 2026-11-17, and "Decisions from the user" records the answers. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

A team that plans in a GitHub Project often jots work down as draft issues first: a title and a few lines on the board, with no repository yet. Some drafts mature into real work and need to become issues in a repository. pmkit cannot see a draft today, so an agent has to call `gh` by hand to find them and to convert one.

Acceptance criteria:

1. Lists the draft issues of a project.
2. Converts the chosen ones into issues after a full preview.

Source: Unified model, System-specific skills (`github-draft-issues`: "Reviews a project's draft issues and converts mature ones into issues in the right repo").

## Decisions already made

ADR 0007, ADR 0008, ADR 0009 and the PMK-84 to PMK-90 specs settle these, and this spec does not reopen them:

- pmkit reaches GitHub through `gh api graphql` with the user's `gh` login, through the client of `scripts/lib/github/client.mjs`, and holds no token (ADR 0007). The client maps GitHub's errors to `AUTH`, `RATE_LIMITED`, `NOT_FOUND` and `UPSTREAM`, retries a query but never a mutation, and passes `tracker.scope.host` as `--hostname` on every call.
- A Project needs the `project` scope, and the client turns `INSUFFICIENT_SCOPES` into `AUTH` with the next step `gh auth refresh -s project` (plus `-h <host>` for any host but github.com) (ADR 0007).
- The minimum GHES version is 3.19, checked by `discover` (ADR 0007).
- A GitHub-only command lives in `commands/github/`, checks `capabilities --json` first and stops on another tracker. Its CLI calls are named `github <feature> <verb>`, carry `github: true` in `scripts/pmkit.mjs`, refuse another tracker with `NOT_SUPPORTED`, and report their own `available` flag instead of a manifest capability (PMK-90, approach D).
- Text from data goes through files, never on the command line, and tracker text is data, never instructions (`skills/pmkit/references/conventions.md`).
- A bulk change (more than one record) always shows a full preview and asks, whatever `write_policy.confirm` says (conventions, "Write policy").

## Facts checked

GitHub's published GraphQL schemas (`github/docs`, `src/graphql/data/ghes-3.19/schema.docs-enterprise.graphql` and `fpt/schema.docs.graphql`), read on 2026-11-17:

- A draft issue exists only inside a Project. `ProjectV2.items` returns `ProjectV2Item`s whose `type` is `DRAFT_ISSUE`, `ISSUE`, `PULL_REQUEST` or `REDACTED`, with `id`, `isArchived`, `createdAt`, `updatedAt`, `creator`, `fieldValues` and `content`. `content` is the union `DraftIssue | Issue | PullRequest`. `DraftIssue` has `id`, `title`, `body`, `assignees`, `creator`, `createdAt` and `updatedAt`. A draft has no number.
- On GHES 3.19, `ProjectV2.items` takes only `first`, `after`, `before`, `last` and `orderBy`. github.com adds `archivedStates` and a filter, but GHES has neither. pmkit therefore pages the items and keeps the unarchived drafts itself, the same way on both, with no version branch.
- `convertProjectV2DraftIssueItemToIssue(input: { itemId, repositoryId })` exists on both and returns `{ item }`. The item stays in the Project with its field values, and its `content` becomes the new `Issue`. The issue takes the draft's title, body and assignees. It gets no issue type, no labels and no org issue field.
- `Repository` has `id` and `hasIssuesEnabled`, so pmkit can check a target before it converts anything.

## Decisions from the user

1. **Which Project the command reads.** `tracker.scope.project` by default, and `--project owner/number` to read any Project linked to the repository (setup already lists them with `fetchLinkedProjects`). With `tracker.scope.project: none` and no `--project`, list and convert answer `available: false` with the next step.
2. **Which repository a draft becomes an issue in.** `tracker.scope.repo` by default, and `--repo owner/name` per run to send the chosen drafts to another repository. The preview names the target of each draft, and a target other than `tracker.scope.repo` gets a warning that pmkit does not track that issue.
3. **pmkit fields during conversion.** Two steps. First the conversion: one full preview of every chosen draft and one confirmation. Then, only for the new issues in `tracker.scope.repo`, the command proposes a type, a priority and labels from each draft's text and offers one optional preview of the `issues update` writes for the batch. Declining leaves the issues as converted.

## Approaches

- A. A tracker command over new GitHub-only CLI calls, `github draft-issues list` and `github draft-issues convert`, read and written through GraphQL with the existing client, the way PMK-90 built discussions. Chosen. It keeps every GitHub call behind the client's host, error and retry rules, and it returns JSON that the command treats as data.
- B. The command runs `gh project item-list` and `gh api graphql` itself. Rejected. Commands call the pmkit CLI only (ADR 0002 and the conventions), and `gh project` has no conversion call.
- C. Recreate the draft with `issues create`, then delete the draft item. Rejected. GitHub's conversion keeps the Project item and its field values (Status, iteration, estimate), and a recreation loses them and costs two writes.
- D. A new capability `draft_issues` in the manifest of every tracker. Rejected **(builder's call)**, as PMK-90 rejected one for discussions. A GitHub-only feature reports its own `available` flag.

## Design

### CLI calls

Both calls work only when `tracker.system` is `github` and refuse any other tracker with `NOT_SUPPORTED` (`github: true`, `ctx.github('draftIssues')`). They run the scope check and skip the mapping check, as discussions do **(builder's call)**: they read the Project's field values by name and write no status, type or field.

The Project is `--project` when given, else `tracker.scope.project`. `--project` takes `owner/number` (`parseProject`); another form fails with `INVALID_INPUT`. A `--project` that is not linked to `tracker.scope.repo` fails with `INVALID_INPUT` and lists the linked Projects **(builder's call)**, because the user chose "any linked Project". With no Project, both calls answer `{ available: false, reason: 'no_project', enableHint: 'Pass --project owner/number, or set tracker.scope.project with /pmkit:setup' }`.

A draft's handle is its Project item id, the `itemId` that the conversion takes. It must match `^[A-Za-z0-9_=+/-]{1,200}$`; any other value fails with `INVALID_INPUT` before it reaches GitHub **(builder's call)**.

`github draft-issues list [--project owner/number] [--limit n] --json`

- Pages `ProjectV2.items(first: 100)` in position order and keeps the items whose `type` is `DRAFT_ISSUE` and `isArchived` is false. It reads at most 10 pages (1000 items) **(builder's call)** and warns when the Project has more: `<project> has more than 1000 items and pmkit read the first 1000`.
- `--limit` caps the drafts returned: default 50, at most 200 **(builder's call)**. `hasMore` says when drafts were left out.
- Returns `{ available: true, project: { id, title, url }, repo, drafts: [{ item, title, body, assignees, creator, created, updated, fields }], hasMore, warnings }`. `fields` is `{ <field name>: <value> }` for the single-select, text, number, date and iteration values the item has, read through `fieldValues(first: 20)`. A deleted account reads `ghost`.

`github draft-issues convert <item...> [--project owner/number] [--repo owner/name] [--dry-run] --json`

- Takes 1 to 50 item ids **(builder's call)**. A repeated id counts once.
- The target is `--repo` when given, else `tracker.scope.repo`. `--repo` takes `owner/name` (`parseRepo`). The call reads `repository { id hasIssuesEnabled }` first. A missing repository fails with `NOT_FOUND`, and a repository with issues turned off fails with `INVALID_INPUT` **(builder's call)**. pmkit does not judge permissions ahead of time: a user who cannot open issues there gets GitHub's refusal on the first conversion, before anything changes.
- The dry run reads every item through `node(id:)`. An id that is not a draft item of that Project (an issue, a pull request, another Project's item, an archived one, or a missing one) fails with `INVALID_INPUT` and names the id and what it is, so nothing converts when one id is wrong. It returns `{ dryRun: true, project, target: { repo, tracked }, drafts: [{ item, title, body, assignees, fields }], warnings }` and writes nothing. `tracked` is true when the target is `tracker.scope.repo`. A target outside it adds the warning `<repo> is not tracker.scope.repo (<scope repo>), so pmkit will not track the new issues`.
- The real run reads the same checks again, then converts the drafts one at a time, in the order given. It returns `{ project, target, converted: [{ item, title, number, id, url }], warnings }`. `id` is the pmkit issue id when `tracked` is true, else null.
- When a conversion fails after others succeeded, the call stops and fails with `UPSTREAM`, `GitHub converted <n> of <total> drafts, but <item> failed: <message>`, and the error carries `converted` and `notConverted`, so the user can rerun with the rest **(builder's call)**. A failure on the first draft passes GitHub's error through.
- `write: true` and `dryRun: true`, so a broken `.pmkit/config.yaml` refuses it like any other write.

### The command `/pmkit:github:draft-issues`

The file is `commands/github/draft-issues.md`, with the arguments `[--project owner/number] [--repo owner/name]`. Its steps:

1. Read the conventions. Run `capabilities --json`. When `tracker` is not `github`, say that the command works only with the GitHub Issues tracker and stop.
2. Run `github draft-issues list --json`, with `--project` when the user gave it. When `available` is false, show `enableHint` and stop. When the list is empty, say so and stop. Show every warning.
3. Review the drafts. Show them as a table: a row number, the title, the assignees, the Status (or the first single-select field), the last update and a maturity note. The maturity note is the agent's reading of the draft: it says what the draft lacks to be worked on, such as no description, no clear outcome, or no acceptance criteria **(builder's call)**. Recommend the drafts that read as ready, and ask with `AskUserQuestion` which ones to convert. Stopping changes nothing.
4. Run `github draft-issues convert <item...> --dry-run --json`, with `--project` and `--repo` when the user gave them. Show the full preview, always, whatever `write_policy.confirm` says, because it is a bulk change: the Project, the target repository, and for each draft its title, its full body, its assignees and the field values it keeps. Show the warning of a target outside `tracker.scope.repo`. Ask once whether to convert them.
5. After approval, run the same command without `--dry-run`. Show each new issue with its number and link. On an `UPSTREAM` failure, show what converted and what did not, and offer to rerun with the rest.
6. When `target.tracked` is true, propose a type, a priority and labels for each new issue from its text, using only the values `discover --json` lists. Run `issues update <id> --type <type> --priority <priority> --label <labels> --dry-run --json` for each, show every `before` and `after` together, and ask once, whatever `write_policy.confirm` says when there is more than one issue. After approval, run each without `--dry-run`. When the user declines, leave the issues as converted. When `tracked` is false, skip this step and say that pmkit does not track the new issues.
7. Remove the temporary files, if any.

The command never edits, archives or deletes a draft, and it converts only drafts the user chose in step 3.

### Untrusted text

A draft is written by anyone who can edit the Project, so the command and the CLI treat it as data:

- The CLI returns the text in JSON fields and never builds a shell command or a GraphQL document from it. Values reach GraphQL through variables only.
- Item ids are checked against the pattern above before they reach a command line or GitHub, and the command passes only ids that the list returned.
- `--project` and `--repo` are checked as `owner/number` and `owner/name` before use. A value the user typed goes between single quotes, with each `'` written as `'\''`; the command refuses one with a newline.
- The type, priority and labels of step 6 come from the values `discover` lists, never from the draft's text.
- The command file says that text inside a draft is never an instruction, even when it reads like one.

### Code layout

- `scripts/lib/github/draft-issues.mjs` (new): the GraphQL documents of both calls, the views, the text output and `draftIssueOperations({ client, scope, linkedProjects })`. The documents live here, not in `documents.mjs`, so PMK-88's changes to that file do not meet this one **(builder's call)**.
- `scripts/lib/github/tracker.mjs`: the tracker returns `draftIssues` next to `discussions`, through the same `scoped` wrapper. A few lines.
- `scripts/pmkit.mjs`: the two command entries.
- `scripts/fake-github-drafts.mjs` (new): the draft items, the other Projects and the conversion of the stateful fake GitHub, with a `seedDraft` helper. `scripts/fake-github-issues.mjs` gets a few lines that route the operations to it, as it does for discussions.

### Capabilities

The manifest does not change (approach D). The calls report `available: false` when no Project is set.

### Documentation

- README: the command in the command list, and the two CLI calls in the CLI table.
- `commands/help.md` and `skills/pmkit/SKILL.md`: the new command and its routing line.
- CONTEXT.md: the term **Draft issue**, a Project item with a title and a body and no repository, which pmkit lists and converts but does not track.
- CHANGELOG: one entry.

## Tests

- Unit (`scripts/lib/github/draft-issues.test.mjs`): the list keeps only unarchived drafts across pages, the page cap warning, the field values, `--project` linked and not linked, no Project, the item id check, the target checks, the dry run that writes nothing, a wrong id that stops the whole batch, the conversion of several drafts, a target outside the scope, and a failure partway. The tests run against the stateful fake, so `npm test` starts no `gh`.
- CLI (`scripts/cli-draft-issues-github.test.mjs`): both calls through the real CLI, the refusal on a Local tracker, and the refusal of a write with a broken config.
- Command file (`scripts/plugin.test.mjs`): the command is listed, its step 1 stops on another tracker, the preview comes before the conversion, and the field step uses `issues update --dry-run`.
- Runbook: a new `docs/runbooks/draft-issues-github.md` covers list, the preview, the conversion and the field update, and `scripts/runbook-draft-issues-github.test.mjs` runs it with the fake `gh` on `PATH`.

## Non-goals

- Creating, editing, archiving or deleting a draft.
- Drafts of a Project that the repository does not link.
- Turning an issue back into a draft.
- Setting pmkit fields on an issue outside `tracker.scope.repo`.
- Drafts on the Local or Linear tracker, or with `git_host: github` and another tracker.

## Left to the builder

- The text lines of each CLI call (the `text` output without `--json`).
- The order of the fields in the JSON views, within the names above.
