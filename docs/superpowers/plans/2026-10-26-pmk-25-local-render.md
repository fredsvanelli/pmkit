# PMK-25 local render implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task, in this session. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A `render <board|roadmap|sprint>` CLI command writes a board, a roadmap or a sprint view of the tracker as Markdown or HTML, to stdout, to `--out <file>` or to `<tracker>/.cache/render/` with `--save`, and `/pmkit:local:render` turns a plain request into that one call.

**Architecture:** `scripts/lib/render.mjs` holds pure code: one function per view turns plain view data into a format-neutral document, and two writers turn a document into Markdown or HTML. `scripts/lib/render-data.mjs` reads the tracker through contract operations and returns that plain view data. `runRender(ctx)` in `scripts/pmkit.mjs` checks the arguments, picks the destination, guards overwrites with the marker line and writes one file. No contract, capability, format or template change.

**Tech Stack:** Node ESM, `node:test`, no dependencies (ADR-0003).

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-25-local-render-design.md` (commit 704c4d2, with the user's answers). Where this plan and the spec differ, the spec wins and the implementer reports the difference.

## Global Constraints

- Issue ID `PMK-25` in every commit message. Every commit ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code, specs, plans and commits in English. Prose follows the Unslop rules (`/home/fred/.claude/skills/unslop/SKILL.md`): no em dashes, plain words, sentence case headings.
- No new dependency. Do not edit `.issues/` by hand, do not push, do not switch branch. No CHANGELOG edit and no `FORMAT_VERSION` change (spec, Docs). `TRACKER_OPERATIONS`, `SERVED_BY` and the capability manifest do not change. `CONTEXT.md` and `commands/help.md` do not change: help reads the command files at run time, and the spec adds no term.
- Trap: never run the CLI with its working directory inside `scripts/__fixtures__/`. A read there writes `.issues/.cache/` into the fixture and the goldens and scenarios fail. Run it on a copy (`makeRepo`, or `cp -r scripts/__fixtures__/team/. "$(mktemp -d)"`). If it happens, delete `scripts/__fixtures__/*/.issues/.cache` before the next test run.
- Test commands: `node --test scripts/<file>.test.mjs` while working, `npm test` before each commit.
- `render` command entry: `name: 'render'`, `summary: 'renders a board, roadmap or sprint view as Markdown or HTML'`, `usage: '<board|roadmap|sprint> [--format md|html] [--sprint id|current] [--out f | --save]'`, `args: ['view']`, `flags: ['format', 'sprint', 'out', 'save']`, `dryRun: true`, no `write`. `save` joins `BOOLEANS` in `scripts/lib/args.mjs`, so `--save board` keeps `board` as the view.
- Marker line, exact: `<!-- pmkit render <view>: generated from the tracker files; the next render replaces this file -->`. Line 1 of Markdown, line 2 of HTML after `<!doctype html>`. A file counts as rendered when one of its first two lines starts with `<!-- pmkit render `.
- Determinism: no clock in the output. `\n` endings, UTF-8 without a BOM, exactly one newline at the end. Issues in the order `searchIssues` returns them (oldest created first, then id).
- Fixed text the tests pin (the spec leaves wording to the builder; these are the choices):
  - as-of line: `Tracker state as of <timestamp>`, left out when no non-archived issue was read;
  - problems line: `1 issue could not be read: ISS-3Q6T; run /pmkit:local:doctor`, plural `2 issues could not be read: A, B; run /pmkit:local:doctor`. The stderr warning is the same text after `warning: `;
  - a status or category heading: the name with `_` as a space and the first letter upper case, then the count: `In review (2)`;
  - an empty board status: `No issues`. An empty milestone: `No epics`;
  - unit totals use `estimate.unit` (`19 points`, `6 hours`). With unit `sizes`, every total leaves the unit part out, because sizes do not add up. Only numeric estimates count.

### Shared shapes

`render-data.mjs` produces these and `render.mjs` consumes them. Every string is raw tracker text; only the writers escape.

```text
IssueRow  { id, title, type, priority, assignee, estimate, blockedBy: string[], labels: string[] }
          assignee: the member's config name, else the raw id, else ''. estimate: number | string | null.
          blockedBy: only blockers not in done or canceled, or missing from the read (archived issues included in the id map).
Base      { asOf: string | null, problems: Array<{ id, code, message }>, unit: string }
BoardData Base + { statuses: Array<{ name, issues: IssueRow[] }>, done: number, canceled: number }
EpicRow   { id, title, status, start, target, done, total, points, pointsDone, health: string | null, healthDate: string | null }
RoadmapData Base + { groups: Array<{ id: string | null, name, due: string | null, filed: boolean, summary: string, issuesDone, issuesTotal, epics: EpicRow[] }>, noMilestone: EpicRow[] }
SprintData Base + { sprint: { id, name, start, end, state, goal }, totals: { issues, points, pointsDone, byCategory: Record<string, number> },
           capacity: Array<{ member, capacity: number | null, assigned, done }>, sections: Array<{ category, issues: IssueRow[] }> }
Doc       { title, lead: string[], sections: Section[], closing: string[], columns: boolean }
Section   { heading, lines: string[], table: { header: string[], rows: Cell[][] } | null, empty: string | null }
Cell      string | { text: string, tone: string }
```

## Review Focus

- An issue title with `|`, a line break, `*`, `<` or `<script>alert(1)</script>`: Markdown stays one table row with the characters escaped, HTML holds no `<script` (Task 1).
- `--out` with an absolute path outside the repository: the file is written and `path` is that absolute path with `/` separators, not a `../..` chain (Task 6).
- `--out` that names an existing folder: `INVALID_INPUT` `<path> is a folder`, nothing written (Task 6).
- A tracker with `estimate.unit: sizes`: cells show `M`, and totals show counts with no unit sum (Task 2).
- An assignee id that is not a member, and a member with an email: the row shows the id or the name, and no `@` from a member email appears anywhere (Task 2).

## File structure

- Create `scripts/lib/render.mjs` (writers, escaping, marker, the three view documents) and `scripts/render.test.mjs`.
- Create `scripts/lib/render-data.mjs` (tracker reads to view data) and `scripts/render-data.test.mjs`.
- Create `scripts/cli-render.test.mjs` for the end-to-end tests. `scripts/cli.test.mjs` is past 1000 lines, and `cli-init`, `cli-pr` and `cli-autocommit` set the precedent for a split.
- Modify `scripts/pmkit.mjs` (`COMMANDS` entry and `runRender`), `scripts/lib/args.mjs` (`BOOLEANS`), `scripts/lib/local/query-index.mjs` (`ensureCacheIgnored`), `scripts/query-index.test.mjs`.
- Modify `scripts/goldens.test.mjs` (`CASES.render`) and regenerate `scripts/__goldens__/*/render.txt`.
- Create `commands/local/render.md`, `scripts/__scenarios__/local-render.mjs` and its snapshot `local-render.after.txt`.
- Modify `scripts/scenarios.test.mjs` (24 to 25 command files, a step id check), `scripts/plugin.test.mjs` (`local: ['doctor', 'render']`), `skills/pmkit/SKILL.md`, `README.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`.

---

### Task 1: Markdown and HTML writers

Covers: criterion 2, "Writes Markdown or HTML"

**Files:**
- Create: `scripts/lib/render.mjs`, `scripts/render.test.mjs`

**Interfaces:**
- Produces: `marker(view: string): string`, `hasMarker(text: string): boolean`, `escapeMarkdown(text: string): string`, `escapeHtml(text: string): string`, `toMarkdown(doc: Doc, view: string): string`, `toHtml(doc: Doc, view: string): string`, `renderDocument(doc: Doc, view: string, format: 'md' | 'html'): string`.

- [ ] **Step 1: Write the failing tests** in `scripts/render.test.mjs`, on a hand-built `Doc` (title `Board`, lead `['Tracker state as of 2026-10-22T17:00:00Z']`, one section with a two-row table, one section with `empty: 'No issues'`, closing `['1 issue could not be read: ISS-3Q6T; run /pmkit:local:doctor']`):
  - `toMarkdown`: line 1 equals `marker('board')`; line 3 is `# Board`; a `## ` heading per section in order; a table row per issue; `No issues` under the empty section; the closing line is the last paragraph; the text ends with exactly one `\n` and holds no `\r`.
  - The escape case below passes, and a row whose title is `a|b\nc` stays one line with the same cell count as the header.

    ```js
    assert.equal(escapeMarkdown('a|b *c* _d_ [e] <f> \\ `g`\nh'), 'a\\|b \\*c\\* \\_d\\_ \\[e\\] \\<f\\> \\\\ \\`g\\` h')
    ```

  - `toHtml`: line 1 is `<!doctype html>`, line 2 equals `marker('board')`; holds `<html lang="en">`, `<meta charset="utf-8">`, `<meta name="viewport"`, `<title>Board</title>` and one `<style>`; no `<script`, no `<link`, no `http`; one trailing newline.
  - `escapeHtml('<script>alert(1)</script> & "q" \'s\'')` equals `'&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &#39;s&#39;'`; a doc whose title and a cell hold `<script>alert(1)</script>` renders with no `<script` in the output.
  - A `{ text: 'at_risk (2026-10-20)', tone: 'at_risk' }` cell: Markdown writes the text; HTML puts the tone in a class on that cell.
  - `columns: true`: HTML renders each section as a column of cards that holds every non-empty cell of its rows; Markdown output is the same as with `columns: false`.
  - `hasMarker`: true for a Markdown and an HTML render, true when the marker is line 2, false for `# Notes\n`, false when the marker is line 3, false for `''`.
