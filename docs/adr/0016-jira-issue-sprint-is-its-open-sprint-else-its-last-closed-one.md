# A Jira issue's sprint is its open sprint, else the last closed one when it is finished

A pmkit issue has one `sprint`. A Jira work item's Sprint field holds every sprint the item was ever in, closed ones included, so PMK-78 had to choose which one pmkit reports. The answer decides velocity (a done issue counts in the sprint it closed in), `--sprint none` (the backlog `/pmkit:cycle:plan` drafts from) and `cycleIssues`. The owner settled it on 2026-11-22 in `docs/superpowers/specs/2026-11-22-pmk-78-jira-sprints-design.md` (Interview Q2).

The Jira adapter reports, among the sprints of the configured Scrum board: the item's open sprint (active, else future); else, when the item's status category is `done` or `canceled`, the closed sprint with the latest `completeDate`; else no sprint.

## Status

Accepted

## Considered options

- A. Open sprint, else the last closed one for a finished item. Chosen. An unfinished item whose sprints all closed sits in Jira's backlog, and pmkit shows it there; a finished item stays in the sprint that delivered it, as on Local.
- B. Always the last sprint in the field. Rejected. A carried-over item left in the backlog after a close would read as still in the closed sprint, so `--sprint none` would miss it and `/pmkit:cycle:plan` would never offer it.
- C. Only the open sprint. Rejected. Every done issue would lose its sprint at the close, and velocity and `cycle issues` of a closed sprint would be empty.

## Consequences

- pmkit's `sprint` of a Jira issue is derived, not stored: reopening a done issue moves it from its closed sprint to no sprint.
- A sprint of another board never counts, so an item in one reads as no sprint of this board.
- Changing the rule changes velocity history for every closed sprint, so it needs a note in the changelog.
