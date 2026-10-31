---
id: PMK-187
title: Fix issues delete on archived Linear relations and a partial folder removal
type: bug
status: backlog
priority: medium
estimate: 2
related: [PMK-52]
created: 2026-10-31T16:59:10.860Z
updated: 2026-10-31T16:59:10Z
---

## Description

### Context

`issues delete` (PMK-52) merged with these defects, found by the review of PR #99. Source: PMK-52, PR #99.

### Scope (in)

- The Linear `ISSUE_FRAGMENT` does not pass `includeArchived`, so the check may not see archived children and relations. An issue with archived children could pass the check on Linear, unlike on Local. Linear sends the issue to its trash, which limits the damage.
- `scripts/lib/local/tracker.mjs:588`: `fs.rmSync(paths.dir, { recursive: true })` is not atomic. A failure halfway can leave a folder without `issue.md`, which then answers `NOT_FOUND` and cannot be deleted again. Renaming the folder first fixes it.
- The text "Only git history can bring them back" shows even with `auto_commit` off.
- The text says "1 events".
- The mention scan matches the ID inside paths and URLs, which adds noise to the preview.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] On Linear, archived children and relations block the delete as they do on Local
- [ ] A failed removal on Local leaves either the whole issue or nothing
- [ ] The preview text is right for `auto_commit` off and for one event
- [ ] Mentions inside paths and URLs are not listed
