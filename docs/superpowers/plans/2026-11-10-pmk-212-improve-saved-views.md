# PMK-212 Improve saved views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `views delete`/`views rename`, stricter `validate` for views, `views run --limit/--sort`, and Linear custom views served by `views list`/`views run`.

**Architecture:** Two new contract operations (`deleteView`, `renameView`) beside the existing view operations; the Local tracker implements all five, the Linear tracker implements `listViews`/`runView` over `customViews` and refuses the three writes. The CLI commands stay thin over the contract.

**Tech Stack:** Node ESM, `node:test`, the fake Linear fetch in `scripts/fake-linear-api.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-10-pmk-212-improve-saved-views-design.md`

## Global Constraints

- Every commit message carries `(PMK-212)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm test` exits 0, in the foreground.
- Linear refusal text: `Linear views are created, renamed and deleted in Linear; pmkit reads and runs them`.
- Linear manifest entry: `saved_views: { path: 'native', detail: { unsupported: ['saveView', 'deleteView', 'renameView'] } }`.
- A cut Linear read (views or issues) is reported as incomplete (`hasMore: true` plus a warning), never as a complete list.

## Review Focus

- `views run --sort bogus` on Local: must be `INVALID_INPUT` about the flag, not `view_out_of_date` (Task 3 test).
- `views rename mine Mine`: a case-only rename of the same file must work, not answer `CONFLICT` (Task 1 test).
- `views delete` of a view file that does not parse: must delete it and say what was lost (Task 1 test).
- A Linear view name not found while the view list was cut: the error must say the list was cut (Task 4 test).
- Two Linear views with the same name: `INVALID_INPUT` `ambiguous_view_name` with both ids; running by id works (Task 4 test).

---

### Task 1: Local `views delete` and `views rename`

**Files:**
- Modify: `scripts/lib/contract.mjs` (add `'deleteView', 'renameView'` after `'runView'`)
- Modify: `scripts/lib/local/tracker.mjs` (views block near `saveView`)
- Modify: `scripts/lib/linear/tracker.mjs` (stubs come from the contract list, nothing to add yet)
- Modify: `scripts/lib/capabilities.mjs` (`SERVED_BY.saved_views` adds `'views delete', 'views rename'`)
- Modify: `scripts/pmkit.mjs` (two commands after `views run`)
- Test: `scripts/views.test.mjs`, `scripts/cli.test.mjs` or a new block in `scripts/views.test.mjs` for the CLI

**Interfaces:**
- Produces: `tracker.deleteView(name, actor, { dryRun }) -> { before: { name, filter } | { name, unreadable }, after: null }`; `tracker.renameView(name, newName, actor, { dryRun }) -> { before, after }` where `after` is `{ name: newName, filter }` or `{ name: newName, unreadable }`.

- [ ] Tests: delete removes the file and returns the view in `before`; `--dry-run` keeps it; missing → `NOT_FOUND`; bad name → `INVALID_INPUT` reason `invalid_view_name`; broken file → deleted, `before.unreadable` set. Rename moves the file and keeps its bytes; `CONFLICT` when another view has the new name in any case; case-only rename of the same view works; missing → `NOT_FOUND`; dry run writes nothing. CLI: `views delete x --json`, `views rename a b --json` exit 0 with those shapes.
- [ ] Run, see them fail. Implement. Run, see them pass. Commit `feat(views): add views delete and views rename (PMK-212)`.

### Task 2: `validate` checks views more

**Files:**
- Modify: `scripts/lib/validate.mjs` (`noneChecked` gains `views: 0`; views loop counts, flags `{}` and case clashes)
- Modify: `scripts/pmkit.mjs:1818` (head line adds `${c.views} views`)
- Test: `scripts/validate-views.test.mjs`; update the goldens `scripts/__goldens__/*/validate.txt` and the tests that assert the head line or `checked` (`scripts/validate.test.mjs`, `scripts/cli.test.mjs`, `scripts/cli-hosted.test.mjs`, `scripts/migrations.test.mjs`).

- [ ] Tests: `filter: {}` → one `view` problem `view filter is empty, so the view matches every issue`; files `mine.yaml` and `Mine.yaml` (only where the file system keeps both; skip otherwise) → a problem on the later sorted name, `view name "mine" differs from "Mine" only in case`; two readable views → `checked.views === 2`.
- [ ] Fail, implement, pass, commit `feat(validate): check view names by case, empty filters and count views (PMK-212)`.