- [ ] **Step 2: Run** `node --test scripts/render.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the functions in `scripts/lib/render.mjs`. The Markdown writer escapes every title, lead line, heading, cell and closing line; nothing but the marker is raw. The HTML writer sends every string through `escapeHtml`. Inline CSS only: light and dark colors through `prefers-color-scheme`, board columns that wrap on a narrow screen, and one class per health tone. The styling is the builder's call.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(render): add the Markdown and HTML writers (PMK-25)` with the trailer.

### Task 2: Board view

Covers: criterion 1, "Renders a board ... from the tracker files"

**Files:**
- Create: `scripts/lib/render-data.mjs`, `scripts/render-data.test.mjs`
- Modify: `scripts/lib/render.mjs`, `scripts/render.test.mjs`

**Interfaces:**
- Consumes: `Doc` and the writers from Task 1. `CATEGORIES`, `TERMINAL`, `compareTimes` from `scripts/lib/model.mjs`.
- Produces in `render-data.mjs`: `readTracker(tracker): { live: Issue[], byId: Map<string, Issue>, problems, asOf }` (one `searchIssues({ archived: true })`; `live` drops archived issues; `asOf` is the newest `updated` of `live` by `compareTimes`, or null), `issueRow(issue, byId, members): IssueRow`, `boardData(tracker, local): BoardData`.
- Produces in `render.mjs`: `boardDoc(data: BoardData): Doc`, `plural(n, word): string`, `statusLabel(name): string`, `problemsLine(problems): string | null`.

