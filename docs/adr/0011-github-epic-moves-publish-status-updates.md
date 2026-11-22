# GitHub epic moves publish status updates

PMK-353 adds `epic move`, which changes an epic's status category. A GitHub epic is a linked Project (ADR 0010), and a Project has no status field. pmkit reads an epic's status from the Project's `closed` flag (Closed, done) or from its latest status update (Inactive, backlog; On track, At risk or Off track, in_progress; Complete, done; no update, todo). A move has to write something that this read turns back into the same status. The user settled it on 2026-11-20 in `docs/superpowers/specs/2026-11-20-pmk-353-epic-move-design.md`.

A move publishes a Project status update with the status it names:

| Category | Statuses, default first | Write |
|---|---|---|
| backlog | Inactive | update `INACTIVE` |
| in_progress | On track, At risk, Off track | update `ON_TRACK`, `AT_RISK`, `OFF_TRACK` |
| done | Complete, Closed | update `COMPLETE`, or close the Project for Closed |

A move from Closed to another status reopens the Project first. A move to Closed closes it and publishes nothing. The update carries the latest start and target dates forward, as every status update does. todo, canceled, triage and in_review answer `INVALID_INPUT`: no write reads back as "No update", and a closed Project reads as done, so it can't stand for canceled.

## Status

Accepted

## Considered options

- A. Status updates, with Closed on request. Chosen. Each status reads back as itself, and moving out of done takes one more update.
- B. Done closes the Project. Rejected. Closing is the more final step, and a closed Project drops out of the views people use on GitHub.
- C. A single-select field on each epic Project. Rejected. The read path doesn't read one, so ADR 0010 and every existing epic would change.

## Consequences

- Every move adds an entry to `epic updates`, and that list is the GitHub epic's history of moves.
- A GitHub epic can never be in todo, canceled, triage or in_review through pmkit. An epic with no status update still reads as todo until its first move.
- Moving a closed Project out of done takes two writes, a reopen and then an update. When the update fails, the Project stays open and the error says so.
- `epic move <id> done` with no `--status` on a closed Project answers "already in done" rather than reopening it, because a move without `--status` refuses the epic's current category on every tracker.