### Task 3: `views run --limit --sort`

**Files:**
- Modify: `scripts/lib/local/tracker.mjs` (`runView(name, overrides = {})`)
- Modify: `scripts/pmkit.mjs` (`views run` flags `limit`, `sort`; usage `<name> [--limit n] [--sort s]`)
- Test: `scripts/views.test.mjs`

**Interfaces:**
- Produces: `tracker.runView(name, { limit, sort }) -> { issues, problems, hasMore, view, overrides }`; `overrides` holds only the keys given.

- [ ] Tests: a view stored with `limit: 1, sort: created` returns 2 issues with `--limit 2` and priority order with `--sort priority`; the file is unchanged; `--sort bogus` → `INVALID_INPUT` without `reason: view_out_of_date`; `overrides` in the JSON.
- [ ] Check overrides with `checkFilter` before the stored filter runs. Fail, implement, pass, commit `feat(views): let views run override the limit and the sort (PMK-212)`.

### Task 4: Linear custom views

**Files:**
- Create: `scripts/lib/linear/views.mjs` (`viewOperations({ client, discovery, config, issues })` → `{ listViews, runView, saveView, deleteView, renameView }`)
- Modify: `scripts/lib/linear/documents.mjs` (`CUSTOM_VIEWS_QUERY` named `PmkitCustomViews`; `CUSTOM_VIEW_ISSUES_QUERY` named `PmkitCustomViewIssues`, `customView(id: $id) { issues(first, after) { nodes { ...PmkitIssueFields } pageInfo } }`)
- Modify: `scripts/lib/linear/tracker.mjs` (wire the five operations)
- Modify: `scripts/lib/linear/manifest.mjs` (the entry from Global Constraints)
- Modify: `scripts/lib/linear/verify-api.mjs` (a `custom_views` feature with a live read)
- Modify: `scripts/fake-linear-api.mjs` (`fakeCustomViews({ views, issues })` routes; expose the issue fake's `search`)
- Modify: `scripts/pmkit.mjs` (`views list` text shows `JSON.stringify(view.linear.filterData)` when `filter` is null; `views run` sprint check uses `view.filter?.sprint`; hasMore warning for a cut view list)
- Test: `scripts/lib/linear/views.test.mjs` (or in `cli-linear.test.mjs`), `scripts/lib/linear/manifest.test.mjs`, the `views` block of `scripts/cli-linear.test.mjs:1211`

**Interfaces:**
- Consumes: `issues.context()`, `issues.contextFor(nodes)`, `issues.completeNested(node)`, `toIssue`, `blockedOpen`, `finishSearch`.
- Produces: Linear view shape `{ name, id, filter: null, linear: { team, shared, filterData } }`; `listViews() -> { views, problems: [], hasMore }`.

- [ ] Tests: list keeps team ACME views and team-less views, drops other teams and project views; a cut list sets `hasMore` and the CLI warns; run by name returns the view's issues in created order, honours `--limit`/`--sort`; run by id; duplicate names → `ambiguous_view_name`; missing name → `NOT_FOUND` (with "the view list was cut" when it was); `views save/delete/rename` → `NOT_SUPPORTED` with the refusal text and no mutation sent; manifest entry is native with the three unsupported operations.
- [ ] Fail, implement, pass, commit `feat(linear): read and run Linear custom views (PMK-212)`.

### Task 5: Commands and docs

**Files:**
- Modify: `commands/issues/run-view.md`, `commands/issues/find.md`, `commands/local/doctor.md`, `README.md` (CLI table rows for `views delete`, `views rename`, `views run`), `CHANGELOG.md` (`## Unreleased`, top line), `scripts/lib/linear/migrate-fields.mjs` loss text only if it says pmkit cannot read Linear views (it says pmkit does not create them, which stays true).
- Test: the scenario of `run-view` in `scripts/__scenarios__/` if its expectations name the Linear refusal; `npm test`.

- [ ] Update, run `npm test` (exit 0), commit `docs(views): document views delete, rename, overrides and Linear views (PMK-212)`.
