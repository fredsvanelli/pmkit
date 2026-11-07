# PMK-66: roadmap review

Status: approved by the coordinator (non-interactive run; the calls marked "my call" were taken by the implementer).

## Intent and acceptance

Provide `/pmkit:report:roadmap-review`: a read-only portfolio review showing epics and milestones with dates, health and delays, and a separate list of epics without a recent status update. It covers the three PMK-66 acceptance criteria:

1. Shows epics and milestones with dates, health and delays.
2. Lists epics with no recent status update.
3. Writes nothing.

Source: PM catalog `roadmap-review` ("Portfolio of deliverables and milestones with dates, health and delays"; degradation "Milestones and issue dates") and the Linear tab ("projects with no update").

Non-goals: forecasting (that is `/pmkit:report:status`), publishing status updates, inventing health from completion, story-point roll-ups, git-host or CI data (that is `risks`).

## Approach

CLI computation with Markdown orchestration, following ADR-0002. Composing existing reads in the command file would put date arithmetic in agent prose. `render roadmap` is Local-only and synchronous and has no lateness or freshness. So: a new read-only CLI command `roadmap review`, a pure builder in `scripts/lib/roadmap-review.mjs`, and a command file that shows the CLI result.

Reuse: `epicRisks` from `scripts/lib/risks.mjs` for the `late`, `at_risk`, `off_track` and `no_recent_update` reasons, `dayNumber` from `scripts/lib/metrics.mjs`, `table` from `scripts/lib/format.mjs`, `capabilityNotes` and `problemLine` in `scripts/pmkit.mjs`.

## Contract

`pmkit roadmap review [--json]`, no arguments, no flags, no write. `data`:

- `today`: UTC date of `ctx.now()`.
- `statusUpdateWindowDays`: `defaults.status_update_window_days` (14 by default).
- `epics`: rows, or `null` when the tracker cannot list deliverables.
- `milestones`: rows, or `null` when the tracker cannot list milestones.
- `noRecentUpdates`: IDs of epics whose updates were read and that get the `no_recent_update` reason.
- `updatesNotChecked`: IDs of open epics whose updates could not be read (error or capability absent). They are never in `noRecentUpdates`.
- `lateIssues`: only when `epics` is `null` (the degradation "issue dates"): open, non-archived issues with `due` before today, `{ id, title, status, due, milestone, delayDays }`, most late first. Otherwise `null`.
- `incomplete`: `true` when any read the report depends on was cut or failed (issues `hasMore`, issue problems, a per-epic failure, an unsupported read). The text says it in its first line.
- `problems`: `{ id, code, message }` for every skipped or failed read.

Epic row: `id`, `title`, `status`, `category`, `start`, `target`, `milestone` (Local `epic.milestone`, or the Linear milestone whose `epic` is this one; `null` otherwise), `progress` (`{ done, total, canceled }` from `deliverableProgress`, or `null` when unreadable), `lastUpdate` (`{ at, health }` or `null`), `health`, `delayDays`, `reasons`.

- `health` is the newest update's health, else `epic.health` (Linear project health), else `null`, shown as `unknown`. Never derived from completion.
- `delayDays`: whole UTC days from `target` to today when the epic is open and `target` is before today, else `0`. A missing target is `null` ("no target").
- `reasons`: from `epicRisks`, with the same rules (only in-progress or already-started epics need updates; the window boundary is inclusive; terminal epics get none). When the epic's updates were not read, `no_recent_update` is never added.

Milestone row: `id`, `name`, `due` (or `null`), `filed` (`false` for a milestone that issues or epics reference but that has no record; due unknown), `issues` (`{ open, done, canceled }` over non-archived issues, or `null` when the issue read is incomplete), `epics` (IDs), `delayDays`.

- A milestone is late when `due` is before today and it has open issues or an open epic. `delayDays` is then the days since `due`, else `0`. With a past due date and an incomplete issue read and no open epic, `delayDays` is `null` (unknown), never `0`.
- Order: the tracker's milestone order, then unfiled references in first-reference order (epics first, then issues by ID). Epics keep the tracker's order.

Text: a head line `roadmap review on <today>: status updates due every <n> days`, `incomplete: ...` when so, then three sections built like `risksText` sections: `epics (n)`, `milestones (n)`, `epics with no recent status update (n)` with a line `not checked: <ids>` when any; plus `late issues (n)` in degraded mode. A `null` section says `not checked: <reason>`.

## Reads and failure rules

Reads, all awaited: `searchIssues({ archived: true })`, `listDeliverables()`, `listMilestones()`, then per epic `deliverableProgress(id)` and `listStatusUpdates(id)`.

- The issue search failing is an error (nothing to review). Auth or configuration errors are errors.
- `listDeliverables` or `listMilestones` throwing `NOT_SUPPORTED`: that section is `null`, the capability note of `deliverables` goes into `notes`, `incomplete` is true. With no epics, `lateIssues` is computed.
- `listStatusUpdates` throwing `NOT_SUPPORTED`: every open epic is in `updatesNotChecked`, the `status_update` note goes into `notes`.
- Any other `PmkitError` on a per-epic read: that field is `null`, a problem and a warning line `<id>: <code> <message>` are added, other rows stay. A non-Pmkit error propagates.
- Every warning and note the command file tells the agent to repeat is in the JSON (`warnings`, `notes`, `problems`, `incomplete`), per the round-3 lesson.

## Command file

`commands/report/roadmap-review.md`: runs `pmkit roadmap review --json`, shows the head, the three tables and the not-checked line as the CLI gives them, repeats `notes`, `warnings` and `incomplete`, asks nothing and writes nothing, and offers `/pmkit:report:status <epic>` for an epic in the no-update list. Routed in `skills/pmkit/SKILL.md`, listed in `README.md` and `/pmkit:help`, CHANGELOG line under `## Unreleased`.

## Calls I made

- Points dropped from the epic row: `deliverableProgress.points` leaves out unestimated issues, and the round-3 lesson forbids turning an unknown estimate into zero. Issue counts suffice for the criterion.
- `updatesNotChecked` added so a failed update read is visible and never counted as stale (the `risks` command treats it as empty; this command does not).
- `lateIssues` only in degraded mode, to keep the normal review about the portfolio.
- `SERVED_BY` unchanged: `deliverables` and `status_update` are already served, so no capability path moves and ADR-0001 counts stay.
- The Local query cache under `.issues/.cache/` (git-ignored) may be refreshed by `searchIssues`, as with every read command; "writes nothing" means no tracked tracker file, user-store file or host call changes, and the tests check that.

## Validation

Pure tests: due today vs. yesterday, terminal epic, no target, no update and 14 vs. 15 days since update, update read failure kept out of `noRecentUpdates`, milestone with only done/canceled/archived issues, milestone late only by an open epic, unfiled milestone, Linear-style `milestone.epic`, incomplete issue read giving `null` counts, empty portfolio. CLI tests on the `team` fixture copied to a temp dir: JSON and text, tracked files and user store unchanged, unknown argument rejected; on the fake Linear: awaited reads and the capability-absent paths. A read-only scenario in `scripts/__scenarios__/`. Then `npm test` by the machine rule.
