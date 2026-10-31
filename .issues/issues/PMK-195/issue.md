---
id: PMK-195
title: "Fix inbox authors, corrupt-file fallback and stale docs"
type: bug
status: backlog
priority: medium
estimate: 2
related: [PMK-47]
created: 2026-10-31T19:29:36.439Z
updated: 2026-10-31T19:29:36Z
---

## Description

### Context

The user inbox (PMK-47) merged with these defects, found by the third and fourth reviews of PR #104. PMK-55 (inbox-digest) reads this output. Source: PMK-47, PR #104.

### Scope (in)

- `by` and `at` of every description line come from the newest description event, so a mention can show as written by whoever edited another line. PMK-55 must not trust `by` on a description item.
- An event or comment with an unreadable time falls back to the file's modified time, so `inbox list` says `complete: true` and `validate` reports nothing about the corrupt file.
- A key that no longer exists makes `mark-read --key` refuse the whole batch.
- The prune looks only at the current checkout, so an item already seen can come back after a branch switch.
- A comment without frontmatter comes out with `by: ""` instead of `null`, and a mention in a body section such as `## Notes` comes out as `in: acceptance_criteria`.
- The JSDoc of `markRead` in `scripts/lib/local/tracker.mjs:871` and the name of the test at `scripts/inbox-tracker.test.mjs:278` say the opposite of what the code does.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] A description item reports an unknown author as `null` when the line's author cannot be known
- [ ] An unreadable time is a `problem`, reported by `inbox list` and `validate`
- [ ] An unknown key is reported and the other keys are marked
- [ ] The JSDoc and the test name match the code
