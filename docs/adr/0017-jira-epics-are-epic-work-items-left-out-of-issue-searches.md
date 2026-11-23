# Jira epics are epic-level work items, left out of issue searches

On Jira an epic is a work item whose work type sits at hierarchy level 1, and its children name it as their `parent`. PMK-79 maps pmkit epics to those work items. Since PMK-77 every work item of the space came back from `searchIssues`, so `issues list`, `/pmkit:cycle:plan`, the flow metrics and `issues dependencies` counted epics as issues, which Local, Linear and GitHub never do. The owner settled it on 2026-11-23 in `docs/superpowers/specs/2026-11-23-pmk-79-map-jira-epics-versions-status-updates-design.md` (Interview Q2).

pmkit's epics on Jira are the space's epic-level work items, read and written through the Deliverables operations. `searchIssues` leaves them out with `issuetype not in (<epic-level work type ids>)`. `getIssue`, `updateIssue` and the relation operations still accept an epic key, so `issues parent <key> <epic>` sets a parent. An epic's status updates are comments on it that carry the `pmkit.statusUpdate` comment property.

## Status

Accepted

## Considered options

- A. Epic-level work items, out of issue searches. Chosen. An epic is counted once, as an epic, the same on every tracker.
- B. Epic-level work items, kept in issue searches. Rejected. Velocity, cycle plans and `issues list` would count an epic's points next to its children's.
- C. A separate store of epics (a label or a property on standard items). Rejected. Jira users plan with real epics, and their children already point at them.

## Consequences

- An epic never shows in `issues list` or a sprint's issues on Jira, even when someone put it in a sprint.
- A space with no epic-level work type has no epics: `deliverables` is absent in the manifest and the search adds no clause.
- Changing a work type's hierarchy level in Jira moves its items between `issues list` and `epic list`.
