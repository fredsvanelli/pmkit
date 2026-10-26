---
id: PMK-120
title: Check .pmkit/config.yaml in loadConfig for every command
type: task
status: in_review
priority: medium
estimate: 3
assignee: fred
parent: EPC-1
related: [PMK-112]
milestone: local-gaps
branch: pmk-120-check-pmkit-config-yaml-in-loadconfig
created: 2026-10-26T17:58:03.560Z
updated: 2026-10-26T20:47:28Z
---

## Description

Found in PMK-112, approach C of its spec. `loadConfig` calls `validatePmkitConfig`, so every command refuses an invalid `.pmkit/config.yaml`, not only `validate` and `init`. This changes every command, so it needs its own decision.

## Acceptance criteria

- [ ] `loadConfig` checks `.pmkit/config.yaml` with the same rules `validate` uses, and each command reacts to an invalid file as the spec decides for its class (refuse, or warn and go on), and no command writes the tracker while the file is invalid
- [ ] `validate` still lists every `.pmkit/config.yaml` problem instead of failing, and `init --update` can still repair the file
- [ ] A refused command exits 2 with an error that names `.pmkit/config.yaml` and the bad key, and gives a next step that works (`pmkit validate` or `/pmkit:local:doctor`)
- [ ] The tracker rule and the config rules have one source shared by `loadConfig` and `validate`, tests cover each command class, and `npm test` passes
