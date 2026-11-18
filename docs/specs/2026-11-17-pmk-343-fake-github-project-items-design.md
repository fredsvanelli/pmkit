# PMK-343 design: one model of Project items in the fake GitHub

Issue PMK-343, epic EPC-8 (GitHub Issues tracker adapter), milestone `github-issues`. Status: approved by the user on 2026-11-17, with the builder's calls. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The stateful fake GitHub (`scripts/fake-github-issues.mjs` and `scripts/fake-github-drafts.mjs`) has two models of a Project item that is not an issue:

- PMK-88 added `item.kind` (`PULL_REQUEST` or `DRAFT_ISSUE`) and `item.title`, set by `seedProjectItem`. Only `PmkitEpicItems` reads it.
- PMK-91 added `item.draft` (title, body, assignees, creator, dates), set by `seedDraft`, plus an optional `item.type` that a test sets by hand to stand for a pull request or a redacted item. Only the draft reads (`PmkitDraftItems`, `PmkitDraftItem`) and the conversion read it.

The two do not meet. Checked on `develop` on 2026-11-17:

- `seedDraft({ project: 'PVT_E12' })` throws `seedDraft names an unknown Project`, because the draft module knows the scope Project and the `--project` Projects but not the epic Projects.
- A draft item made by hand in an epic Project makes `PmkitEpicItems` answer `NOT_FOUND` for the id `null`: the read has no `kind`, so it looks up `issueId`, which a draft does not have.
- A draft item whose `type` a test sets to `PULL_REQUEST` still answers `DraftIssue` content with a draft title, which GitHub never does.

So a test of the epic progress can pass against a fake that GitHub would answer differently, and a test cannot put a draft in an epic at all.

Acceptance criteria:

1. The fake GitHub has one model of Project item content (issue, pull request, draft issue).
2. A test puts a draft issue in an epic Project and reads the epic.

## Facts checked

GitHub's GraphQL schema, as the PMK-91 design records it: a `ProjectV2Item` has `type`, one of `ISSUE`, `PULL_REQUEST`, `DRAFT_ISSUE` and `REDACTED`, and `content`, the union `Issue | PullRequest | DraftIssue`. `content` is null for a `REDACTED` item. Every Project holds the three kinds of content, so an epic Project can hold a draft issue the same way the scope Project can.

Production code that reads items, read on 2026-11-17:

- `deliverableProgress` (`scripts/lib/github/project-ops.mjs`) reads `PmkitEpicItems`, which selects `content { __typename ... on Issue { ...PmkitIssueFields } }`, and keeps only the `Issue` nodes. `epic get`, `epic progress`, `epic list`, the report and the goal rollup reach it.
- `draftIssueOperations` (`scripts/lib/github/draft-issues.mjs`) reads `type` and `content { ... on DraftIssue { ... } }`, and names a `PULL_REQUEST` or `REDACTED` item as not a draft.

Neither needs a change for this issue, unless the new test finds a bug. Any production fix goes to the user first.

## Design

### The item model (builder's call)

Every item in `state.items` gets `type`, GitHub's `ProjectV2ItemType`, and the content its type needs:

| `type` | Content keys | `content` the fake answers |
| --- | --- | --- |
| `ISSUE` | `issueId` | the issue node, as today |
| `DRAFT_ISSUE` | `draft` (title, body, assignees, creator, createdAt, updatedAt) | `DraftIssue` with those fields |
| `PULL_REQUEST` | `pullRequest` (`title`) | `PullRequest` with its title |
| `REDACTED` | none | `null` |

`kind` and the top-level `title` go away. `issueId` stays the key of an issue item, so `itemsOf`, `addItem`, the delete mutations and the issue reads keep their code. A non-issue item has `issueId: null`.

The table matches GitHub's own split between `type` and `content`, so a reader that branches on either one gets the answer GitHub gives. Keeping `issueId` instead of nesting the content under one key keeps the change small in a file that another worker may edit at the same time.

### One content function (builder's call)

`fake-github-issues.mjs` gets `contentOf(item, vars)`, which returns the `content` of the table above. `PmkitEpicItems` uses it in place of `contentOfOtherItem`, and the draft module's `itemView` gets it as a helper in place of its own branch on `item.draft`. `itemView` answers `type: item.type`. Each read keeps its own rule for `__typename`.

### Seeding (builder's call)

- `seedDraft({ project })` accepts any Project of the fake: the scope Project, an epic Project or a `--project` Project. A draft is the same record wherever it sits.
- `seedProjectItem(project, { type, title })` replaces `{ kind, title }`. It takes `PULL_REQUEST` or `REDACTED`, in any Project named as `owner/number`. A draft comes from `seedDraft` only, and an issue from `seed`, so each kind of content has one way in. `seedProjectItem` throws on any other type and names the right helper.
- The two tests that call `seedProjectItem({ kind })` and the PMK-91 test that sets `item.type` by hand move to these helpers.

### Writes on items (builder's call)

- `PmkitAddProjectItem` makes an `ISSUE` item.
- `PmkitConvertDraftItem` refuses an item whose `type` is not `DRAFT_ISSUE`, and turns the item into an `ISSUE` item with the new `issueId`, as it does today with `draft`.
- `PmkitSetProjectField` and `PmkitClearProjectField` on a non-issue item set the value and record no issue event. Today they fail with `NOT_FOUND` for the id `null`, and GitHub accepts a field value on a draft or a pull request item.

### Older saved states (builder's call)

`fakeGithubIssuesFrom` already upgrades a version 1 state. It also fills `type` on items saved before this change: `DRAFT_ISSUE` for an item with `draft`, the old `kind` with its `title` moved to `pullRequest` or `draft`, and `ISSUE` otherwise. The state version stays 2, because the new keys are a superset.

## Tests

- `scripts/fake-github-issues.test.mjs`: the PMK-88 test of a pull request and a draft in an epic Project uses the new helpers and checks the `content` of each item, including the draft's title. A new case checks that a field write on a draft item sets the value, and that an older state with `kind` loads.
- `scripts/lib/github/project-ops.test.mjs`: the test `deliverableProgress skips a pull request item and a draft item` puts the draft in the epic with `seedDraft({ project })` and reads the epic. This is acceptance criterion 2 at the unit level.
- `scripts/lib/github/draft-issues.test.mjs`: the pull request and redacted cases use `seedProjectItem`.
- E2E: `scripts/runbook-cycles-epics-github.test.mjs` seeds a draft issue and a pull request in the epic Project `acme/12`, and its epic steps read `acme/12` through the CLI. This is acceptance criterion 2 end to end.

`npm test` stays at 0 failures.

## Runbooks

`docs/runbooks/cycles-epics-github.md` names the draft and the pull request of `acme/12` in "Before you start", and its epic step says that the epic progress counts issues only. No other runbook covers a flow this issue changes.

## Out of scope

- The three Project lists of the fake (`state.project`, `state.projects` for epics, `state.extraProjects` for `--project`) stay apart. `seedDraft` and the draft reads look in all three, and merging them is a candidate follow-up.
- A `PullRequest` node beyond `__typename` and `title`: no production read selects more.
- Any capability in the manifest: this issue changes test code only.
