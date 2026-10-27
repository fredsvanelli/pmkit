# PMK-25: the local-render command

Issue PMK-25, epic EPC-3, milestone `phase-2-commands`. Blocked by PMK-3 (milestones), which is done. Status: written by an agent without a dialogue. The user answered the three questions in "Answered questions" on 2026-10-26 and took the recommended option each time. The design below follows those answers.

## Problem

People outside the agent (a PM who does not run Claude Code, a stakeholder, a teammate on another tool) cannot see the Local tracker. Its state lives in `.issues/` as one file per issue, epic, sprint and milestone, and the only views are the CLI tables and what an agent says in a chat.

The planning doc names the fix. Unified model, System-specific skills: `local-render` "Generates a static board, roadmap or sprint view (markdown or HTML) for people outside the agent". The design spec's Non-goals say "No web UI. `local-render` (a static board) is a phase 2 command."

Acceptance criteria:

1. Renders a board, a roadmap or a sprint view from the tracker files.
2. Writes Markdown or HTML.

## Current state

- ADR-0002: commands never compute. A command that needs a computation the CLI lacks waits for a CLI change. So the rendering lives in the CLI, and the command file only picks the view and reports the result.
- ADR-0003: no dependencies. No template engine, no Markdown library, no HTML library.
- The tracker already has every read the three views need: `searchIssues`, `discover` (statuses in config order, members), `listCycles`, `currentCycle`, `cycleIssues`, `getCapacity`, `listDeliverables`, `deliverableProgress`, `listStatusUpdates` and `listMilestones` (PMK-3).
- No CLI command writes a file outside the tracker folder today. `docs create` writes under `<tracker>/docs/`, refuses an existing file and records nothing else. `reindex` writes only under `<tracker>/.cache/`, which git ignores twice: the template `.issues/.gitignore` holds `.cache/`, and `saveIndex` writes `.cache/.gitignore` with `*`. `clearIndex` removes only `index.json` and its temp files.
- `commands/local/` holds one command, `doctor.md`, so this one is `/pmkit:local:render` in `commands/local/render.md`.
- `scripts/goldens.test.mjs` runs every command in `COMMANDS` on every fixture, and `scripts/scenarios.test.mjs` needs a scenario module for every command file. `scripts/plugin.test.mjs` lists the command files per folder and checks the skill table and the README.

## Goals

- One CLI command renders three views from the tracker files: a board, a roadmap and a sprint view.
- Each view comes out as Markdown or as a single HTML file that opens offline in a browser.
- The same tracker files give the same bytes, so a rendered file changes only when the tracker does.
- The command never touches a file it did not render.
- `/pmkit:local:render` turns a request in plain words ("render the board as HTML") into one CLI call and reports where the file is.

## Non-goals

- A web UI, a server or a watch mode. The design spec rules them out.
- Filters on the board (by epic, assignee or label). A later issue can add `--parent` and the other `issues list` flags.
- Charts: burndown, velocity or cumulative flow. PMK-19 (`flow-metrics`) owns the numbers.
- A timeline drawing in the roadmap. The roadmap is tables only (question 3).
- Rendering for a hosted tracker. The CLI reads through contract operations, so the code would work, but the default output folder is a Local tracker folder.
- Publishing the files anywhere (GitHub Pages, a wiki, a chat).

## Anti-goals

- The command never overwrites a file that it did not render. A typo in `--out` must not replace `README.md`.
- The output never depends on the clock. A view that says "overdue" or "day 4 of 10" is wrong the next day, and a file that changes on every run without a tracker change is noise in a diff.
- No tracker file changes: no event, no drift record, no auto commit.
- No email address of a member appears in the output.

## Approaches

1. **A `render` CLI command with pure renderers.** `scripts/lib/render.mjs` turns view data into a string. The CLI command gathers the data through tracker operations, calls the renderer and prints the result or writes one file. The command file picks the view and reports.
2. **The command file writes the Markdown.** The agent reads `issues list --json` and the other reads and writes the document itself. ADR-0002 rules it out: the agent computes, two agents write two different boards, and HTML escaping lives in prose.
3. **A tracker operation per view.** `renderBoard()` and the others in the contract. Rendering is presentation, and a hosted adapter would have to carry it too. The contract stays about data.

