# GitHub epics are linked Projects, and sprints are iterations of the status Project

PMK-88 gives the GitHub Issues adapter its sprints, epics, status updates and milestones. GitHub has no epic and no sprint as such, so each needs a home, and the choice fixes the ids that issues, configs and skills keep. The user settled it on 2026-11-16 and 2026-11-17 as decisions 1 to 4 of `docs/specs/2026-11-17-pmk-88-github-iterations-milestones-epics-design.md`.

An epic is a GitHub Project linked to the repository, other than the Project that `tracker.scope.project` names. Its id is `owner/number`. An issue belongs to an epic when it is an item of that Project, and `issue.parent` reads the parent issue first, then the epic. `epic create` runs `createProjectV2` under the repository owner, linked to the repository. A status update is a Project status update, and the epic's start and target dates are those of its latest update.

A sprint is an iteration of the iteration field that `mappings.fields.sprint` names in the status Project. Its id is the iteration's start date. `openCycle` appends an iteration on github.com and GHE.com, where GitHub keeps each iteration's identity in a replacement, and answers `NOT_SUPPORTED` on GHES, where it would not. `closeCycle` answers `NOT_SUPPORTED`, because GitHub ends an iteration on its end date.

A pmkit milestone is a repository milestone, and its id is the milestone's title. `milestone create` uses GitHub's REST API, because GraphQL has no milestone mutation.

## Status

Accepted

## Considered options

Epics:

- A. Separate linked Projects. Chosen. A Project has status updates with health and dates, which the `status_update` capability needs, and its items are issues from any repository.
- B. Repository milestones. Rejected as the main path. A milestone has no status update or health. PMK-89 may use it as a fallback for repositories without Projects.
- C. A single-select field of the status Project. Rejected. It has no status update and no description.

Sprint id:

- A. The iteration's start date. Chosen. It matches Local, where a sprint's id is its start date, and a person can type it.
- B. GitHub's iteration id. Rejected. It is an opaque string.
- C. The iteration title. Rejected. Titles are free text and need not be unique.

Opening a sprint:

- A. Native on github.com and GHE.com, refused on GHES. Chosen.
- B. Refused everywhere, as on Linear. Rejected. GitHub can append an iteration safely where the input takes an id.
- C. Native everywhere. Rejected. On GHES 3.19 to 3.21 the replacement clears the iteration of every item.

Milestone id:

- A. The title. Chosen. It reads like a Local milestone id, and titles are unique per repository.
- B. The milestone number. Rejected. `milestone create <id>` would mean something different on GitHub.

## Consequences

- Epics need the `project` scope that the status Project already needs (ADR 0007).
- An issue in two epic Projects shows the lower Project number as its parent, and `setParent` to an epic removes it from the others.
- `epic create` with dates publishes a first status update with status `INACTIVE`, and every later update carries the latest dates forward.
- Renaming an iteration does not change a sprint's id; moving its start date does.
- Renaming a milestone on GitHub changes its pmkit id, and issues show the new title.
- When GHES schemas gain the iteration `id` input, `openCycle` can lift its GHES refusal by version.
- ADR 0011 says how `epic move` writes a GitHub epic's status: a status update, or closing the Project for Closed.
