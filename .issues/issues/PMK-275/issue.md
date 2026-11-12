---
id: PMK-275
title: Reject an empty or differently spelled --from in docs adr-get
type: bug
status: backlog
priority: low
estimate: 1
parent: EPC-6
created: 2026-11-12T02:12:43.418Z
updated: 2026-11-12T02:12:43Z
---

## Description

### Context

PMK-270 added `docs adr-get <number> --from <path>`. The review found two rough edges in the flag check (`scripts/pmkit.mjs:361-362`). Source: PMK-270, PR #224.

### Scope (in)

- `--from` with no value answers `--from "true" is not the path of an ADR...`, because the parser stores `true`. It should say the flag needs a value.
- `--from ./docs/adr/0003-x.md` (or a path with `\` on Windows) is refused with `INVALID_INPUT`, though it names the same file as `docs/adr/0003-x.md`. Normalise the path before comparing it with the ADR folders.

### Out of scope

- Other flags of `docs adr-get`.

### Tasks

- [ ] Check for a missing value
- [ ] Normalise the path before matching it

## Acceptance criteria

- [ ] `docs adr-get <n> --from` with no value answers `INVALID_INPUT` with a message that says the flag needs a path, with a test
- [ ] `--from ./docs/adr/<file>` gives the same `supersedesRef` as `--from docs/adr/<file>`, with a test
