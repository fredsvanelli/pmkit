---
id: PMK-393
title: Read team-managed board features in the Jira manifest
type: bug
status: backlog
priority: low
estimate: 3
parent: EPC-14
related: [PMK-366]
milestone: jira
created: 2026-11-24T18:53:31.447Z
updated: 2026-11-24T18:53:36Z
---

## Description

Found live in PMK-366 on a team-managed software space. A team-managed space turns sprints, estimation and releases on per board feature (`GET /rest/agile/1.0/board/{id}/features`: `jsw.agility.sprints`, `jsw.agility.estimation`, `jsw.agility.releases`), and its one board has type `simple`, not `scrum`. The manifest does not read the features:

- `releases` reports `native` while the space's Releases feature is off, and the create screen has no `fixVersions` field, so a release write would fail.
- `cycles` is `absent` with the hint "Sprints need a Scrum board in space <key>"; on a team-managed space the fix is to turn on Sprints in the space's features. Whether the board's `type` turns `scrum` once sprints are on is unchecked; if it stays `simple`, `cycles` is absent on every team-managed space.
- `CONTEXT.md` "Scrum board" says a space without one has no sprints, which does not hold for team-managed spaces if the board stays `simple`.

Evidence: `docs/superpowers/specs/2026-11-24-pmk-366-check-jira-discovery-live-design.md`, "Team-managed features".

## Acceptance criteria

- [ ] On a team-managed space, `releases`, `cycles` and `estimation` follow the board features (an optional read that warns when refused)
- [ ] The `cycles` hint on a team-managed space names the Sprints feature, not a Scrum board
- [ ] Checked live with sprints on in a team-managed space, and `CONTEXT.md` "Scrum board" matches what was seen
