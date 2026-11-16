# PMK-202: degraded and error paths of the roadmap review and risks

Source: reviews of PR #114 (PMK-66). Decisions below are the implementer's calls, taken from the code, `commands/report/roadmap-review.md` and `docs/superpowers/epc-6-orchestration/lessons.md` (rule: an unreadable value is "not checked", never an empty or clean one).

## Goals

1. A transient error (`UPSTREAM`, `RATE_LIMITED`, ...) while listing epics or milestones marks that section not checked and never shows the "no epics" late-issues fallback. Only `NOT_SUPPORTED` (the tracker has no epics) keeps the fallback.
2. An unknown delay reads `unknown` in the text, for a milestone with no due date that is unreadable or has no record.
3. A Linear epic lists every milestone of it by name.
4. `risks` and `roadmap review` report a failed update read as not checked, never as `no_recent_update`.
5. "Started" in the roadmap review follows the `epicRisks` window rule.
6. The per-epic reads stop after `RATE_LIMITED`.
7. A failing `capabilityNotes` in the `NOT_SUPPORTED` path drops the note, not the review.

## Non-goals

The improvements in `docs/superpowers/epc-6-follow-ups.md`. No change to the Local or Linear adapters.

## Design

- `scripts/lib/risks.mjs`: export `needsUpdate(epic, { today, windowDays })` (open and in progress, or started more than `windowDays` ago), used by `epicRisks` and the roadmap review so the rule lives once. In `epicRisks`, `updatesByEpic[id] === null` means the read failed: no `no_recent_update` reason. A missing key keeps meaning "no updates". New `epicsUpdatesNotChecked(epics, opts)` returns the IDs that need an update and have a `null` read.
- `runRisks` stores `null` (not `[]`) for a failed read, adds `updatesNotChecked` to the report, and `risksText` prints `not checked: <ids>` under the epics section.
- `buildRoadmapReview` takes `sectionErrors: { epics, milestones }` (the error code or `null`). The report gets `unavailable: { epics, milestones }` with `null`, `'not_supported'` or the failure code. `lateIssues` is a list only when epics are `not_supported`; for a failure it is `null`. The text says `not checked: the tracker failed to list epics (<code>), see the warnings`.
- Epic rows get `milestones: [{ id, name }]` (all milestones of the epic, by due order, name falling back to the ID); `milestone` stays the first ID for compatibility. The text column shows the names.
- Milestone delay text: `unknown` when `delayDays` is `null` and the due date is known, or the milestone is unreadable or has no record; blank only for a filed milestone with no due date or on time.
- `runRoadmapReview`: after `RATE_LIMITED` the remaining epics are not read (progress and updates `null`), with one warning naming how many; `capabilityNotes` goes through `capabilityNotesOrNone`.

## Commands and docs

`commands/report/roadmap-review.md` and `commands/team/risk-radar.md` get the new fields (`unavailable`, `milestones`, `updatesNotChecked`). CHANGELOG line under Unreleased.
