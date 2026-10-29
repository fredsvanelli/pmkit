---
id: PMK-168
title: Read estimates from a size label group in Linear
type: feature
status: backlog
priority: low
estimate: 5
related: [PMK-34]
created: 2026-10-29T02:47:10.045Z
updated: 2026-10-29T02:47:14Z
---

## Description

Linear teams that use t-shirt sizes have no numeric estimate, so pmkit reads no estimate from them today. This is "wave 4" of the EPC-5 plan. Linear can keep sizes as a label group (for example `size/S`, `size/M`), and some workspaces use that instead of the native estimate field.

Let setup offer a label group as the source of the estimate. The adapter maps each label in the group to a point value in the scale, reads it as `estimate`, and writes it back by swapping the label. The native estimate stays the default. The mapping lives under `mappings.fields.estimate` (see scripts/lib/linear/mappings.mjs:154). Confirm in the sandbox workspace which label shapes work before fixing the config format, and note that the Linear estimates page returned 404 when PMK-33 looked for the documented point values.

## Acceptance criteria

- [ ] Setup offers a size label group as an estimate source when the team has no native estimate
- [ ] `issues get` and `issues list` show the estimate read from the label group
- [ ] `issues create` and `issues update --estimate` set the matching size label and remove the old one
- [ ] The config schema documents the new `mappings.fields.estimate` value
- [ ] Tests cover read, write and a label outside the group