Approach 1. It follows ADR-0002, keeps the contract as it is, and makes the renderers testable without a repository.

## Design

### CLI

```text
render <board|roadmap|sprint> [--format md|html] [--sprint id|current] [--out f | --save] [--dry-run]
```

One entry in `COMMANDS`, `name: 'render'`, `summary: 'renders a board, roadmap or sprint view as Markdown or HTML'`, `args: ['view']`, `flags: ['format', 'sprint', 'out', 'save']`, `dryRun: true`. It is not `write: true`:

- It needs no actor and takes no `--as`.
- `configClass` treats it as a read. A broken `.pmkit/config.yaml` prints the usual warning and the render goes on.
- It returns no `commit`, so `auto_commit` never commits a rendered file.
- `dryRun: true` lets it take `--dry-run`, as `init` does, and puts the dry-run cases in the goldens.

Arguments:

- `view` is required and is one of `board`, `roadmap` or `sprint`. Anything else is `INVALID_INPUT` with the next step `pmkit render board`.
- `--format` is `md` or `html`. Without it, an `--out` path that ends in `.html` or `.htm` gives `html`, and every other case gives `md`. An `--out` extension that disagrees with `--format` (`--format md --out board.html`) is `INVALID_INPUT`.
- `--sprint` is allowed only with the `sprint` view, and defaults to `current`. `current` with no active sprint throws the tracker's existing error: `INVALID_INPUT`, `there is no active sprint`, next step `pmkit cycle list`. An unknown id is the existing `NOT_FOUND` from `getSprint`. A closed or planned sprint renders like the active one.
- `--out <file>` writes the view to that file. The path resolves against the current directory, as `--body-file` does. Parent folders are created.
- `--save` writes the view to the default location (see "Output location"). `--out` and `--save` together are `INVALID_INPUT`.
- Without `--out` or `--save`, the view goes to stdout and nothing is written. `--dry-run` without a destination is allowed and changes nothing.

Output:

| Mode | Text | JSON |
|---|---|---|
| stdout | the rendered document, as it is | `{ view, format, path: null, content, asOf, problems }` |
| `--out` or `--save` | `wrote <path> (<view>, <format>)` | `{ view, format, path, overwrote, asOf, problems }` |
| with `--dry-run` | `would write <path> ...` then `dry run: nothing was written` | the same object, with `dryRun: true` |

`path` is relative to the repository root, with `/` separators. `overwrote` says whether a rendered file was there before. `problems` lists the issues that could not be read (see "Unreadable files").

### Output location

`--save` writes `<tracker>/.cache/render/<view>.<format>`, so `board.md`, `roadmap.html` or `sprint.md`. `<tracker>` is `tracker.path`, `.issues` by default. The user chose this location in question 1.

- Git ignores the folder in every tracker made by `init`: the template `.gitignore` lists `.cache/`, and `saveIndex` writes `.cache/.gitignore` with `*`. Render also writes `.cache/.gitignore` with `*` when it is missing or differs, before the first rendered file, so the folder stays ignored in a tracker set up by hand and in a repository that never built the query index. It reuses the `ignoreIsSound` check of `query-index.mjs`, exported or moved to a shared helper, the builder's call.
- `clearIndex` and `reindex` remove only `index.json` and its temp files, so they never delete a rendered file.
- On a tracker in an older format, reads come from the migrated copy (`readDir`), and `--save` still writes to the real `issuesDir`. A tracker in a newer format refuses reads, so render fails with the loader's `NOT_SUPPORTED`.
- `--out` refuses a path inside the tracker folder with `INVALID_INPUT` and the next step `Use --save, or a path outside <tracker>/`. `validate`, the query index and `docs read` walk those folders, and a stray file there turns into a problem report. `--save` is the one way to write under the tracker folder.

Sharing a rendered file means opening it, attaching it, or passing `--out` with a path the user commits. The command file says so in its output.

### Overwrites and stale files

