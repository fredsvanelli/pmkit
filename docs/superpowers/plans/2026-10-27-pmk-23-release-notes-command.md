# PMK-23 the release-notes command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `release-notes` is a CLI read that returns the done issues of a release, a sprint or a period, grouped by type, with the basis it used and why. `/pmkit:report:release-notes` turns that result into notes for a user of the product, and saves them as a document only after the user confirms.

**Architecture:** A pure module, `scripts/lib/release-notes.mjs`, has two functions. `chooseBasis` picks release, sprint or period from records the CLI passes in. `buildNotes` classifies, groups and counts the issues the CLI collected. A read entry in `COMMANDS` loads the records and the issues from the tracker, and `releaseNotesText` in `scripts/lib/format.mjs` prints the result. One contract operation gains an optional argument, `releaseIssues(id, { archived })`. A new command file writes the prose.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. Run the suite with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-27-pmk-23-release-notes-command-design.md`. The spec is the authority. Where this plan and the spec differ, the spec wins, and the implementer reports the difference.

## Global Constraints

### Decided in the spec

- Question 1, answer (a). Done issues of type `chore` are left out of the groups and counted in `counts.excluded.chore`. The command shows one line with that count.
- Question 2, answer (a). Notes for a release that is not released, or a sprint that is not closed, need `--release <id>` or `--sprint <id>`, carry `draft: true`, and are never the default.
- Question 3, answer (c). The saved document ends with an "Included issues" list that holds the issue IDs. The bullets carry no ID.
- ADR-0002: a command never computes. The CLI selects and groups, the command file only writes prose.
- Done means status category `done`. `canceled` is not done. Archived issues count on every basis.
- Default basis order without a selector is release (latest `released` time, ties to the later one in list order), then sprint (closed, latest `end`, ties to the later one in list order), then period (the last `defaults.status_update_window_days` days, 14 when missing, ending today).
- Selectors `--release`, `--sprint` and `--since [--until]` exclude each other. Two of them, or `--until` alone, are `INVALID_INPUT` with the next step `pmkit release-notes --help`.
- The command reads only. It takes no `--dry-run` and no `--as`.
- Saving is always asked with `AskUserQuestion`, whatever `write_policy.confirm` says. The document path is `release-notes/<name>.md`, and `docs create` refuses an existing file.
- `CHANGELOG.md` does not change on this branch.

### Terms used below

- `reason` values: `requested`, `latest`, `no_released_release`, `releases_absent`, `no_closed_sprint`. With no selector and a basis that is not a release, `reason` names the failure of the step just before the basis used, and `skipped` holds every failed step as `{ basis, reason }`.
- Candidate: `{ issue, doneAt }`. `issue` is a tracker issue record. `doneAt` is the time of the last move into done for the sprint and period bases, and `null` for the release basis.
- Creation order: `issue.created` ascending, then `compareIds` from `scripts/lib/ids.mjs`.

### The module

`scripts/lib/release-notes.mjs` is pure and reads no file, as `scripts/lib/metrics.mjs` reads none.

```js
/**
 * @param {object} input
 * @param {null | {release: object} | {sprint: object} | {since: string, until?: string}} input.selector records already read from the tracker, or null
 * @param {object[] | null} input.releases listReleases() output, or null when the releases capability is absent
 * @param {object[] | null} input.sprints listCycles() output, or null when the cycles capability is absent
 * @param {string} input.today YYYY-MM-DD, UTC
 * @param {number} input.windowDays
 * @returns {{ basis, reason, draft, source, period, skipped }}
 */
export function chooseBasis({ selector, releases, sprints, today, windowDays })

/**
 * @param {object} input
 * @param {object} input.choice the return value of chooseBasis
 * @param {{issue: object, doneAt: string | null}[]} input.candidates
 * @param {string[]} input.types the tracker's types, in order
 * @param {object[]} [input.problems=[]]
 * @returns the result object of the spec, "Result"
 */