- [ ] **Step 1: Write the failing view tests** in `scripts/render.test.mjs`, on plain `BoardData`:
  - sections follow `data.statuses` order; a status with no issues has `empty: 'No issues'`; headings read `Backlog (2)` and `In review (1)`;
  - the lead holds the as-of line, then `7 open issues, 19 points open, done: 3, canceled: 1`; with `asOf: null` the as-of line is gone; with unit `sizes` the line is `7 open issues, done: 3, canceled: 1`;
  - columns are `ID, Title, Type, Priority, Assignee, Estimate, Notes`; Notes reads `blocked by ISS-5N1R; labels: billing, backend`, and is empty with no blocker and no label;
  - `problemsLine` gives the two fixed texts from Global Constraints and null for `[]`; the board's `closing` holds it;
  - `columns` is true.
- [ ] **Step 2: Write the failing data tests** in `scripts/render-data.test.mjs`, with `createLocalTracker(makeRepo('team'), { now: () => new Date('2026-10-23T12:00:00Z') })`:
  - `boardData` statuses are `triage, backlog, todo, in_progress, in_review`, with ids `[ISS-1V9Z]`, `[ISS-3F7H, ISS-6J0B]`, `[ISS-4M2S]`, `[ISS-2X6D, ISS-5N1R]`, `[ISS-8C4W]`; `done` 3; `canceled` 1 (archived ISS-7D8K left out); `asOf` `2026-10-22T17:00:00Z`; `problems` ids `[ISS-3Q6T]`; `unit` `points`;
  - ISS-2X6D `blockedBy` is `['ISS-5N1R']`; ISS-8C4W `blockedBy` is `[]` (its blocker ISS-7K3Q is done); ISS-2X6D `assignee` is `Ana Souza`;
  - a status `ready: { category: todo }` added at the end of `statuses` in the copy's `.issues/config.yaml` comes right after `todo` and before `in_progress` (category order first, then config order);
  - an issue edited to `assignee: ghost` shows `ghost`; `JSON.stringify(boardData(...))` holds no `@example.com`;
  - a blocker that exists only as an archived done issue does not block (edit a copy: ISS-6J0B `blocked_by: [ISS-7D8K]`, and ISS-7D8K is canceled and archived, so `blockedBy` is `[]`).
