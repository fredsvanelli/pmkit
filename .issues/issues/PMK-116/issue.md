---
id: PMK-116
title: Say there is no active sprint in issues list --sprint current
type: bug
status: done
priority: low
estimate: 1
assignee: fred
parent: EPC-1
related: [PMK-114, PMK-154]
milestone: local-gaps
branch: pmk-116-say-there-is-no-active-sprint-in-issues
created: 2026-10-26T17:58:03.226Z
updated: 2026-10-28T00:11:38Z
---

## Description

Found in PMK-114. `issues list --sprint current` with no active sprint returns an empty list and says nothing, while `issues create` and `issues update` now fail with "there is no active sprint". Tell the user why the list is empty.

## Acceptance criteria

- [ ] `issues list --sprint current` with no active sprint still exits 0 with an empty list, and tells the user there is no active sprint
- [ ] With `--json`, the same case keeps an empty `issues` list, and the reason reaches the caller through a channel an agent reads (the JSON data or the CLI's warning lines)
- [ ] With an active sprint, and with `--sprint none` or a sprint id, the output does not change
- [ ] A CLI test covers the case with and without an active sprint, and `npm test` passes
