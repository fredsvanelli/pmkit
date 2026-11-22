---
id: PMK-359
title: Keep the status after an empty quote line in the adr-status refusal names
type: bug
status: backlog
priority: low
estimate: 1
parent: EPC-11
related: [PMK-329]
created: 2026-11-22T02:56:03.132Z
updated: 2026-11-22T02:56:03Z
---

## Description

### Context

Found in PMK-329 (PR #344), checked at 18042da3. A quote that opens with an empty `>` line keeps that empty line as the status in the `docs adr-status` refusal names. The list item form already keeps the text:

- `>`, `> Accepted`, blank, `> Proposed` names `"> Accepted", "> Proposed"` and keeps `>`. commonmark.js shows one quote, with `Accepted` as its first paragraph, then a second quote.
- `-`, `  Accepted`, blank, `> Proposed` names `"-", "> Proposed"` and keeps `Accepted`.

Only the names are wrong. What is refused, written or read does not change.

### Scope (in)

- In `statusLineOf` (`scripts/lib/adr.mjs`), a first line that is only a quote marker gives way to the first paragraph of that quote, as an empty list item marker does.

### Out of scope

- Any change to what is refused, written or read.

## Acceptance criteria

- [ ] `>`, `> Accepted`, blank, `> Proposed` keeps `> Accepted` and names `>` and `> Proposed`, real and dry run, with tests
- [ ] A develop x branch comparison on random Status bodies shows refusal, text written and `adr-get` status equal, with every name difference explained, and `scripts/dev/adr-commonmark-diff.mjs` exits 0 with 0 worse on the full run, in the PR