- Every rendered document carries a marker comment: `<!-- pmkit render <view>: generated from the tracker files; the next render replaces this file -->`. It is line 1 of a Markdown file and line 2 of an HTML file, right after `<!doctype html>`.
- `--out` and `--save` replace an existing file only when its first two lines hold a line that starts with `<!-- pmkit render `. Any other existing file is `CONFLICT` with the message `<path> exists and was not written by pmkit render` and the next step `Pick another path, or delete the file first`. There is no `--force`.
- The write goes through `writeFileAtomic`, so a reader never sees half a file.
- Render writes one file per run and deletes nothing. A `board.html` from an earlier run stays until the next HTML board replaces it. Each file shows the tracker state it was made from (see "Determinism"), so a reader can tell how old it is. `--save` uses one fixed name per view and format, so the render folder holds at most six files.

### Determinism

The same tracker files give the same bytes on every machine and every day.

- No clock. The output holds no "generated at" time, no "today", no "overdue" and no "days left". The only date line is `Tracker state as of <timestamp>`, the newest `updated` among the non-archived issues the tracker read. With no issues, the line is left out.
- Fixed orders. Issues go in creation order, oldest first, then by id, as the conventions require for every issue table. Statuses follow the category order, then the order in `.issues/config.yaml`. Epics follow `listDeliverables`. Milestones follow `listMilestones` (by `due`, then id). Members follow the config order.
- Fixed text. `\n` line endings, UTF-8 without a BOM, one newline at the end of the file. Numbers print as the tracker stores them. No locale formatting.
- A test renders each view twice, on two copies of a fixture, and compares the bytes.

### Data rules shared by the views

- Archived issues never show.
- An issue is blocked when a `blockedBy` issue is not in a terminal category or is missing, as `isBlocked` in `model.mjs` decides. Render builds the id map from `searchIssues({ archived: true })`, so an archived blocker that is `done` does not count as missing. A blocked issue shows `blocked by <ids>`, listing only the open or missing blockers.
- Members show by name from the config, never by email. An assignee id that is not a member shows as the id.
- Estimates show with the unit of `estimate.unit` in totals (`13 points`, `6 hours`). An issue with no estimate shows an empty cell and adds nothing to the totals.

### Unreadable files

`searchIssues` returns `problems` for issue files it cannot read, such as a file with conflict markers. Render leaves those issues out, adds one closing line to the document (`2 issues could not be read: ISS-3Q6T, ISS-4; run /pmkit:local:doctor`), lists them in the JSON `problems`, and prints one `warning:` line on stderr. It does not fail, because a view with one missing card still helps, and the line tells the reader it is incomplete.

### Board

The board shows every non-archived issue in the five open categories, `triage`, `backlog`, `todo`, `in_progress` and `in_review`. Issues in `done` and `canceled` do not show, and the header gives their counts. The user chose this scope in question 2.

Content, in order:

1. Title `Board`, then the tracker state line.
2. A summary line: open issues, open points, and `done: N, canceled: N`.
3. One section per status of the five open categories, in the order above. The heading is the status name and its count, such as `In review (2)`. A status with no issues still shows, with `No issues`, so the columns stay the same from run to run.
4. In each section, one row per issue: ID, Title, Type, Priority, Assignee, Estimate, and Notes. Notes holds `blocked by ...` and the labels.

The Markdown board uses one `##` section and one table per status, because a Markdown table cannot hold columns of different lengths. The HTML board shows the statuses as side-by-side columns of cards. On a narrow screen the columns wrap.

### Roadmap

Content, in order:

1. Title `Roadmap`, then the tracker state line.
2. One section per milestone file, in `listMilestones` order. The heading is the milestone name, with its id and its due date when it has one. Under it go the milestone description's first paragraph, a line `Issues: <done> of <total> done` that counts the non-archived, non-canceled issues whose `milestone` is the id, and a table of the epics whose `milestone` is the id.
3. One section per milestone name that epics or issues use and that has no file (the free-text names PMK-3 allows), sorted by name, with the note `no milestone file`.
4. A last section, `No milestone`, for the epics with no milestone. It is left out when it is empty.

