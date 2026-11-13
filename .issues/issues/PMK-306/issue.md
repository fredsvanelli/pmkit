---
id: PMK-306
title: "Keep or refuse, never silently delete, the other text of the Status section in adr-status"
type: bug
status: backlog
priority: medium
estimate: 2
parent: EPC-6
created: 2026-11-13T21:09:10.315Z
updated: 2026-11-13T21:09:10Z
---

## Description

### Context

`adr-status` replaces the whole body of the `## Status` section with the new status. PMK-299 and PMK-302 refuse the write when an HTML block or a code fence takes a heading-looking line into the section, but any other text there is deleted without a word. Checked at 041bc521 with `setAdrStatus(text, 'deprecated')`:

- `## Status\n\nAccepted\n\nWhy this was chosen.` becomes `## Status\n\nDeprecated\n`: the explanation is gone. `before` reports `Accepted Why this was chosen.`
- `## Status\n\n```\nAccepted\n\nWhy this was chosen.` (a fence that never closes, no heading after it): the same, and `adrFenceHeld` is null, so there is no refusal.
- `## Status\n\n```\nAccepted\n\n    ## Context\n\nWhy.`: the line indented 4 spaces is not heading-looking, so it is deleted with the rest.
- With an HTML block and a fence that both take a heading into the section, the refusal names the HTML block only (`scripts/pmkit.mjs:487-490` throws on the first guard); the fence shows up only after the user fixes the HTML block and runs the command again.

`adr-get` reads the whole section as the status today (`Accepted Why this was chosen.`), so reading and writing agree; the write still deletes what the user wrote. Source: PMK-302, PR #263 (review cycles 1 and 2).

### Scope (in)

- `adr-status` never deletes text of the Status section other than the status without saying so: it either keeps that text (writing only the status) or refuses with `INVALID_INPUT` and a next step, dry run included. The design picks one and says why.
- One refusal names every cause it finds (HTML block, code fence, other text), so one fix and one run are enough.

### Out of scope

- How `adr-get` reads a Status section of one line.
- The HTML block and code fence rules of PMK-299 and PMK-302, beyond naming them in one refusal.

### Tasks

- [ ] Decide between keeping the other text and refusing, and record the choice in the spec
- [ ] Apply it to `adr-status`, real and dry run
- [ ] Gather every cause into one refusal

## Acceptance criteria

- [ ] `adr-status` on a Status section with text after the status (a plain paragraph, text after a fence that never closes, a line indented 4 spaces) deletes none of it without saying so: it keeps the text or refuses with a next step, dry run included, with tests
- [ ] `adr-status` on a Status section that holds only the status writes as before, with a test
- [ ] With an HTML block and a code fence that both take a heading into the Status section, one refusal names both, with a test
