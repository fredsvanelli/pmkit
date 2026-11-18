# PMK-343 plan: one model of Project items in the fake GitHub

Design: `docs/specs/2026-11-17-pmk-343-fake-github-project-items-design.md`. Small task, run in sequence by one agent, test first. Every commit message carries PMK-343.

## Task 1: failing tests

1. `scripts/fake-github-issues.test.mjs`: change the PMK-88 test to `seedProjectItem('acme/12', { type: 'PULL_REQUEST', title })` and `seedDraft({ project: 'PVT_E12', title: 'Idea' })`, and check each item's `content` (`PullRequest` with its title, `DraftIssue` with `Idea`). Add cases for a `REDACTED` item (content `null`), `seedProjectItem` refusing `DRAFT_ISSUE` and `ISSUE`, a field write and clear on a draft item, and a version 2 state saved with `kind` that loads.
2. `scripts/lib/github/project-ops.test.mjs`: the `deliverableProgress` test seeds the draft with `seedDraft({ project: 'PVT_E12' })`.
3. `scripts/lib/github/draft-issues.test.mjs`: the pull request and redacted cases use `seedProjectItem('acme/7', { type })`.
4. Run the three files and see the new cases fail for the expected reason.

## Task 2: the model

1. `scripts/fake-github-issues.mjs`: `addItem` sets `type: 'ISSUE'`; `contentOf(item, vars)` replaces `contentOfOtherItem`; `PmkitEpicItems` uses it; `writeProjectValue` records the issue event only for an `ISSUE` item; `seedProjectItem(ref, { type, title })` looks in every Project by `owner/number` and takes `PULL_REQUEST` or `REDACTED`; `fakeGithubIssuesFrom` fills `type` on older items; pass `contentOf` and an any-Project lookup to `draftRoutes`.
2. `scripts/fake-github-drafts.mjs`: `itemView` answers `type: item.type` and `contentOf(item)`; `projects()` takes the epic Projects too; `seedDraft` sets `type: 'DRAFT_ISSUE'`; the conversion checks `type` and sets `type: 'ISSUE'`. Update the header comment.
3. Run the three test files until they pass, then commit.

## Task 3: E2E and runbook

1. `scripts/runbook-cycles-epics-github.test.mjs`: seed a draft and a pull request in `acme/12`, and add a step that runs `epic progress acme/12 --json` and `epic get acme/12 --json` and expects `total: 0`.
2. `docs/runbooks/cycles-epics-github.md`: add the two items to "Before you start" and the matching step.
3. Run the runbook test, then commit.

## Task 4: full suite

Run `npm test` and confirm 0 failures.