Epic table columns: ID, Title, Status, Start, Target, Progress and Health. Progress comes from `deliverableProgress`: `<done>/<total> issues`, and `<pointsDone>/<points> <unit>` when the epic has estimated issues. Health is the `health` of the newest status update from `listStatusUpdates`, with its date (`at_risk (2026-10-20)`), or empty when there is none. Both formats show the same tables. The HTML roadmap colors the health cell.

### Sprint view

Content, in order:

1. Title: the sprint name, then its id, `start` to `end`, its state, and its goal when it has one. Then the tracker state line.
2. Totals: issues, points planned, points done, and the number of issues per category.
3. Capacity, when the sprint has any: one row per member with the capacity, the assigned points and the points done. Members follow the config order. Unassigned points get their own row.
4. One section per category with issues in the sprint, in category order, each with the board's issue table. Categories with no issues are left out, since the totals already count them.

Data: `getSprint` through `listCycles`, `cycleIssues(id)` and `getCapacity(id)`. Days off do not show.

### Formats

`scripts/lib/render.mjs` holds the renderers. Each view has one function that builds a format-neutral document (title, lines, sections, tables), and two writers turn it into Markdown or HTML. The view functions take plain data and return a string, so the tests need no repository. Where the CLI-side data gathering lives (in `pmkit.mjs` or in a helper in `render.mjs` that takes the tracker) is the builder's call.

Markdown:

- GitHub-flavored tables. Every cell, heading and paragraph escapes `\`, `` ` ``, `*`, `_`, `[`, `]`, `<`, `>`, `|`, `~` and `&` with a backslash and turns any line break into a space, so an issue title cannot break the table, inject HTML or show an entity as a different character. A paragraph also escapes a leading `#`, `-`, `+` or `=`, and the `.` or `)` after leading digits, so tracker text cannot start a list or a heading, and it drops leading spaces so the text cannot become a code block. A heading escapes a trailing `#` run.
- No HTML other than the marker comment, and no Mermaid.

HTML:

- One file: `<!doctype html>`, the marker comment, `<html lang="en">`, `<meta charset="utf-8">`, a viewport meta tag, a `<title>`, and one inline `<style>`. No script, no external stylesheet, font or image, so the file works offline and as an email attachment.
- Every string from the tracker goes through one `escapeHtml` function that replaces `&`, `<`, `>`, `"` and `'`. A test renders an issue titled `<script>alert(1)</script>` and checks the output has no `<script`.
- Light and dark colors through `prefers-color-scheme`. The styling details are the builder's call.

### `/pmkit:local:render`

`commands/local/render.md`, with the six sections every command has. Frontmatter description: "Render a board, roadmap or sprint view of the tracker as Markdown or HTML for people outside the agent". `argument-hint: "[board|roadmap|sprint] [md|html] [sprint id] [path]"`.

Steps:

1. Read the conventions.
2. Take the view, the format, the sprint and the destination from the arguments or the request. When the view is missing, ask with `AskUserQuestion` (board, roadmap, sprint). The format defaults to `md`. The destination defaults to `--save`. A path the user names goes to `--out`. When the user asks only to see the view in the chat, run without a destination.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" render <view> [--format f] [--sprint id] [--save | --out <path>] --json`.
4. Report the `path`, whether a rendered file was replaced, the `asOf` time and any `problems` with the `/pmkit:local:doctor` next step. For a stdout render, show the Markdown `content` in the chat.
5. When the user asks for all three views, run step 3 once per view.

Confirmation points: none. Render changes no tracker file, writes only files git ignores with `--save`, and refuses to replace any file it did not render. A `--out` path the user named counts as their request.

If something is missing: no active sprint (offer `/pmkit:cycle:plan`, or `--sprint <id>` from `cycle list`), a `CONFLICT` on `--out` (ask for another path), an `--out` inside the tracker folder (offer `--save`).

The routing skill table gets a row: "render a board, roadmap or sprint view as Markdown or HTML to share with people outside the agent".

### Capability manifest and contract

No change. No operation is added to the contract, and `SERVED_BY` gains nothing. `saved_views` stays `absent`: a saved view is a stored query the tracker serves, and a rendered file is a snapshot.

### Docs

