# GitHub Issues without a Project reads statuses and types from labels

A GitHub repository can use pmkit without a Project (`tracker.scope.project: none`), and a repository can have no enabled issue type. Before PMK-89 such a repository read open as `todo` and closed as `done` or `canceled`, and no issue had a pmkit type. The user settled the fallback on 2026-11-17 in `docs/specs/2026-11-17-pmk-89-github-issues-without-a-project-design.md`, questions 1 and 2.

Statuses come from labels when there is no Project. `mappings.status.<category>` may name a repository label, written `label:<name>`. A closed issue stays `done` or `canceled` whatever its labels. An open issue takes the category of its status label, and an open issue with no status label is `todo`. An issue with several status labels reads the one furthest along triage, backlog, todo, in_progress and in_review, with a warning. `moveToCategory` adds the target's label with `addLabelsToLabelable` and removes the other status labels with `removeLabelsFromLabelable`; a move to `done` or `canceled` closes the issue first, then removes the status labels, so the history shows one move. A category with no label answers `NOT_SUPPORTED` with the next step `/pmkit:setup`. Setup asks a label for `triage`, `backlog`, `in_progress` and `in_review`; `todo`, `done` and `canceled` come from the issue's state.

Types come from labels when the repository has no enabled issue type. `mappings.types.<type>` may name a label, written the same way. A type patch swaps the type labels. A labels patch changes only the labels that hold no status and no type, and refuses a status or type label with `INVALID_INPUT`.

The fallback depends on what GitHub has, not on a separate switch. With a Project, a `label:` value in `mappings.status` is a broken mapping, and with issue types, a `label:` value in `mappings.types` is one. The mapping check answers `NOT_CONFIGURED` for both, with the next step `/pmkit:setup`.

## Status

Accepted

## Considered options

- A. Labels, written `label:<name>` in the existing mapping keys. Chosen. Labels exist in every repository, need no `project` scope, and are what Linear and the Local tracker already use for types. The prefix keeps a label apart from a Status option or issue type of the same name.
- B. Require a Project for any status beyond open and closed. Rejected. A team without Projects would keep two statuses, and the flow metrics would have no in-progress time.
- C. Issue fields for the status and the type. Rejected. Issue fields exist only on github.com, GHE.com and GHES 3.21 and later (ADR 0007), and an organization must define them, so many repositories have none.

## Consequences

- A `label:` value is a config format users write by hand. A later change cannot drop it without a migration.
- A repository that adds a Project after setup gets a broken mapping for each `label:` status value, and setup asks the Status options again. A repository that drops its Project gets its held todo, done, canceled and blocked values set to `none`.
- The history replays the status labels in timeline order. A label change at one instant counts once, and a label change while the issue is closed is no move.
- `archive` still answers `NOT_SUPPORTED` without a Project, as ADR 0008 says, with the next step to close the issue as canceled or set a Project.
- The capability manifest reports `cycles`, `capacity`, `deliverables` and `status_update` absent without a Project, and `native_triage` derived when a triage label is mapped.
