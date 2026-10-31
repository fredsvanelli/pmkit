---
id: PMK-190
title: Fix the order and the unread records of customers and requests
type: bug
status: backlog
priority: medium
estimate: 2
related: [PMK-46]
created: 2026-10-31T16:59:11.453Z
updated: 2026-10-31T16:59:11Z
---

## Description

### Context

Customers and requests on the Local tracker (PMK-46) merged with these defects, found by the review of PR #100. The first three need a fix before PMK-68 (prioritize-by-demand) and PMK-70 (request-queue), which read the same output on both trackers. Source: PMK-46, PR #100.

### Scope (in)

- `scripts/lib/local/tracker.mjs:1157`: `customers show` sorts the requests oldest first, and Linear sorts them newest first, so a command that reads `requests[0]` as the newest is right on Linear and wrong on Local.
- `scripts/lib/local/requests.mjs:72`: the inbox order compares `created` as text, and validation accepts offsets, so `09:00:00-05:00` (14:00Z) sorts before `12:00:00Z`.
- `tracker.mjs:1225`: `requests get` drops the `problems`. An unreadable issue shows as `(unreadable)` with no warning, and the text prints `by null` when the file has `triaged` without `triaged_by`.
- `tracker.mjs:1276`: the request rewrite drops `#` comments from the frontmatter, the same limit as `epic goal`.
- `scripts/lib/validate.mjs:379`: `validate` does not report a reference to a customer whose file does not parse.
- `tracker.mjs:1145`: `customers show <name>` skips customers with a broken file. `requests list --customer` takes any text and answers empty with exit 0.
- `scripts/lib/linear/manifest.mjs:73`: the `unsupported` list of `demand_signals` lacks `createRequest`.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] `customers show` sorts requests as Linear does
- [ ] The inbox sorts by instant, not by text
- [ ] `requests get` returns `problems` and never prints `by null`
- [ ] `validate` reports a reference to an unreadable customer, and `requests list --customer` refuses an unknown customer
- [ ] The Linear manifest lists every unsupported request operation