- [ ] **Step 3: Run** `node --test scripts/render.test.mjs scripts/render-data.test.mjs`. Expected: FAIL.
- [ ] **Step 4: Implement** `boardDoc` and the board data. Status order: `Object.keys(local.statuses)` stably sorted by the `CATEGORIES` index of each category, keeping only the five open categories. Member names come from `local.members`, never from `discover()`, which sorts members by id.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(render): add the board view (PMK-25)` with the trailer.

### Task 3: Roadmap view

Covers: criterion 1, "Renders ... a roadmap ... from the tracker files"

**Files:**
- Modify: `scripts/lib/render-data.mjs`, `scripts/lib/render.mjs`, `scripts/render.test.mjs`, `scripts/render-data.test.mjs`

**Interfaces:**
- Consumes: `readTracker`, `plural`, `problemsLine` (Task 2). Tracker operations `listMilestones`, `listDeliverables`, `deliverableProgress`, `listStatusUpdates`.
- Produces: `roadmapData(tracker, local): RoadmapData` and `roadmapDoc(data: RoadmapData): Doc`.

- [ ] **Step 1: Write the failing view tests** on plain `RoadmapData`:
  - a filed group with a due date has the heading `Public webhooks launch (v1.0, due 2026-11-13)`, without one `Name (v1.0)`; an unfiled group has `jira (no milestone file)`;
  - group lines: the summary when not empty, then `Issues: 2 of 5 done`; a group with no epics has `empty: 'No epics'`;
  - epic columns `ID, Title, Status, Start, Target, Progress, Health`; Progress reads `2/5 issues, 8/22 points` and `0/0 issues` when `points` is 0; Health is the cell `{ text: 'at_risk (2026-10-23)', tone: 'at_risk' }`, and `''` with no update;
  - the `No milestone` section comes last and is left out when `noMilestone` is empty; with no groups and no epics the lead ends with `No milestones or epics`;
  - `columns` is false; the same document feeds both writers (the HTML table colors the health cell through its tone class).
- [ ] **Step 2: Write the failing data tests** on a `team` copy. Set it up by writing `.issues/milestones/v1.0.md` (`name: Public webhooks launch`, `due: 2026-11-13`, body `Webhooks are open to every customer.\n\nSecond paragraph.`), adding `milestone: v1.0` to the frontmatter of `epics/EPC-2M9D/epic.md`, adding `milestone: jira` to ISS-3F7H and `milestone: v1.0` to ISS-4P8A, then `tracker.publishStatusUpdate({ epic: 'EPC-2M9D', health: 'at_risk', body: 'Late' }, 'fred')`. Expect:
  - groups `[v1.0, jira]`: v1.0 has `filed: true`, `summary` `Webhooks are open to every customer.`, `issuesDone` 1, `issuesTotal` 1, and one epic EPC-2M9D with `done` 2, `total` 5, `points` 22, `pointsDone` 8, `health` `at_risk`, `healthDate` `2026-10-23`; jira has `filed: false`, `issuesTotal` 1, no epics;
  - `noMilestone` is `[]`; on an untouched `team` copy, groups are `[]` and `noMilestone` holds EPC-2M9D;
  - a milestone name used only by an archived issue gets no group; a canceled issue does not count in `issuesTotal`.
- [ ] **Step 3: Run** `node --test scripts/render.test.mjs scripts/render-data.test.mjs`. Expected: FAIL.
- [ ] **Step 4: Implement.** Filed groups in `listMilestones()` order; unfiled names from live issues and from epics, sorted by name. `summary` is the description's first paragraph with line breaks turned into spaces. `health` is the first entry of `listStatusUpdates(id)` (newest first), with `healthDate` its `at` cut to `YYYY-MM-DD`.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(render): add the roadmap view (PMK-25)` with the trailer.

### Task 4: Sprint view

Covers: criterion 1, "Renders ... a sprint view from the tracker files"

**Files:**
- Modify: `scripts/lib/render-data.mjs`, `scripts/lib/render.mjs`, `scripts/render.test.mjs`, `scripts/render-data.test.mjs`

