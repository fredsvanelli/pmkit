---
id: PMK-196
title: "Fix bulk labels, single-issue errors and the commit-only failure"
type: bug
status: backlog
priority: medium
estimate: 1
related: [PMK-56]
created: 2026-10-31T19:29:36.596Z
updated: 2026-10-31T19:29:36Z
---

## Description

### Context

`issues bulk` (PMK-56) merged with these defects, found by the second and third reviews of PR #105. Source: PMK-56, PR #105.

### Scope (in)

- `commands/issues/bulk.md:35`: when every write succeeds and only `auto_commit` fails, `run()` returns `result` with `applied` and no `failed` (`scripts/pmkit.mjs:2831`), and step 7 reads it as a stop midway. The condition should be "`result.failed` is present".
- `label-add` and `label-remove` do not trim spaces, unlike the `csv()` that `issues update` uses, so `" a"` creates a new label with a space. A label that already has a comma, such as `ui, web` on Linear, cannot be removed by any pmkit command.
- On a one-issue batch, a `NOT_FOUND` from the operation becomes `INVALID_INPUT`.
- `--text " "` matches almost every issue.
- `scripts/lib/bulk.mjs:91`: for a view with no narrowing criterion, the next step says to add `--label`, but the CLI refuses `--view` with `--label`.
- `scripts/cli-bulk.test.mjs:192` sorts the IDs on both sides before comparing, so it would pass even if the view lost its `sort`.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] A failure of `auto_commit` alone is not reported as a stop midway
- [ ] Label values are trimmed, and a label with a comma can be removed
- [ ] A one-issue batch keeps the operation's error code
- [ ] `--text` with only spaces is refused, and the next step for a view with no criterion is a command the CLI accepts
