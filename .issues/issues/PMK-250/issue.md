---
id: PMK-250
title: Unarchive issues on the Local tracker
type: feature
status: backlog
priority: low
estimate: 2
assignee: fred
parent: EPC-6
created: 2026-11-10T20:03:45.264Z
updated: 2026-11-10T21:22:26Z
---

## Description

### Context

PMK-226 added `archive` as a bulk change. On the Local tracker an archived issue leaves every list and every bulk change, and nothing brings it back: the only way out is editing the issue file by hand, which the tracker rules forbid. A wrong `issues bulk archive` cannot be undone. Source: PMK-226, PR #195.

### Scope (in)

- Unarchive one issue on the Local tracker, with a dry run and an event in its history.
- Unarchive as a bulk change, for issues listed with `--archived`.

### Out of scope

- Unarchive on Linear.
- Restoring deleted issues, which `issues restore` already covers.

### Tasks

- [ ] Bring one archived issue back on the Local tracker
- [ ] Bring a set of archived issues back in one bulk change
- [ ] Record the unarchive in the issue history

## Acceptance criteria

- [ ] An archived Local issue shows again in `issues list` after it is unarchived, and its history shows the unarchive
- [ ] `--dry-run` shows the change and writes nothing
- [ ] Unarchiving an issue that is not archived changes nothing and says so
- [ ] A bulk unarchive brings back every archived issue its filter matches, after the usual preview
