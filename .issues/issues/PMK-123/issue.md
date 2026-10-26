---
id: PMK-123
title: "Carry blockers, sub-issues and criteria over to the new issue of a split"
type: task
status: in_progress
priority: low
estimate: 3
assignee: fred
parent: EPC-1
related: [PMK-113]
milestone: local-gaps
branch: pmk-123-carry-blockers-sub-issues-and-criteria
created: 2026-10-26T17:58:03.785Z
updated: 2026-10-26T22:15:07Z
---

## Description

Found in PMK-113. After a split in `/pmkit:cycle:close`, the original's open blockers, open sub-issues and unchecked criteria stay on the done original, and step 7 only lists them. Decide how to carry them over. Copying an open blocker would make `cycle:plan` skip the new issue, so plan's blocker rule needs a look too.

## Acceptance criteria

- [ ] After a split in `/pmkit:cycle:close`, the original's open blockers, open sub-issues and unchecked acceptance criteria go to the new issue as the spec decides for each kind, and the step 7 preview shows every one of those writes before it runs
- [ ] `/pmkit:cycle:plan` offers the new issue of a split that carries an open blocker, or says why it leaves it out, by the blocker rule the spec decides
- [ ] Tests fail on today's command text and pass after the change, and `npm test` passes