**Interfaces:**
- Consumes: `readTracker`, `issueRow` (Task 2), the board's issue table builder (Task 2). Tracker operations `listCycles`, `currentCycle`.
- Produces: `sprintData(tracker, local, sprint: string): SprintData` (`sprint` is `current` or an id) and `sprintDoc(data: SprintData): Doc`.

- [ ] **Step 1: Write the failing view tests** on plain `SprintData`:
  - title is the sprint name; the lead is `2026-10-12, 2026-10-12 to 2026-10-25, active`, then `Goal: <goal>` when set, then the as-of line;
  - a `Totals` section with the lines `4 issues, 17 points planned, 0 points done` and `todo 1, in_progress 2, in_review 1` (non-zero categories, category order); with unit `sizes` the first line is `4 issues`;
  - a `Capacity` section with columns `Member, Capacity, Assigned, Done`, rows in the given order, and an `Unassigned` row with an empty capacity cell; the section is left out when `capacity` is `[]`;
  - one section per category in `sections`, using the board's issue table; no section for a category with no issues.
- [ ] **Step 2: Write the failing data tests** on a `team` copy:
  - `sprintData(t, local, 'current')` is sprint `2026-10-12`, totals `issues` 4, `points` 17, `pointsDone` 0, `byCategory` todo 1, in_progress 2, in_review 1; capacity rows `[{ member: 'Fred Vanelli', capacity: 8, assigned: 4, done: 0 }, { member: 'Ana Souza', capacity: 10, assigned: 13, done: 0 }]` (config order: fred first); sections `todo, in_progress, in_review`;
  - `'2026-09-28'` renders the closed sprint with `pointsDone` 10;
  - `tracker.moveToCycle(['ISS-3F7H'], '2026-10-12', 'fred')` (no assignee, estimate 2) adds `{ member: 'Unassigned', capacity: null, assigned: 2, done: 0 }` as the last row;
  - on another copy, ISS-0G5E (canceled) hand-edited to `sprint: 2026-10-12` and `estimate: 5` raises `issues` to 5 and `byCategory.canceled` to 1, and `points` stays 17;
  - `'current'` with no active sprint (set `state: closed` in the copy's `2026-10-12.yaml`) throws `INVALID_INPUT` `there is no active sprint`, next step `pmkit cycle list`; `'nope'` throws `NOT_FOUND` `sprint nope does not exist`, next step `pmkit cycle list`.
- [ ] **Step 3: Run** `node --test scripts/render.test.mjs scripts/render-data.test.mjs`. Expected: FAIL.
- [ ] **Step 4: Implement.** Take the sprint issues from the one `readTracker` read (`issue.sprint === id`), which is what `cycleIssues(id)` returns, so the totals, the as-of line and the problems come from one read. Capacity rows: every member with a capacity entry or an assigned issue, in config order, then ids missing from the config in id order, then `Unassigned` when an unassigned issue exists. Days off do not show.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(render): add the sprint view (PMK-25)` with the trailer.

### Task 5: `render` CLI command to stdout

Covers: criteria 1 and 2 end to end (view and format from the command line)

**Files:**
- Modify: `scripts/pmkit.mjs`, `scripts/lib/args.mjs`, `scripts/goldens.test.mjs`
- Create: `scripts/cli-render.test.mjs`
- Regenerate: `scripts/__goldens__/{basic,team,messy-merge,no-sprints}/render.txt`

**Interfaces:**
- Consumes: `boardData`, `roadmapData`, `sprintData`, `boardDoc`, `roadmapDoc`, `sprintDoc`, `renderDocument`, `problemsLine`.
- Produces: `runRender(ctx)` in `pmkit.mjs`, returning `{ data, text, warnings }`. Stdout JSON: `{ view, format, path: null, content, asOf, problems }`, plus `dryRun: true` under `--dry-run`. Text: the document as it is. Task 6 extends it.

- [ ] **Step 1: Write the failing CLI tests** in `scripts/cli-render.test.mjs` (copy the `run` and `json` helpers of `cli.test.mjs`):
  - `render board` on `team` exits 0; stdout starts with the Markdown marker and holds `## In review (1)`; stderr is exactly `warning: 1 issue could not be read: ISS-3Q6T; run /pmkit:local:doctor\n`;
  - `render roadmap --format html --json` gives `view` `roadmap`, `format` `html`, `path` null, `content` starting with `<!doctype html>`, `asOf` `2026-10-22T17:00:00Z`, and `problems[0].id` `ISS-3Q6T`;
  - stdout mode writes nothing: `hashTree(root, ['.issues/.cache/index.json', '.issues/.cache/.gitignore'])` is the same before and after (a read may build the query index), and `.issues/.cache/render` does not exist;
  - `render sprint` on `team` renders sprint 2026-10-12; `render sprint --sprint 2026-09-28` renders the closed sprint; on `basic`, `render sprint --json` fails with `INVALID_INPUT` `there is no active sprint`;
  - each is `INVALID_INPUT` with exit 2: `render list` (next step `pmkit render board`), `render board --sprint current`, `render board --format pdf`, `render` with no view;
  - `--as fred` is a usage error (not a write); a `.pmkit/config.yaml` with a bad `git_host` prints the read warning and still renders;
  - determinism: on two fresh `team` copies, every view in both formats gives byte-identical stdout, ends with one `\n`, and holds no `\r`;
  - `PMKIT_NOW` set to two different dates gives the same bytes.
- [ ] **Step 2: Run** `node --test scripts/cli-render.test.mjs`. Expected: FAIL, unknown command.
- [ ] **Step 3: Implement** the `COMMANDS` entry from Global Constraints (place it before `migrate`), `save` in `BOOLEANS`, and `runRender`. Checks, in order: the view (`view must be board, roadmap or sprint, got "<v>"`, next step `pmkit render board`), `--sprint` without the sprint view (`--sprint works only with the sprint view`, next step `pmkit render sprint --sprint <id>`), `--format` not `md` or `html` (`--format must be md or html`). Gather with `ctx.tracker()` and `ctx.config().local`. Problems go to `warnings` as one `problemsLine`.
- [ ] **Step 4: Add the golden cases** to `CASES` in `scripts/goldens.test.mjs`: `render: (a) => [['board'], ['roadmap', '--format', 'html'], ['sprint'], ['sprint', '--sprint', a.sprint]]`. Regenerate with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs` and read `git diff scripts/__goldens__/`: only `render.txt` files are new, and `basic` shows the no-active-sprint error.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(cli): add the render command (PMK-25)` with the trailer, goldens included.

### Task 6: Writing files with `--out` and `--save`

Covers: criterion 2, "Writes Markdown or HTML" (to a file), and the spec's anti-goals (no overwrite of a foreign file, no tracker change, no commit)

**Files:**
- Modify: `scripts/pmkit.mjs` (`runRender`), `scripts/lib/local/query-index.mjs`, `scripts/query-index.test.mjs`, `scripts/cli-render.test.mjs`, `scripts/goldens.test.mjs`
- Regenerate: `scripts/__goldens__/*/render.txt`

**Interfaces:**
- Consumes: `hasMarker` (Task 1), `writeFileAtomic` from `scripts/lib/local/store.mjs`, `config.issuesDir` (the real tracker folder, never `readDir`).
- Produces: `ensureCacheIgnored(cacheDir: string): void` in `query-index.mjs`. It creates the folder and writes `.gitignore` with `*\n` when the file is missing or differs. `saveIndex` calls it in place of its own check. File JSON: `{ view, format, path, overwrote, asOf, problems }`, plus `dryRun: true`. Text: `wrote <path> (<view>, <format>)`, or `would write <path> (<view>, <format>)` then `dry run: nothing was written`.

- [ ] **Step 1: Write the failing unit test** in `scripts/query-index.test.mjs`: `ensureCacheIgnored` on a missing folder creates it with `.gitignore` `*\n`; on a `.gitignore` holding `index.json\n` it rewrites it; on a sound one it leaves the mtime alone.
- [ ] **Step 2: Write the failing CLI tests** in `scripts/cli-render.test.mjs`:
  - `render board --save --json` on `team` writes `.issues/.cache/render/board.md` and `.issues/.cache/.gitignore` (`*\n`); `path` is `.issues/.cache/render/board.md`, `overwrote` false; a second run gives `overwrote` true;
  - `--save --format html` writes `board.html`; `render roadmap --save` writes `roadmap.md`;
  - in a git repository of `team` with `auto_commit: true` (the `withRepo` pattern of `cli-autocommit.test.mjs`), `render board --save` leaves `git status --porcelain --untracked-files=all` empty and the commit count unchanged;
  - `--out out/views/board.html` creates both folders, writes HTML (format from the extension), and `path` is `out/views/board.html`; `--out` resolves against the working directory: run from `<root>/sub` with `--out b.md` and expect `sub/b.md`;
  - write `README.md` (`# Notes\n`) in the copy; `--out README.md` over it is `CONFLICT` `README.md exists and was not written by pmkit render`, next step `Pick another path, or delete the file first`, and the file is unchanged; a file whose line 2 is the marker is replaced;
  - each is `INVALID_INPUT` and writes nothing: `--out .issues/board.md` (next step `Use --save, or a path outside .issues/`), `--out x.md --save`, `--format md --out board.html`, `--format html --out board.md`, `--out <an existing folder>` (`<path> is a folder`);
  - `--out` with an absolute path in a temp folder outside the repository writes there, and `path` is that absolute path with `/` separators;
  - `--dry-run --save` and `--dry-run --out x.md` write nothing (`hashTree` of the whole copy equal) and print `would write ...` and `dry run: nothing was written`; `--dry-run --out README.md` still fails with `CONFLICT`;
  - on a copy set to `version: 1` in `.issues/config.yaml`, `render board --save` exits 0 and writes `.issues/.cache/render/board.md` in the real tracker folder;
  - `--save` writes no file outside `.issues/.cache/` (hash the copy without `.issues/.cache` before and after).
- [ ] **Step 3: Run** `node --test scripts/query-index.test.mjs scripts/cli-render.test.mjs`. Expected: FAIL.
- [ ] **Step 4: Implement.** Add the checks to `runRender`: `--out` with `--save` (`--out and --save cannot go together`), the format from the `--out` extension (`.html` and `.htm` give `html`, all else `md`) and its mismatch (`--format md` with `.html`/`.htm`, `--format html` with `.md`/`.markdown`), a path inside `config.issuesDir`, an existing folder. The displayed path is relative to `ctx.root` with `/`, or absolute when it falls outside the root. Before writing: an existing file without the marker is `CONFLICT`; `overwrote` is whether a file was there. Without `--dry-run`: `--save` calls `ensureCacheIgnored(<issuesDir>/.cache)` before it creates `render/`; `--out` creates the parent folders; both write with `writeFileAtomic`. The text of each refusal is in Step 2.
- [ ] **Step 5: Add the golden case** `['board', '--save']` to `CASES.render`, regenerate, read the diff (the text shows `wrote .issues/.cache/render/board.md (board, md)`, the dry runs show `would write`).
- [ ] **Step 6: Run** `npm test`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(cli): render writes to --out or --save (PMK-25)` with the trailer.

### Task 7: `/pmkit:local:render` command, scenario and docs

Covers: criteria 1 and 2 for the user (the request in plain words becomes one CLI call)

**Files:**
- Create: `commands/local/render.md`, `scripts/__scenarios__/local-render.mjs`, `scripts/__scenarios__/local-render.after.txt` (generated)
- Modify: `scripts/scenarios.test.mjs`, `scripts/plugin.test.mjs`, `skills/pmkit/SKILL.md`, `README.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`

**Interfaces:**
- Consumes: the `render` command with `--format`, `--sprint`, `--out`, `--save` (Tasks 5 and 6).

- [ ] **Step 1: Update the failing counts and checks.** `scripts/scenarios.test.mjs`: `there are 25 command files` and `assert.equal(FILES.length, 25, ...)`; in `the real files parse to the expected step ids` add `assert.ok(has('local/render.md', '3', 'render'), 'local/render.md 3 render')`. `scripts/plugin.test.mjs`: `local: ['doctor', 'render']`.
- [ ] **Step 2: Write the scenario** `scripts/__scenarios__/local-render.mjs`: `command: 'local/render'`, `fixture: 'team'`, `prompt: '/pmkit:local:render board as html'`, `answers: []`, `steps: [{ step: '3', read: ['render', 'board', '--format', 'html', '--save'], save: 'board' }]`, `skip: {}`, `notHit: {}`. `expect`: `saved.board.path` is `.issues/.cache/render/board.html`, `overwrote` false, `problems` ids `['ISS-3Q6T']`, and `repo.file('.issues/.cache/render/board.html')` starts with `<!doctype html>\n<!-- pmkit render board:`. The header comment says the snapshot shows no file change because reads and the snapshot skip `.issues/.cache`.
- [ ] **Step 3: Run** `node --test scripts/scenarios.test.mjs scripts/plugin.test.mjs`. Expected: FAIL (no command file, no snapshot).
- [ ] **Step 4: Write `commands/local/render.md`** from the spec section "/pmkit:local:render", with the frontmatter below, a `# ` title, the `Arguments:` line that `doctor.md` has, and the six sections.

  ```yaml
  description: Render a board, roadmap or sprint view of the tracker as Markdown or HTML for people outside the agent
  argument-hint: "[board|roadmap|sprint] [md|html] [sprint id] [path]"
  disable-model-invocation: true
  ```

   Steps 1 to 5 as the spec lists them, with the step 3 call written exactly `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" render <view> [--format f] [--sprint id] [--save | --out <path>] --json`. That is the only CLI call in the file, so the scenario covers every call. Step 4 says that a `--save` file stays out of git and that sharing means attaching it or rendering again with `--out` to a path the user commits. Confirmation points: `None.` with the spec's reason, and no labeled bullet. "If something is missing" names no CLI call: offer `/pmkit:cycle:plan` or a `--sprint` id for no active sprint, ask for another path on `CONFLICT`, offer `--save` for a path inside the tracker folder.
- [ ] **Step 5: Generate the snapshot** with `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs` and read `scripts/__scenarios__/local-render.after.txt`: one `$ pmkit render board --format html --save --json  [step 3, read]` row, `exit 0`, and no file change.
- [ ] **Step 6: Docs.** Add these lines as they are.

  `skills/pmkit/SKILL.md`, after the `/pmkit:local:doctor` row:

  ```markdown
  | render a board, roadmap or sprint view as Markdown or HTML to share with people outside the agent | `/pmkit:local:render` | `${CLAUDE_PLUGIN_ROOT}/commands/local/render.md` |
  ```

  `README.md`, after the `/pmkit:local:doctor` line, and in the CLI table after the `reindex` row:

  ```markdown
  - `/pmkit:local:render`: Render a board, roadmap or sprint view of the tracker as Markdown or HTML for people outside the agent.
  | `render <board\|roadmap\|sprint>` | renders a view as Markdown or HTML to stdout, to `--out f`, or with `--save` to `.issues/.cache/render/`, which git ignores; never replaces a file it did not render |
  ```

  `docs/superpowers/specs/2026-10-23-pmkit-design.md`: the first line below goes in the CLI table before `validate`, the second in the Commands table after `/pmkit:local:doctor`, and the third replaces the sentence `The MVP ships 24 command files.`

  ```markdown
  | `render <board\|roadmap\|sprint> [--format md\|html] [--sprint id\|current] [--out f \| --save]` | renders a board, roadmap or sprint view as Markdown or HTML; see the PMK-25 spec |
  | `/pmkit:local:render [view] [format]` | `commands/local/render.md` | `render` |
  The MVP ships 24 command files, and phase 2 adds `/pmkit:local:render`.
  ```
- [ ] **Step 7: Run** `npm test`. Expected: PASS, with no file left under `scripts/__fixtures__/*/.issues/.cache` (`git status --porcelain` shows only the intended files).
- [ ] **Step 8: Commit** `feat(commands): add /pmkit:local:render (PMK-25)` with the trailer.

## Acceptance criteria map

| Criterion | Tasks |
|---|---|
| Renders a board, a roadmap or a sprint view from the tracker files | Task 2 (board), Task 3 (roadmap), Task 4 (sprint view), all from contract reads in `render-data.mjs`; Task 5 (the `render` command and goldens on four fixtures); Task 7 (`/pmkit:local:render`) |
| Writes Markdown or HTML | Task 1 (both writers, escaping, marker), Task 5 (`--format` to stdout), Task 6 (`--out` and `--save` to a file) |

## Self-review

- Spec coverage: CLI arguments and output table (Tasks 5, 6); output location and git ignore (Task 6); overwrites and stale files (Tasks 1, 6); determinism (Tasks 1, 5); shared data rules (Task 2); unreadable files (Tasks 2, 5); board, roadmap, sprint view (Tasks 2 to 4); formats (Task 1); command file and routing row (Task 7); no capability or contract change (Global Constraints); docs (Task 7); tests (each task, goldens in Tasks 5 and 6, scenario in Task 7).
- One deviation, reported: the sprint view filters the single `searchIssues({ archived: true })` read in place of a second read through `cycleIssues(id)`. The issues are the same, and the totals, the as-of line and the problems then come from one read.
- Names: `readTracker`, `issueRow`, `boardData`, `roadmapData`, `sprintData`, `boardDoc`, `roadmapDoc`, `sprintDoc`, `renderDocument`, `problemsLine`, `ensureCacheIgnored` keep the same spelling in every task.
