# PMK-23 design: the release-notes command

Issue PMK-23, epic EPC-3 (Phase 2 commands), milestone `phase-2-commands`. Status: approved. The user answered the three questions, recorded under "Decisions on open questions". Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

A PM or an EM who ships a version needs the list of what changed, in words a customer understands. pmkit has the pieces but no answer in one step:

- `release issues <id>` (PMK-22) lists the issues of a release, with every status.
- `cycle issues <id>` lists the issues of a sprint, with every status.
- `metrics throughput` counts what finished in a period, and holds only IDs.

Nothing picks the finished issues, groups them, or says which grouping it used. ADR-0002 says a command never computes, so the selection needs a CLI command first. The command file then writes the user-facing text, which is writing, not computing.

Sources: Unified model, PM catalog (`release-notes`: "Completed issues by release, cycle or period, in user-facing language"; degradation "Period or cycle"). Linear tab ("Optional: saves as a document").

Acceptance criteria:

1. Groups completed issues by release, sprint or period in user-facing language.
2. Without releases it uses a sprint or a period, and says so.
3. Optionally saves the notes as a document after confirmation.

## Goals

- One CLI read, `release-notes`, returns the done issues of a release, a sprint or a period, grouped by type, with the basis it used and why.
- The command file turns that result into notes a user of the product can read, and shows them.
- The command offers to save the notes as a document under `docs/` and writes it only after the user confirms.
- Without a usable release the notes use the latest closed sprint, then a period, and the first line of the output says so.
- It works on any tracker whose adapter serves the operations it reads. A tracker without `releases` still gets notes.

## Non-goals

- Editing `CHANGELOG.md`. The changelog is the plugin's own release record, and a tracker's notes are a document in the tracker.
- Creating or marking releases. `release create` and `release mark-released` do that.
- Writing to a git host or publishing to a wiki. The Local tracker saves to `docs/`. A hosted adapter maps `createDocument` to its own document store later.
- Notes for several releases or sprints in one run.
- A pull request list, deploy data or commit messages. Membership comes from the tracker, as PMK-22 decided.
- Translating the notes. The command writes in the language of the issues.

## Anti-goals

- The notes must not invent a change. Every line traces to one issue, and a line never claims more than the title and description say.
- A canceled, open or unfinished issue must not appear as shipped.
- Switching to a sprint or a period must never happen silently. The user must see the basis and the reason.
- No write without the user's confirmation. Producing notes only reads.

## Terms

- **Basis.** What the notes group by: `release`, `sprint` or `period`.
- **Done issue.** An issue whose status category is `done`. `canceled` is not done.
- **Group.** The done issues of one type, in creation order. The types come from the tracker's `types` list, in that order, followed by issues with no type.

## Approaches

1. **Compose existing commands in the command file.** Call `release list`, `release issues`, `cycle issues` and `metrics throughput`, then filter and join in Markdown. ADR-0002 forbids it. The period path needs a join of event IDs with issue records, and the archived case differs per source.
2. **A new CLI read, `release-notes`, over the contract.** One pure module picks the basis, collects the done issues and groups them. The command file only reads the result and writes prose.
3. **Extend `release issues` with a `--notes` mode.** It would mix a membership read with a fallback to sprints and periods. The command name would lie when no release exists.

Chosen: approach 2. It follows the pattern of `issues dependencies` (PMK-20), keeps every adapter on the same operations, and gives the command file one result to read.

## Design

### Choosing the basis

`release-notes [--release <id> | --sprint <id> | --since <date> [--until <date>]]`. The three selectors exclude each other. Two of them are `INVALID_INPUT` with the next step `pmkit release-notes --help`. `--until` alone is also `INVALID_INPUT`.

With no selector, the CLI tries in order and stops at the first that applies:

1. **Release.** The `releases` capability is native and `listReleases({ state: 'released' })` returns at least one release. The CLI takes the one with the latest `released` time. Ties go to the later version in list order.
2. **Sprint.** The `cycles` capability is native and the tracker has a closed sprint. The CLI takes the one with the latest `end`.
3. **Period.** The last `defaults.status_update_window_days` days (14 when the key is missing), ending today.

With a selector, the CLI uses that basis and skips the search. An unknown release or sprint is `NOT_FOUND`, with the next step `pmkit release list` or `pmkit cycle list`. `--release` accepts a planned release. The result is then marked as a draft (see "Decisions on open questions", question 2). `--sprint` accepts a sprint in any state. An open sprint is a draft too.