export function buildNotes({ choice, candidates, types, problems = [] })
```

`chooseBasis` rules:

- A selector gives `reason: 'requested'` and `skipped: []`. `draft` is true for a release in state `planned` and for a sprint whose state is not `closed`. A period selector has `period: { since, until: until ?? today, defaulted: false }`.
- No selector: the release step applies when `releases` is not null and has a release in state `released`. The sprint step applies when `sprints` is not null and has a `closed` sprint. Otherwise the period applies with `{ since: today minus windowDays days, until: today, defaulted: true }`. `reason` is `latest` when the first step that applies is the first one tried. Otherwise it is the reason of the failure just before the basis used.
- A failed release step adds `{ basis: 'release', reason: 'releases_absent' }` when `releases` is null and `{ basis: 'release', reason: 'no_released_release' }` otherwise. A failed sprint step adds `{ basis: 'sprint', reason: 'no_closed_sprint' }`.
- `source` is the release or sprint record, and `null` for a period. `period` is `null` for a release or sprint. `draft` is false without a selector.

`buildNotes` rules:

- Classify by `issue.status.category`. `done` is listed, `canceled` adds to `excluded.canceled`, and any other category adds to `excluded.open`. A done issue whose `type` is `chore` adds to `excluded.chore` and is not listed.
- Groups follow `types` in order, then a group with `type: null` for an issue whose type is missing or not in `types`. An empty group is not in the result. Inside a group, issues are in creation order.
- An entry holds `id`, `title`, `description`, `type`, `labels`, `parent`, `archived`, `doneAt` and `release`, each `null` or `[]` when the issue has none.
- Result keys in order: `basis`, `reason`, `draft`, `source`, `period`, `groups`, `counts`, `skipped`, `problems`. `counts` is `{ done, excluded: { open, canceled, chore } }` where `done` is the number of listed issues.

### The CLI entry (Task 5)

In `COMMANDS` in `scripts/pmkit.mjs`, right after `release mark-released`:

```js
{
  name: 'release-notes', summary: 'the done issues of a release, a sprint or a period, grouped by type', usage: '[--release id | --sprint id | --since d [--until d]]', flags: ['release', 'sprint', 'since', 'until'],
  run: (ctx) => { ... },
}
```

No `write`. `run`:

1. Count the selectors given. Two or more of `release`, `sprint`, `since`, or `until` without `since`, or `since` after `until`, throws `usageError(message, 'pmkit release-notes --help')`. Validate dates with `rangeText`, as `rangeOptions` does.
2. Read `tracker.capabilities().capabilities`. `releases` is on when its `path` is not `absent`, and the same for `cycles`. `releases = on ? tracker.listReleases() : null`, and `sprints = on ? tracker.listCycles({}) : null`.
3. Resolve the selector. `--release` calls `tracker.getRelease(id)`, which throws `NOT_FOUND` with the next step `pmkit release list`. `--sprint` finds the id in `sprints`, or throws a `PmkitError('NOT_FOUND', 'sprint <id> does not exist', 'pmkit cycle list')`.
4. `choice = chooseBasis({ selector, releases, sprints, today: ctx.now().toISOString().slice(0, 10), windowDays: ctx.config().local.defaults.status_update_window_days ?? 14 })`.
5. Collect candidates. Release: `tracker.releaseIssues(source.id, { archived: true })`, each with `doneAt: null`. Sprint: `tracker.searchIssues({ sprint: source.id, archived: true })`, each with `doneAt` from `lastEntry(events[issue.id] ?? [], 'done', tracker.categoryOf)`, where `events = tracker.eventsByIssue()`. Period: `doneInRange(tracker.eventsByIssue(), { categoryOf: tracker.categoryOf, since, until })`, then `tracker.getIssue(id)` for each key with the same `lastEntry` time. An ID that fails to read becomes the problem `{ id, code: error.code, message: error.message }`, and the run goes on. Add the `problems` of `searchIssues`.
6. `result = buildNotes({ choice, candidates, types: ctx.config().local.types, problems })`. Return `{ data: result, text: releaseNotesText(result), warnings: result.problems.map(problemLine) }`.

Import `chooseBasis` and `buildNotes` from `./lib/release-notes.mjs`, `lastEntry` and `doneInRange` from `./lib/metrics.mjs` if not imported yet, and `releaseNotesText` from `./lib/format.mjs`.

### The text layout (Task 4)

`releaseNotesText(result)` in `scripts/lib/format.mjs`. Lines, in order:

1. The basis line. Release: `release <id> (tag <tag>, released <date>)`, with `tag <tag>, ` dropped when there is no tag, and `release <id> (planned, target <date>)` for a planned release (`, target <date>` dropped when there is none). Sprint: `sprint <id> (<start> to <end>)`. Period: `period <since> to <until>`, plus ` (default window)` when `defaulted`.
2. When `skipped` is not empty: `<phrases joined with ', '>, so the notes use <basis phrase>`. Phrases: `no released release`, `this tracker has no releases`, `no closed sprint`. Basis phrases: `sprint <id>`, `the last <n> days` where n is the whole days between `since` and `until`.
3. When `draft`: `draft: release <id> is not released yet` or `draft: sprint <id> is not closed`.
4. A blank line. With no groups, `no done issues`. Otherwise for each group: `<type or no type> (<n>)`, a `table` with `ID`, `Title` and, unless the basis is `release`, `Done` (the date part of `doneAt`), then a blank line.
5. When any `counts.excluded` value is above zero: `left out: <parts joined with ', '>`, with the parts `<n> not done`, `<n> canceled` and `<n> chore` in that order, zero parts dropped.

### Files

- Create: `scripts/lib/release-notes.mjs`, `scripts/release-notes.test.mjs`, `commands/report/release-notes.md`, `scripts/__scenarios__/report-release-notes.mjs`, `scripts/__scenarios__/_inputs/release-notes.md`.
- Modify: `scripts/lib/local/tracker.mjs` (`releaseIssues`), `scripts/contract-suite.mjs`, `scripts/pmkit.mjs`, `scripts/lib/format.mjs`, `scripts/lib/capabilities.mjs`, `scripts/cli.test.mjs`, `scripts/tracker-releases.test.mjs`, `scripts/capabilities.test.mjs`, `scripts/goldens.test.mjs`, `scripts/plugin.test.mjs`, `scripts/scenarios.test.mjs`, `skills/pmkit/SKILL.md`, `README.md`, `CONTEXT.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`.
- By regeneration only: `scripts/__goldens__/{basic,team,messy-merge,no-sprints}/release-notes.txt` and `scripts/__scenarios__/report-release-notes.{0,1}.after.txt`.
- Must not change: `scripts/__fixtures__/`, `schemas/`, `templates/`, `CHANGELOG.md`, every other command file, `skills/pmkit/references/conventions.md`, and the existing goldens (`release issues` has no `--archived` case, so none moves).

### Goldens and scenario snapshots

Never edit a golden or a snapshot by hand. Regenerate only with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs` and `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then read every new file and `git diff` line by line. If an existing golden or snapshot changes, run `git checkout -- <file>`, find the cause and fix the code.

Never run the CLI from inside `scripts/__fixtures__/`. A read there writes `.issues/.cache/` into the fixture and 16 tests then fail. Use `makeRepo(<fixture>)` copies. If it happens, `rm -rf scripts/__fixtures__/*/.issues/.cache`.

### Tests and commits

- Baseline: 1272 tests pass at fc29797. The final count must be higher.
- TDD: write the tests of a task first, run them, and see them fail for the reason the task states before writing the code.
- Every task runs its focused tests, then `npm test` in full, before its commit. Every commit leaves `npm test` green.
- Commit subject: `<type>: <subject> (PMK-23)`. The body is the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Straight quotes and no em dashes in prose. No new dependency. Do not run pmkit write commands on this repo's `.issues/`.
- Order matters. No doc, string literal or test names `release-notes` as a command or a file before the task that adds it. A string literal that starts with `pmkit ` must name a real command (a test checks it), and a `${CLAUDE_PLUGIN_ROOT}/...` path must exist.
- `main` has moved (PMK-21, PMK-24 and PMK-25 add commands). Command counts, `COMMANDS` lists and import lines will differ at merge time. Plan against this branch, and add the new item next to its neighbors so the rebase conflicts stay small.

### Acceptance criteria

| Criterion | Covered by |
|---|---|
| 1. Groups completed issues by release, sprint or period | Task 3 (grouping tests), Task 5 (CLI tests for each basis, goldens), Task 6 (scenario entry 0, command file step 3) |
| 2. Without releases it uses a sprint or a period, and says so | Task 2 (every `reason`), Task 4 (the second text line), Task 5 (`team` and `no-sprints` goldens), Task 6 (scenario entry 1, command file step 2) |
| 3. Optionally saves the notes as a document after confirmation | Task 6 (`docs create` dry run, confirm, write in entry 0, decline in entry 1). The `CONFLICT` on an existing path is `createDocument`, already checked in `scripts/contract-suite.mjs`. |
| Archived gap of `release issues` | Task 1 |

## Review Focus

1. A done issue that was reopened inside the period. It must not be listed, and `excluded.open` counts it. Pinned in Task 3.
2. A done issue archived after the release was released. It must be listed for the release basis. Pinned in Tasks 1 and 5.
3. Two released releases with the same `released` time. The later one in list order wins. Pinned in Task 2.
4. A basis with no done issue at all, or only chores. `groups` is `[]`, the text says `no done issues`, and the command writes no document. Pinned in Tasks 3, 4 and 6.
5. An issue type that is not in the tracker's `types`, and an event log whose issue file is gone. The first goes to the `type: null` group, the second becomes a `problems` entry and the run exits 0. Pinned in Tasks 3 and 5.

---

### Task 1: `releaseIssues` takes `archived`, and `release issues --archived`

**Files:**
- Modify: `scripts/lib/local/tracker.mjs` (`releaseIssues`), `scripts/pmkit.mjs` (`release issues`), `scripts/contract-suite.mjs`, `README.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`
- Test: `scripts/tracker-releases.test.mjs`, `scripts/cli.test.mjs`

**Interfaces:**
- Consumes: `searchIssues({ release, archived })`, which already exists.
- Produces: `releaseIssues(id, { archived = false } = {})`, returning archived members too when `archived` is true, and the CLI flag `release issues <id> --archived`. Task 5 calls `releaseIssues(id, { archived: true })`.

- [ ] **Step 1: Write the failing tests.**
  - `scripts/contract-suite.mjs`, in `lists the issues of a release and marks it released`, before `markReleased`: archive `first` with `tracker.archive(first.id, actor)`. Assert `releaseIssues('contract-2.0')` ids are `[second.id]` and `releaseIssues('contract-2.0', { archived: true })` ids sorted are `[first.id, second.id].sort()`. Keep the existing member assertion by moving the archive after it.
  - `scripts/tracker-releases.test.mjs`: `releaseIssues keeps archived members only with archived true`, on a Local tracker with one release and two issues in it, one archived. The default call returns one ID and the `{ archived: true }` call returns two.
  - `scripts/cli.test.mjs`, next to the other release tests: `release issues --archived lists archived members`. On `makeRepo('basic')`: create release `1.2.0`, create two issues, `issues update <id> --release 1.2.0` for each, `issues archive` one. `release issues 1.2.0 --json` has one issue, `release issues 1.2.0 --archived --json` has two, and the text run shows both IDs. In the `--help` flag list test, if one lists flags per command, add `archived` for `release issues`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/tracker-releases.test.mjs scripts/cli.test.mjs scripts/contract.test.mjs`
Expected: the three new assertions FAIL (the archived member is missing, and `--archived` is `unknown option`).

- [ ] **Step 3: Implement.**
  - `releaseIssues = (id, { archived = false } = {}) => searchIssues({ release: getRelease(id).id, ...(archived ? { archived: true } : {}) }).issues` in `scripts/lib/local/tracker.mjs`.
  - `release issues` in `scripts/pmkit.mjs`: usage `<id> [--archived]`, `flags: ['archived']`, and `ctx.tracker().releaseIssues(ctx.args[0], { archived: ctx.opt('archived') === true })`. Read how `issues list` reads its `archived` flag in `issueFilter` and do the same.
  - Docs: the Contract table row of the design spec becomes `releaseIssues(id, { archived })`. The CLI row `release list ..., release issues <id>` gets `[--archived]` on `release issues`. `README.md` row `release issues <id>` becomes `release issues <id> [--archived]` and its text says `lists the issues of a release; --archived keeps the archived ones`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/tracker-releases.test.mjs scripts/cli.test.mjs scripts/contract.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, and `git status --short scripts/__goldens__` is empty.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/local/tracker.mjs scripts/pmkit.mjs scripts/contract-suite.mjs scripts/tracker-releases.test.mjs scripts/cli.test.mjs README.md docs/superpowers/specs/2026-10-23-pmkit-design.md
git commit -m "feat: let releaseIssues and release issues keep archived issues (PMK-23)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: choose the basis

**Files:**
- Create: `scripts/lib/release-notes.mjs`, `scripts/release-notes.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `chooseBasis(input)` as in "The module". `buildNotes` is a stub that Task 3 fills, so export only `chooseBasis` in this task.

- [ ] **Step 1: Write the failing tests** in `scripts/release-notes.test.mjs`. Helpers: `rel = (id, fields) => ({ id, name: id, state: 'released', released: '2026-10-01T10:00:00Z', ...fields })`, `spr = (id, fields) => ({ id, name: id, state: 'closed', start: '2026-09-01', end: '2026-09-14', ...fields })`, and `base = { selector: null, releases: [], sprints: [], today: '2026-10-23', windowDays: 14 }`.
  - `a selector gives the requested reason and no skipped steps`: `{ release: planned }` gives `basis: 'release'`, `reason: 'requested'`, `draft: true`, `source` equal to the record, `period: null`, `skipped: []`. A released release gives `draft: false`. `{ sprint: active }` gives `basis: 'sprint'`, `draft: true`. A closed sprint gives `draft: false`. `{ since: '2026-10-01' }` gives `period: { since: '2026-10-01', until: '2026-10-23', defaulted: false }`, `source: null`, `draft: false`. `{ since: '2026-10-01', until: '2026-10-05' }` keeps `until`.
  - `no selector takes the released release with the latest released time`: releases `1.0.0` (released 2026-10-01), `1.1.0` (planned), `0.9.0` (released 2026-10-10, listed first). `source.id` is `'0.9.0'`, `reason: 'latest'`, `skipped: []`, `draft: false`.
  - `two releases with one released time go to the later one in list order` (Review Focus 3): `1.0.1` and `1.0.2` with the same `released`. `source.id` is `'1.0.2'`.
  - `no released release falls to the closed sprint with the latest end`: releases all planned, sprints `a` (end 2026-09-14), `b` (end 2026-09-28), `c` (active). `basis: 'sprint'`, `source.id: 'b'`, `reason: 'no_released_release'`, `skipped: [{ basis: 'release', reason: 'no_released_release' }]`. A tie on `end` goes to the later in list order.
  - `a tracker without releases falls to the sprint with releases_absent`: `releases: null`. `reason: 'releases_absent'`, `skipped: [{ basis: 'release', reason: 'releases_absent' }]`.
  - `with no closed sprint the period is the last windowDays days`: planned release only, sprints `[]`. `basis: 'period'`, `period: { since: '2026-10-09', until: '2026-10-23', defaulted: true }`, `reason: 'no_closed_sprint'`, `skipped` deep-equals `[{ basis: 'release', reason: 'no_released_release' }, { basis: 'sprint', reason: 'no_closed_sprint' }]`. With `sprints: null` and `releases: null` the skipped reasons are `releases_absent` and `no_closed_sprint`. `windowDays: 7` gives `since: '2026-10-16'`.
  - `the period math crosses a month and a year`: `today: '2026-01-05'`, `windowDays: 14` gives `since: '2025-12-22'`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/release-notes.test.mjs`
Expected: FAIL, every test, with `Cannot find module` for `./lib/release-notes.mjs`.

- [ ] **Step 3: Implement `chooseBasis`** in `scripts/lib/release-notes.mjs` as "The module" says. Add a header comment like the one of `metrics.mjs`: pure, no file access. Date math uses UTC milliseconds, not local time.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/release-notes.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/release-notes.mjs scripts/release-notes.test.mjs
git commit -m "feat: choose the basis of the release notes (PMK-23)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: group the done issues

**Files:**
- Modify: `scripts/lib/release-notes.mjs`
- Test: `scripts/release-notes.test.mjs`

**Interfaces:**
- Consumes: `chooseBasis` (Task 2) and `compareIds` from `scripts/lib/ids.mjs`.
- Produces: `buildNotes({ choice, candidates, types, problems })` returning the result object. Tasks 4 and 5 rely on its keys.

- [ ] **Step 1: Write the failing tests.** Helpers: `iss = (id, fields) => ({ id, title: id, description: '', type: 'task', labels: [], parent: null, archived: false, release: null, created: '2026-10-01T10:00:00Z', status: { name: 'done', category: 'done' }, ...fields })`, `cand = (issue, doneAt = null) => ({ issue, doneAt })`, `choice` taken from `chooseBasis` with a requested release, and `types = ['feature', 'bug', 'task', 'chore']`.
  - `done issues are grouped by type in the order of types, and an empty group is dropped`: a `bug`, a `feature` and another `bug`. `groups.map((g) => g.type)` is `['feature', 'bug']`, and the bug IDs are in creation order even when the input is not. `counts` is `{ done: 3, excluded: { open: 0, canceled: 0, chore: 0 } }`.
  - `an entry holds the listed fields and keeps the doneAt it was given`: one issue with `description: 'Retries now stop after 5 tries.'`, `labels: ['backend']`, `parent: 'EPC-1'`, `archived: true`, `release: '1.0.0'`, `doneAt: '2026-10-06T16:00:00Z'`. The entry deep-equals `{ id, title, description, type, labels, parent, archived, doneAt, release }` with those values.
  - `open and canceled issues are counted, never listed`: a `done`, an `in_progress`, a `todo` and a `canceled` issue. One listed, `excluded: { open: 2, canceled: 1, chore: 0 }`.
  - `a done chore is left out and counted` (question 1): a `chore` and a `task`. One listed, `excluded.chore` is 1. A `chore` that is not done counts as `open` only.
  - `a done issue reopened inside the period is not listed` (Review Focus 1): a candidate with `doneAt` set and `status.category: 'in_progress'`. It is counted in `excluded.open`.
  - `an issue with no type or an unknown type goes to a last group with type null` (Review Focus 5): types `bug`, then a missing type and an unknown `epic-ish`. The last group is `{ type: null, issues: [...] }` with both, in creation order.
  - `no done issue gives no groups` (Review Focus 4): only chores and an open issue. `groups: []`, `counts.done: 0`.
  - `the result keeps the choice fields and the problems in order`: `Object.keys(result)` is `['basis', 'reason', 'draft', 'source', 'period', 'groups', 'counts', 'skipped', 'problems']`, and `problems` is the array passed in.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/release-notes.test.mjs`
Expected: the new tests FAIL with `buildNotes is not a function`. The Task 2 tests PASS.

- [ ] **Step 3: Implement and export `buildNotes`** as "The module" says.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/release-notes.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/release-notes.mjs scripts/release-notes.test.mjs
git commit -m "feat: group the done issues of the release notes by type (PMK-23)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: the text printer

**Files:**
- Modify: `scripts/lib/format.mjs`
- Test: `scripts/release-notes.test.mjs`

**Interfaces:**
- Consumes: `buildNotes` and `chooseBasis` for test input, and `table` from `scripts/lib/format.mjs`.
- Produces: `releaseNotesText(result) -> string` exported from `scripts/lib/format.mjs`. Task 5 prints it.

- [ ] **Step 1: Write the failing tests** in `scripts/release-notes.test.mjs`, building inputs with `chooseBasis` and `buildNotes`.
  - `the first line names the basis`: a released release with a tag gives `release 1.2.0 (tag v1.2.0, released 2026-11-28)`, without a tag `release 1.2.0 (released 2026-11-28)`. A planned release with a target gives `release 1.0.0 (planned, target 2026-11-13)`. A sprint gives `sprint s1 (2026-09-28 to 2026-10-11)`. A default period gives `period 2026-10-09 to 2026-10-23 (default window)`, and a requested one has no suffix.
  - `the second line names every skipped step`: no released release, no closed sprint, window 14 gives line 2 `no released release, no closed sprint, so the notes use the last 14 days`. `releases: null` with a closed sprint gives `this tracker has no releases, so the notes use sprint s1`. A requested basis has no such line.
  - `a draft says why`: `draft: release 1.0.0 is not released yet` and `draft: sprint s2 is not closed`.
  - `each group is a table, with a Done column unless the basis is a release`: a sprint result prints `feature (1)`, then a table with header `ID | Title | Done` and the row date `2026-10-06`. A release result has the header `ID | Title`. An untyped group is headed `no type (1)`.
  - `the left out line keeps the nonzero parts`: `left out: 2 not done, 1 chore`, and no such line when all three are 0.
  - `no done issue prints no done issues` (Review Focus 4): the text has the basis line, a blank line and `no done issues`, plus the `left out:` line when it applies.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/release-notes.test.mjs`
Expected: the new tests FAIL with `releaseNotesText is not a function` (import error). The earlier tests PASS.

- [ ] **Step 3: Implement `releaseNotesText(result)`** in `scripts/lib/format.mjs` as "The text layout" says. Do not start any string literal with `pmkit `.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/release-notes.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/format.mjs scripts/release-notes.test.mjs
git commit -m "feat: print the release notes result as text (PMK-23)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: the `release-notes` CLI command

**Files:**
- Modify: `scripts/pmkit.mjs` (imports, `COMMANDS` after `release mark-released`), `scripts/lib/capabilities.mjs` (`SERVED_BY`), `scripts/goldens.test.mjs` (`CASES`), `README.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`
- Test: `scripts/cli.test.mjs`, `scripts/capabilities.test.mjs`
- Regenerate: `scripts/__goldens__/{basic,team,messy-merge,no-sprints}/release-notes.txt`

**Interfaces:**
- Consumes: `chooseBasis`, `buildNotes` (Tasks 2 and 3), `releaseNotesText` (Task 4), `releaseIssues(id, { archived })` (Task 1).
- Produces: the CLI command `release-notes`, whose JSON is the result of `buildNotes`. Task 6 calls `release-notes [--release id | --sprint id | --since d [--until d]] --json`.

- [ ] **Step 1: Write the failing tests** in `scripts/cli.test.mjs`, after the release tests. Use `makeRepo` copies and `run`/`json` helpers. `PMKIT_NOW` is already set by the helpers (2026-10-23T12:00:00Z), so check how the neighboring tests get it and do the same.
  - `release-notes without a selector uses the latest released release and lists archived done issues`: on `basic`, create release `1.2.0 --tag v1.2.0`, create three issues (`--type feature`, `--type bug`, `--type chore`), set `--release 1.2.0` on each, move each to `done`, `issues archive` the bug, then `release mark-released 1.2.0`. `--json` has `basis: 'release'`, `reason: 'latest'`, `draft: false`, groups types `['feature', 'bug']`, the archived bug listed with `archived: true`, `counts.excluded.chore: 1`. The text starts with `release 1.2.0 (tag v1.2.0, released 2026-10-23)`. (Review Focus 2.)
  - `release-notes --release on a planned release is a draft`: on `no-sprints`, `--release 1.0.0`. `draft: true`, `reason: 'requested'`, the only listed issue is `ISS-6R3N`, `counts.excluded.open` is 1 (`ISS-3M8D`), and the text has `draft: release 1.0.0 is not released yet`.
  - `release-notes falls back to the latest closed sprint`: on `team`, no selector. `basis: 'sprint'`, `source.id: '2026-09-28'`, `reason: 'no_released_release'`, every entry has a `doneAt`. Line 2 of the text is `no released release, so the notes use sprint 2026-09-28`.
  - `release-notes --sprint on an active sprint is a draft`: on `team`, `--sprint 2026-10-12`. `draft: true`.
  - `release-notes falls back to the default period and says so`: on `no-sprints`. `basis: 'period'`, `period: { since: '2026-10-09', until: '2026-10-23', defaulted: true }`, `reason: 'no_closed_sprint'`. The text has `period 2026-10-09 to 2026-10-23 (default window)` and `no released release, no closed sprint, so the notes use the last 14 days`.
  - `release-notes --since keeps a done issue and drops a reopened one` (Review Focus 1): on `team`, `--since 2026-09-01 --until 2026-10-31` lists `ISS-7K3Q`. Then `issues move ISS-7K3Q in_progress`, run again, and `ISS-7K3Q` is not listed and `counts.excluded.open` is at least 1.
  - `release-notes names an unknown release or sprint NOT_FOUND`: `--release nope` has `error.code` `NOT_FOUND` and `nextStep` `pmkit release list`. `--sprint nope` has `nextStep` `pmkit cycle list`.
  - `release-notes refuses bad selectors`: `--release 1.0.0 --sprint x`, `--release 1.0.0 --since 2026-10-01`, `--until 2026-10-01` alone, `--since 2026-10-05 --until 2026-10-01` and `--since 2026-13-01` each exit 2 with `INVALID_INPUT`. The first four have `nextStep` `pmkit release-notes --help`.
  - `release-notes puts an unreadable issue in problems and still answers` (Review Focus 5): on `team`, delete `.issues/issues/ISS-7K3Q/issue.md` and keep `events.jsonl`. `--since 2026-09-01 --until 2026-10-31 --json` exits 0, `problems` has an entry with `id: 'ISS-7K3Q'`, and `stderr` matches `/^warning: ISS-7K3Q: /m`.
  - `release-notes writes nothing and takes no write flag`: on `team` with `git init` and a commit, as `the index never reaches git status or an auto-commit` does. Run it with no selector as text and `--json`. `git status --porcelain` is `''`. `--dry-run` and `--as fred` each exit 2 with `unknown option`.
  - In `--help lists every command and exits 2`, add `'release-notes'` to the list.
  - `scripts/capabilities.test.mjs`: `release-notes serves releases and cycles`: `SERVED_BY.releases` and `SERVED_BY.cycles` both include `'release-notes'`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/cli.test.mjs scripts/capabilities.test.mjs`
Expected: the new tests FAIL with `unknown command "release-notes"` (exit 2), and the `--help` and `SERVED_BY` tests FAIL on the missing name.

- [ ] **Step 3: Implement.**
  - The `COMMANDS` entry and imports in `scripts/pmkit.mjs`, as "The CLI entry" says.
  - `SERVED_BY` in `scripts/lib/capabilities.mjs`: append `'release-notes'` to `cycles` and `releases`. The manifest keeps its path counts.
  - `CASES` in `scripts/goldens.test.mjs`, after `'release mark-released'`: `'release-notes': (a) => [[], ['--release', a.release]],`. This gives the sprint basis on `team`, the period basis on `no-sprints`, and a draft on `no-sprints`.
  - Docs, since this task adds the command: `README.md` CLI table row after `release mark-released`: ``| `release-notes [--release id \| --sprint id \| --since d [--until d]]` | the done issues of a release, a sprint or a period, grouped by type, with the basis it used; only reads |``. The same row in the CLI table of `docs/superpowers/specs/2026-10-23-pmkit-design.md`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/cli.test.mjs scripts/capabilities.test.mjs`
Expected: PASS.

- [ ] **Step 5: Generate the goldens and read them**

Run: `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, then `git status --short scripts/__goldens__`.
Expected: four new files, `scripts/__goldens__/{basic,team,messy-merge,no-sprints}/release-notes.txt`, and no modified file. Read each one:
- `basic`: the default run is the period basis with `no done issues` or its done issues, and `--release 1.0.0` exits 2 with `NOT_FOUND`.
- `team`: the sprint basis `2026-09-28`, with the line `no released release, so the notes use sprint 2026-09-28`, and a `NOT_FOUND` for `--release 1.0.0`.
- `messy-merge`: no release, an active sprint only, so the period basis, plus the CONFLICT warnings of its broken issues.
- `no-sprints`: the period basis with the two-reason line, and the draft for `--release 1.0.0` that lists `ISS-6R3N` and says `left out: 1 not done`.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/pmkit.mjs scripts/lib/capabilities.mjs scripts/goldens.test.mjs scripts/cli.test.mjs scripts/capabilities.test.mjs scripts/__goldens__ README.md docs/superpowers/specs/2026-10-23-pmkit-design.md
git commit -m "feat: add the release-notes CLI command (PMK-23)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: the `/pmkit:report:release-notes` command

**Files:**
- Create: `commands/report/release-notes.md`, `scripts/__scenarios__/report-release-notes.mjs`, `scripts/__scenarios__/_inputs/release-notes.md`
- Modify: `skills/pmkit/SKILL.md`, `README.md`, `scripts/plugin.test.mjs`, `scripts/scenarios.test.mjs`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`
- Regenerate: `scripts/__scenarios__/report-release-notes.0.after.txt`, `scripts/__scenarios__/report-release-notes.1.after.txt`

**Interfaces:**
- Consumes: `release-notes ... --json` (Task 5), `capabilities --json`, `docs create <path> --body-file <file> [--dry-run] --json`.
- Produces: the command file and its routing rows.

- [ ] **Step 1: Write the failing tests.**
  - `scripts/plugin.test.mjs`: in `COMMANDS`, `report` becomes `['status', 'release-notes']`.
  - `scripts/scenarios.test.mjs`: `there are 25 command files` becomes `there are 26 command files`, with 26 in the assertion.
  - `scripts/__scenarios__/_inputs/release-notes.md`: the notes the scenario saves. Text: a heading `# Release 1.0.0 (draft)`, a `## New` section with the bullet `Failed webhook deliveries now retry before they are dropped.`, and a final `## Included issues` section that lists `ISS-6R3N`.
  - `scripts/__scenarios__/report-release-notes.mjs`, a default export of two entries, each with `command: 'report/release-notes'`, `fixture: 'no-sprints'`, `git: true`, `notHit: {}` unless the runner says otherwise:
    - Entry 0, `prompt: '/pmkit:report:release-notes 1.0.0'`, `answers: ['Save']`. Steps: `{ step: '1', read: ['release-notes', '--release', '1.0.0'], save: 'notes' }`, `{ step: '6', read: ['capabilities'] }`, `{ step: '6', dryRun: ['docs', 'create', 'release-notes/1.0.0.md', '--body-file', body] }`, `{ confirm: 'Step 6' }`, `{ step: '6', write: ['docs', 'create', 'release-notes/1.0.0.md', '--body-file', body] }`. `expect`: `saved.notes.draft` is true, the listed IDs are `['ISS-6R3N']`, `saved.notes.counts.excluded.open` is 1, and the new document exists under `.issues/docs/release-notes/1.0.0.md` (find it with `git ls-files --others --exclude-standard`) and includes `ISS-6R3N`.
    - Entry 1, `prompt: '/pmkit:report:release-notes'`, `answers: ['Do not save']`. Steps: `{ step: '1', read: ['release-notes'], save: 'notes' }`, the same capabilities read, the dry run of `docs create release-notes/2026-10-09_2026-10-23.md`, and `{ confirm: 'Step 6' }`, with no write. `expect`: `saved.notes.basis` is `'period'`, `saved.notes.period.defaulted` is true, `saved.notes.reason` is `'no_closed_sprint'`, and `git ls-files --others --exclude-standard` is empty.
    - Calls the entries do not reach go in `skip` with a reason, keyed as `<step> <command>` (for example `1 release-notes` is hit, so only the fallback to `--sprint` needs a reason in `notHit` if the runner asks for one). Use the failure messages of rule 6 to fill `skip` and `notHit`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/plugin.test.mjs scripts/scenarios.test.mjs`
Expected: FAIL. `the commands in commands/report exist` misses `release-notes`, the skill table and README test misses `report:release-notes`, `there are 26 command files` finds 25, and rule 1 reports that `report-release-notes.mjs` names no command file.

- [ ] **Step 3: Write `commands/report/release-notes.md`** with this front matter and these sections. Keep the section order of `commands/report/status.md`.

  Front matter: `description: Write release notes for a release, a sprint or a period, and save them as a document after you confirm`, `argument-hint: "[release | sprint | since=<date>[,until=<date>]]"`, `disable-model-invocation: true`.

  Parameters: one optional argument. A release ID, a sprint ID, or `since=<date>[,until=<date>]`. An empty argument means the CLI picks the basis.

  Steps, after "Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.":
  1. Pick the selector from the argument. `since=...` is a period, so pass `--since` and `--until`. Any other value is tried as a release first, then as a sprint when the CLI answers `NOT_FOUND`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" release-notes [--release <id> | --sprint <id> | --since <date> [--until <date>]] --json`. Every later step reads this result. Compute nothing it does not hold.
  2. Lead with one line that names the basis in words. When `skipped` is not empty, say which step was skipped and why in the same line or the next, so the user sees why the notes use a sprint or a period. When `draft` is true, say the release is not released yet or the sprint is not closed, and that the notes are a draft.
  3. Write the notes from `groups`. Headings in plain words: `feature` is "New", `bug` is "Fixed", `task` and the untyped group are "Improved". One bullet per issue, one sentence, written from the title and `description` for a user of the product: what they can now do or no longer suffer, not how it was built. Add no claim the issue does not state. Merge two bullets only when their issues say the same thing. Write in the language of the issues. The bullets carry no ID.
  4. End the notes with a section "Included issues" that lists every ID of `groups`, so a reader inside the team can trace each bullet. Show the issue table (ID, title, type) in the chat too.
  5. When `counts.excluded.chore` is above zero, say "N internal changes not listed". When `counts.excluded.open` or `counts.excluded.canceled` is above zero, say how many issues the notes leave out and why. For a release, offer `release issues <id>` or `/pmkit:issues:find` to look at them. Show each entry of `problems` once as a warning.
  6. Offer to save the notes. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. When `documents` is `absent`, skip the save and offer the text to copy. Otherwise write the notes to a temporary file outside `.issues/` and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs create release-notes/<name>.md --body-file <file> --dry-run --json`, where `<name>` is the release ID, the sprint ID, or `<since>_<until>`. Show the document and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says, because readers outside the team will read it. When the user declines, save nothing. After approval, run the same command without `--dry-run`.
  7. Remove the temporary file.

  Confirmation points: `Step 6: the full document, always asked. Declining saves nothing.` Producing the notes only reads.

  Output: the notes as plain text first, then the table, the left-out lines and the path of the saved document.

  If something is missing: no done issues (say so, say no notes were written, offer another release, sprint or period, and write no empty document); `NOT_FOUND` (say so and ask for a corrected ID); `CONFLICT` from `docs create` because the path exists (ask for another name and never overwrite); an error from the CLI (apply the rules for reading errors in the conventions).

  Do not start a next step with `pmkit ` in prose unless it names a real CLI command.

- [ ] **Step 4: Add the routing rows**
  - `skills/pmkit/SKILL.md`, after the `/pmkit:report:status` row: a row with the request "write release notes, say what shipped, a changelog for customers", the command `/pmkit:report:release-notes` and the file `commands/report/release-notes.md` under the plugin root, in the format of its neighbors (this file exists from Step 3 on)
  - `README.md` "Commands" list, after `/pmkit:report:status`: ``- `/pmkit:report:release-notes`: Write release notes for a release, a sprint or a period, and save them after you confirm.``
  - `docs/superpowers/specs/2026-10-23-pmkit-design.md`, Commands table, after the `/pmkit:report:status <epic>` row: ``| `/pmkit:report:release-notes [release\|sprint\|period]` | `commands/report/release-notes.md` | `release-notes`, `capabilities`, `docs create` |``. The sentence "phase 2 adds ..." gets `and /pmkit:report:release-notes` added.

- [ ] **Step 5: Generate the snapshots and read them**

Run: `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then `git status --short scripts/__scenarios__`.
Expected: two new files, `report-release-notes.0.after.txt` and `report-release-notes.1.after.txt`. Entry 0 shows the read, the capabilities read, the dry run, the write and the new document. Entry 1 shows the read with the period basis and the dry run, and no new file. No other snapshot changes.

- [ ] **Step 6: Run the focused tests, then the whole suite**

Run: `node --test scripts/plugin.test.mjs scripts/scenarios.test.mjs`, then `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add commands/report/release-notes.md scripts/__scenarios__ scripts/plugin.test.mjs scripts/scenarios.test.mjs skills/pmkit/SKILL.md README.md docs/superpowers/specs/2026-10-23-pmkit-design.md
git commit -m "feat: add /pmkit:report:release-notes (PMK-23)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: the term

**Files:**
- Modify: `CONTEXT.md`
- Test: `scripts/plugin.test.mjs`

**Interfaces:**
- Consumes: the names of Tasks 5 and 6.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing test.** In `scripts/plugin.test.mjs`, `TERMS` gains `'Release notes'` after `'Critical path'`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/plugin.test.mjs`
Expected: `CONTEXT.md defines every term of the model` FAILS with `['Release notes']`.

- [ ] **Step 3: Write the term.** In `CONTEXT.md`, right after the **Release** entry and its _Avoid_ line:

```markdown
**Release notes**:
The done issues of a release, a sprint or a period, grouped by type and written for a user of the product. The command says which basis it used and whether the notes are a draft. `/pmkit:report:release-notes` writes them and saves them as a document after the user confirms.
_Avoid_: changelog (that is the plugin's own `CHANGELOG.md`), release (the object, not its notes)
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test scripts/plugin.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, more than 1272 tests, and `git status --short` shows only `CONTEXT.md` and the test.

- [ ] **Step 6: Commit**

```bash
git add CONTEXT.md scripts/plugin.test.mjs
git commit -m "docs: define release notes (PMK-23)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Self-review

- Spec coverage: choosing the basis (Task 2), collecting with `archived` (Tasks 1 and 5), grouping and the chore rule (Task 3), result and text (Tasks 3 and 4), the CLI and `SERVED_BY` (Task 5), the command file with the save and the "Included issues" list (Task 6), docs and the term (Tasks 1, 5, 6 and 7). The three questions are in Global Constraints and in the tasks that apply them.
- Differences from the spec text, all recorded in the spec commit fc29797 or here: the sprint read has no category filter, no fixture changes, and the two scenario entries cover the spec's entries 1 to 3 (draft and save, period and decline).
- Names match across tasks: `chooseBasis`, `buildNotes`, `releaseNotesText`, `releaseIssues(id, { archived })`, `excluded.chore`.