- `docs/superpowers/specs/2026-10-23-pmkit-design.md`: a `render` row in the CLI table and a `/pmkit:local:render` row in the Commands table, with the CLI calls `render`.
- `README.md`: the CLI command and the command, as the plugin test requires.
- `skills/pmkit/SKILL.md`: the routing row.
- `CONTEXT.md`: no new term. "Board", "roadmap" and "sprint view" are the views of one command and appear only there.
- `CHANGELOG.md`: no change on this branch, as with PMK-3. The release adds a line, with no `Tracker format:` line, because no tracker file changes shape.

### Tests

- `scripts/render.test.mjs`, on plain data:
  - each view in both formats: section order, columns, totals, the marker line, the as-of line and its absence with no issues;
  - Markdown escaping of `|`, `<`, `*` and line breaks in a title;
  - HTML escaping, including the `<script>` title;
  - blocked marks, member names, and no email anywhere in the output;
  - the board's empty status sections, the roadmap's unfiled milestone names and `No milestone` section;
  - the sprint view's capacity rows and an unassigned row.
- `scripts/cli.test.mjs`, end to end on fixtures:
  - stdout mode writes nothing (`hashTree` of the repository before and after);
  - `--save` writes `<tracker>/.cache/render/board.md` and `.cache/.gitignore`, and `git status --porcelain` stays empty in a git fixture;
  - `--out` creates parent folders;
  - a second render replaces its own file and reports `overwrote: true`;
  - `--out` onto a file without the marker is `CONFLICT` and leaves it unchanged;
  - `--out` inside the tracker folder, `--out` with `--save`, an unknown view, `--sprint` with `board`, and a format that disagrees with the extension are each `INVALID_INPUT`;
  - `sprint` with no active sprint gives `there is no active sprint`;
  - `--dry-run` writes nothing;
  - an unreadable issue gives the closing line, the JSON `problems` and one stderr warning;
  - `auto_commit: true` makes no commit;
  - two renders on two copies of `team` give the same bytes.
- `scripts/goldens.test.mjs`: a `render` case list, for example `['board']`, `['roadmap', '--format', 'html']`, `['sprint']`, `['sprint', '--sprint', a.sprint]` and `['board', '--save']`. Regenerate with `UPDATE_GOLDENS=1` and read the diff.
- `scripts/__scenarios__/local-render.mjs` and its snapshot, for the command file.
- `scripts/plugin.test.mjs`: `local: ['doctor', 'render']` in its `COMMANDS` map.

## Decisões

| Decision | Reason |
|---|---|
| Render in the CLI, in `scripts/lib/render.mjs`, with a command file that only picks the view | ADR-0002: commands never compute. One renderer gives every agent the same file. |
| No contract operation and no capability change | Every view reads existing operations. Rendering is presentation, and a hosted adapter should not carry it. |
| `render` is a read with `dryRun: true`, not `write: true` | It changes no tracker file, so it needs no actor, no event and no commit, and a broken `.pmkit/config.yaml` should not stop a view. |
| Stdout by default, a file with `--out` or `--save` | Stdout keeps the plain call side-effect free and lets the agent show a view in the chat. `--save` gives the command a default without knowing tracker paths, which the conventions keep out of command files. |
| Refuse to replace a file without the render marker, with no `--force` | A typo must not replace a real file (see Anti-goals). The marker is a comment, so it does not show when the file renders. |
| Refuse `--out` inside the tracker folder | `validate`, the query index and `docs read` walk it, and a stray file there turns into a problem report. |
| Render writes `.cache/.gitignore` when it is missing or differs | The folder must stay ignored in a tracker that never built the query index or that was set up by hand. |
| No clock in the output, and an as-of line from the newest issue `updated` | Same files, same bytes. The as-of line still tells a reader how old the view is. |
| Unreadable issues leave a closing line and a warning, not an error | A view with one missing card still helps, and the line says it is incomplete. |
| Members by name, never by email | The file goes to people outside the team's tooling. |
| The Markdown board has one table per status, and the HTML board has columns | A Markdown table cannot hold columns of different lengths. |
| Empty status sections show on the board, and empty category sections do not show in the sprint view | Board columns that come and go confuse a reader who compares two renders. The sprint totals already count every category. |
| One fixed file name per view and format under `--save` | The folder holds the current view, never a pile of old ones, and nothing needs deleting. |
| `--save` writes to `<tracker>/.cache/render/`, which git ignores; sharing goes through `--out` | The user's answer to question 1. Branches never conflict on generated text, and nothing stale lands in a pull request. |
| The board shows the open categories only, with done and canceled as counts | The user's answer to question 2. The board stays readable as the tracker grows, with no clock. |
| The roadmap is tables only, in both formats | The user's answer to question 3. Tables cover the criteria, and a later issue can add a drawing. |
| No CHANGELOG edit and no format bump | No tracker file changes shape. The release writes its line, as with PMK-3. |
| The heading of this section is "Decisões" | Recent specs use it at the user's request. |