The result says why the basis is not a release, in `reason`:

| `reason` | Meaning |
|---|---|
| `requested` | The user passed a selector. |
| `latest` | No selector. The CLI took the latest released release, closed sprint or default period. |
| `no_released_release` | `releases` is native but no release is released. Basis is `sprint` or `period`. |
| `releases_absent` | The tracker has no `releases` capability. Basis is `sprint` or `period`. |
| `no_closed_sprint` | No closed sprint, or `cycles` is absent. Basis is `period`. |

When both steps 1 and 2 fail, `reason` names the failure of the step just before the basis used. The result also keeps the reason for skipping the release step in `skipped` as `{ basis, reason }`, so the text can say "no released release, no closed sprint, so the last 14 days". **(builder's call)** for the exact field names.

### Collecting the done issues

All three bases keep archived issues, because an old release or sprint is the usual case for notes and `/pmkit:backlog:groom` archives done work.

- **Release.** `releaseIssues(id, { archived: true })`, then keep the done ones. This needs an optional `archived` argument on the contract operation and a `--archived` flag on `release issues`, both new here (see "Decisions"). Without it, notes for an old release would miss every done issue archived later. This closes the gap PMK-22's review found.
- **Sprint.** `searchIssues({ sprint: <id>, archived: true })`, with no category filter, so the module can count the issues that are not done. `cycleIssues` stays as it is.
- **Period.** `metricEvents` and `doneInRange` (the code behind `metrics throughput`) give the IDs whose last move into done falls in the range. `getIssue` reads each one, archived included. An ID that no longer reads goes to `problems`.

For the sprint and period bases each issue carries `doneAt`, the time of its last move into done. For the release basis it is `null`, because membership, not time, defines the release.

The module drops canceled issues and counts them in `excluded.canceled`. It drops done issues of type `chore` and counts them in `excluded.chore`. `counts.done` counts the issues listed in `groups`. It counts the issues of the release or sprint that are neither done nor canceled in `excluded.open`, so the command can say "3 issues of this release are not done and are left out".

### Grouping

Groups follow the tracker's `types` order (`feature`, `bug`, `task`, `chore` in this repository), then a group with `type: null`. Inside a group, issues go in creation order, as the conventions say. An empty group does not appear.

Each issue entry holds `id`, `title`, `description` (the first section of the body, or empty), `type`, `labels`, `parent`, `archived`, `doneAt` and `release` when it has one. The command needs the description to write a line that says more than a title does. **(builder's call)** for the exact set.

### Result

JSON:

```
{
  basis: 'release' | 'sprint' | 'period',
  reason: 'requested' | 'latest' | 'no_released_release' | 'releases_absent' | 'no_closed_sprint',
  draft: boolean,
  source: { id, name, tag?, released?, target?, start?, end?, state } | null,
  period: { since, until, defaulted } | null,
  groups: [{ type, issues: [...] }],
  counts: { done, excluded: { open, canceled, chore } },
  skipped: [{ basis, reason }],
  problems: []
}
```

`source` is the release or sprint record for those bases, and `null` for a period. `period` is `null` for a release or sprint. `defaulted` is true when the dates came from the default window.

Text output: a first line with the basis, such as `release 1.2.0 (tag v1.2.0, released 2026-11-28)`, `sprint SPR-2 (2026-10-12 to 2026-10-25)` or `period 2026-10-13 to 2026-10-27 (default window)`. The next line, only when the basis is not the one asked for or the default order skipped a step, gives the reason in words. Then one table per group with ID, title and the `doneAt` date when present. `problems` print as warnings through `problemLine`.

The CLI is a read. It takes no `--dry-run` and no `--as`, and it writes nothing, not even the query index beyond what `issues list` already refreshes.

### The command file

`commands/report/release-notes.md`, user-invoked as `/pmkit:report:release-notes [release|sprint|period]`. The file does not exist yet, so this spec names it without the plugin-root prefix.

Parameters: one optional argument. A release ID, a sprint ID, or `since=<date>[,until=<date>]`. The command decides which selector to pass by asking the CLI: it tries `release get`, then `cycle list`, and treats `since=` as a period. **(builder's call)** An empty argument means no selector.

Steps:

1. Run `release-notes --json` with the selector. Every later step reads this result.
2. Lead with one line that names the basis, in words. When `reason` is not `requested` or `latest`, or `skipped` is not empty, say which step was skipped and why, in the same line or the next, as the second acceptance criterion asks. When `draft` is true, say the release is not released yet or the sprint is open.
3. Write the notes from `groups`. Each type becomes a heading in plain words (`feature` as "New", `bug` as "Fixed", `task` and untyped as "Improved"). `chore` issues are left out (question 1) and counted in one line, such as "4 internal changes not listed", read from `counts.excluded.chore`. One bullet per issue, rewritten for a user of the product from the title and description: say what the user can now do or no longer suffers, not how it was built. Keep it to one sentence. Do not add a claim the issue does not state. Merge two bullets only when their issues say the same thing, and keep every ID in the table of step 4.
4. Show a table of the included issues in creation order with the five standard columns from the conventions, so each bullet traces to its issue. Write every ID in full. The saved document holds the IDs in a final "Included issues" list (question 3), and no bullet carries an ID.
5. Say how many issues the notes leave out, from `counts.excluded`, when either count is above zero. For the release basis, offer `/pmkit:issues:find` or `release issues <id>` to look at them.
6. Offer to save the notes. When `capabilities --json` reports `documents` absent, skip this step and offer the text to copy. Otherwise write the notes to a temporary file outside `.issues/` and run `docs create release-notes/<name>.md --body-file <file> --dry-run --json`. `<name>` is the release ID, the sprint ID, or `<since>_<until>`. Show the document and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says, because the document is for readers outside the team. When the user declines, save nothing. After approval, run the same command without `--dry-run`.
7. Remove the temporary file.

Confirmation points: step 6 only, always asked. Producing the notes reads only.

If something is missing:

- No done issues: say so and that no notes were written. Offer another release, sprint or period. Do not write an empty document.
- An unknown ID (`NOT_FOUND`): say so and ask for a corrected one.
- `docs create` answers `CONFLICT` because the path exists: ask for another name. Never overwrite.
- An error from the CLI: apply the rules for reading errors in the conventions.

### Capability manifest

`SERVED_BY` adds `release-notes` to `releases` and `cycles`. Both read it as a source, so no path changes: `releases` stays native and `cycles` stays native. `capabilities.test.mjs` already checks that every `SERVED_BY` name exists in `COMMANDS`.

On a tracker without `releases`, the command still works through `reason: releases_absent`. This is the degradation the catalog names, "Period or cycle". On a tracker with `documents` absent, step 6 degrades to text.

### Docs

- `docs/superpowers/specs/2026-10-23-pmkit-design.md`: `release-notes` in the CLI table, and the `archived` option on `releaseIssues` in the Contract table.
- `README.md`: the `release-notes` row in the CLI table, `--archived` on `release issues`, and the command in the command list.
- `skills/pmkit/SKILL.md`: a routing row for "release notes", "what shipped", "changelog for customers".
- `CONTEXT.md`: a **Release notes** term. "The done issues of a release, a sprint or a period, grouped by type and written for a user of the product. The command says which basis it used." _Avoid_: changelog (that is the plugin's own `CHANGELOG.md`), release (the object, not its notes).
- `CHANGELOG.md`: no change on this branch, as PMK-3 and PMK-20 set the pattern.

## Tests per criterion

| Criterion | Tests |
|---|---|
| 1. Groups completed issues by release, sprint or period | A pure module test file, `scripts/release-notes.test.mjs`: the release basis with a done, an open and a canceled issue, with the counts in `excluded`; the sprint basis; the period basis with a done-then-reopened issue; group order by `types`; an untyped group last; creation order inside a group; archived done issues kept on all three bases; a done `chore` issue left out and counted in `excluded.chore`. A CLI test for each selector and for two selectors at once (`INVALID_INPUT`). Scenario entry 1: `/pmkit:report:release-notes 1.0.0` on `no-sprints`, where 1.0.0 is planned, so the notes are a draft, with an `expect` on the groups. |
| 2. Falls back and says so | Unit tests for every `reason`: no released release, `releases` absent, no closed sprint, default window. CLI text test that the second line names the skipped step. Scenario entry 2: `no-sprints` with no argument has no released release and no closed sprint, so the notes use a period and the snapshot says "default window". |
| 3. Optionally saves after confirmation | Scenario entry 1 continues to a `docs create ... --dry-run`, a confirm at the step 6 point, then the real write. Scenario entry 2 also declines the save and checks that `docs/` has no new file. `CONFLICT` on an existing path is the existing `createDocument` behavior, which the contract suite already checks. |
| Contract change | Tracker and contract-suite tests: `releaseIssues(id, { archived: true })` returns an archived issue that the default call leaves out, and `release issues --archived` prints it. |

Goldens: `goldens.test.mjs` requires a case for every command, so the builder adds a `release-notes` case and generates its files. No fixture changes. `team` gives the sprint basis, `no-sprints` gives the period basis, and `--release 1.0.0` on `no-sprints` gives a draft. The tests that need a released release or an archived done issue build them in a `makeRepo` copy with `release mark-released` and `issues archive`.

## Decisions

| Decision | Reason |
|---|---|
| A CLI read computes the notes input; the command file only writes prose | ADR-0002. The period path joins events with issue records, which prose must not do. |
| Default basis order is release, sprint, period | The catalog names that order for the degradation. A release is what the reader asked for by name. |
| Add `archived` to `releaseIssues` and `--archived` to `release issues` | Notes for an old release are the common case, and groom archives done work. The flag mirrors `issues list --archived`, and the default does not change, so PMK-22's behavior and goldens stay. |
| Sprint basis uses `searchIssues`, not `cycleIssues` | Same archived reason. `cycleIssues` stays unchanged, so `cycle close` and velocity keep their meaning. |
| Only `done` counts, never `canceled` | Anti-goal. A canceled issue did not ship. |
| The latest released release wins by `released` time | The version order puts a hotfix of an old line after a newer release only by name. The time says which shipped last. |
| `release-notes` takes one selector | Two selectors could name different scopes, and the basis must be one. |
| Saving is always asked | The document is for readers outside the team, and the acceptance criterion says after confirmation. |
| The path is `release-notes/<name>.md` under `docs/`, and `docs create` refuses an existing file | Reuses `createDocument`. No overwrite means a second run cannot change published notes by accident. |
| Command file in `commands/report/` | `status.md` is the other report that ends in a publishable text. |
| No `CHANGELOG.md` edit on this branch | PMK-3 and PMK-20 set the pattern. |

## Risks

- An issue in a released release that finished after the `released` time still appears. The release basis trusts membership, so a late fix shows as shipped. The text prints no per-issue date for this basis. If this bites, a later change can print `doneAt` and flag issues after `released`.
- The rewrite into user-facing language depends on the quality of titles. A title such as "refactor parser" gives a weak line. The command says what the issue states and nothing more, and the table lets the user check each bullet.
- A tracker with thousands of done issues in a period makes the period read slow. The Local tracker reads the event log and the query index. A hosted adapter can use its own date filter behind the same operation.
- `--archived` on `release issues` adds a flag to a command PMK-22 already shipped. A teammate on the older plugin never passes it, so nothing breaks.

## Decisions on open questions

The user accepted every recommendation.

1. **What happens to `chore` issues?** Chosen (a): leave them out and count them in one line, "4 internal changes not listed". Chores rarely change what a user sees, and the count keeps the omission visible. The `chore` type is matched by name. A tracker without that type has `excluded.chore` at 0.
2. **Can notes cover a release that is not released yet?** Chosen (a): yes with `--release <id>`, marked as a draft, never the default. A PM drafts notes before the date, and the draft mark stops a half-done list from passing as final.
3. **Do the issue IDs appear in the saved document?** Chosen (c): in a final "Included issues" list. The bullets stay clean for customers, and a reader inside the team can still trace each one.

## Left to the builder

- The names of the JSON fields beyond those listed, and the exact text layout, which the goldens record.
- The module's name and whether the period join lives in `metrics.mjs` or a new file.
- How `--sprint` and `--release` are told apart in the command file when the argument is a bare ID.
- The headings used for the group names in other languages.

## Self-review

- Placeholders: none. Each builder's call changes no criterion.
- Consistency: "done" means status category `done` everywhere, and archived issues are kept on every basis. The `reason` values appear with the same names in the table, the JSON and the command.
- Scope: one pure module, one CLI read, one optional argument on an existing operation, one command file, a `SERVED_BY` change, the routing row, README, `CONTEXT.md` and the design spec. No tracker file or format change.
- Builder check: read as the builder, no reviewer agent ran. Points that came up: how the archived gap is closed (decided, in "Decisions"), which release is the default (decided, by `released` time), and what the document path is (decided).
