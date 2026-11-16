---
id: PMK-204
title: Fix the ranking and write rules of prioritize-by-demand
type: bug
status: done
priority: medium
estimate: 3
assignee: fred
related: [PMK-68]
branch: pmk-204-fix-the-ranking-and-write-rules-of
created: 2026-11-08T03:15:27.153Z
updated: 2026-11-09T23:43:58Z
---

## Description

### Context

Found by the reviews of PR #113 (PMK-68) and left as non-blocking. Source: PMK-68, PR #113.

### Scope (in)

- `commands/backlog/prioritize-by-demand.md:23`: the requests path counts score-0 issues in the bands, so an issue with demand can rank below an issue with none.
- `commands/backlog/prioritize-by-demand.md:21`: any `demand list` problem blocks all writes, including a `NOT_FOUND` customer or a request on a deleted issue (`scripts/lib/local/tracker.mjs:1577`) that concerns no candidate.
- `commands/backlog/prioritize-by-demand.md:22`: on a Linear team with more than 1000 issues the mentions read always has `hasMore`, so the command never writes.
- pmkit's own comments, such as plan and summary comments, count as demand mentions.
- The mention rule differs from the one `deleteIssue` uses (`scripts/lib/local/tracker.mjs:577`).
- The customer tie-break ignores `from`.
- `scripts/__scenarios__/backlog-prioritize-by-demand.mjs:83-88`, and also `:54` and `:161`: the live run stops at the first saved read, so the `ISS-6J0B` assert never runs live.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [x] Issues with no demand never rank above issues with demand
- [x] A demand problem that concerns no candidate is a warning, not a write block
- [x] pmkit's own comments do not count as demand
- [x] The live scenario checks the whole-token mention result