## Acceptance criteria map

| Criterion | Part of the design |
|---|---|
| Renders a board, a roadmap or a sprint view from the tracker files | CLI `render <board\|roadmap\|sprint>`; sections Board, Roadmap and Sprint view; data from tracker operations only; `/pmkit:local:render` |
| Writes Markdown or HTML | `--format md\|html`, the Markdown and HTML writers in Formats, `--out` and `--save` in Output location |

## Answered questions

The user answered these on 2026-10-26. Each question keeps its options, and the chosen one is marked.

1. **Where `--save` writes, and whether git tracks the files.** This decides whether a rendered view reaches people through git or by hand. **Chosen: A.** `--save` writes to `<tracker>/.cache/render/`, which git ignores, and sharing goes through `--out`.
   - A. `<tracker>/.cache/render/`, ignored by git. Every branch can render without a merge conflict, and nothing stale lands in a pull request. People get the file by attachment, or through an `--out` path the user commits. Chosen.
   - B. A committed folder, such as `docs/pmkit/` at the repository root. Anyone who browses the repository on GitHub sees the board. Every branch that renders rewrites the same files, so two branches conflict on generated text, and the files go stale between renders.
   - C. No default. `--save` does not exist, and a file needs `--out` every time. The command asks for a path on each run.
2. **Which issues the board shows.** **Chosen: A.** The board shows the open categories only, with done and canceled as counts.
   - A. Every open issue (the five categories before `done`), with done and canceled as counts in the header. Chosen: the board stays readable as the tracker grows, and no clock is needed.
   - B. Every non-archived issue, done and canceled included. Complete, but the done columns grow forever.
   - C. The active sprint only. It overlaps with the sprint view and shows nothing outside sprints, which leaves out teams without sprints.
   - D. A plus a done column limited to the last N days. A useful view, but it depends on today's date and breaks the determinism rule.
3. **Whether the roadmap draws a timeline.** **Chosen: A.** The roadmap is tables only, in both formats.
   - A. Tables only, in both formats. Chosen: it covers the criteria, and a later issue can add a drawing.
   - B. The HTML roadmap adds CSS bars from each epic's start to its target, and the Markdown stays a table. Epics without both dates get no bar.
   - C. B, plus a Mermaid `gantt` block in the Markdown. GitHub draws it, while other Markdown viewers show the code block.

## Left to the builder

- Where the data gathering lives, and whether `ignoreIsSound` is exported from `query-index.mjs` or moved to a shared helper.
- The HTML styling, within the rules in Formats.
- The exact wording of the summary and totals lines, as long as the goldens and the tests pin it.

## Self-review

- Placeholders: none. The user answered the three questions, and the design follows the answers.
- Consistency: the marker rule, the tracker-folder refusal and the `--save` path agree in the CLI, Output location, command and test sections. Every order in Determinism matches the conventions and the existing tracker sorts.
- Scope: one CLI command, one library module, one command file, a scenario, goldens and four doc edits. No contract, capability, format or template change.
- Builder check, done by the author because this run has no reviewer. The questions a builder would ask have their answers in the sections above. Which sprint renders without `--sprint`: the active one, else the existing error. What happens to an archived done blocker: it does not block, because the id map includes archived issues. What `--save` does on an older-format tracker: it writes to `issuesDir`, not the migrated copy. Whether a rendered file can be committed: yes, through `--out`, and render replaces it on the next run because of the marker.
