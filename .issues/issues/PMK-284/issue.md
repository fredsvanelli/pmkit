---
id: PMK-284
title: "Hide a path after a backtick, a brace, a pipe or a redirect"
type: bug
status: backlog
priority: low
estimate: 1
parent: EPC-6
created: 2026-11-12T14:41:34.609Z
updated: 2026-11-12T14:41:34Z
---

## Description

### Context

PMK-277 added `[ , ; < @` to the characters a path can start after in `hideAbsolutePaths` (`scripts/lib/paths.mjs:34-35`). A path after a backtick, `{`, `|` or `>` still shows: ``x `/Users/a/r` y`` comes back as it went in. A quoted path closes only before the end of the line, a space, `:` or `)`, so `'/Users/a/r'] gone` falls to the unquoted rule and loses `] gone`. Source: PMK-277, PR #230 (review).

### Scope (in)

- A path after a backtick, `{`, `|` or `>` becomes `<path>`.
- A quote followed by `]` or `>` closes a quoted path, so the text after it shows.
- Consider a negative lookbehind (`(?<![\w.~/\\-])`) in place of the list of start characters, as the review suggested.

### Out of scope

- URLs (PMK-278 rules).

### Tasks

- [ ] Widen the start characters
- [ ] Close a quote before `]` and `>`
- [ ] Test each character, quoted and unquoted

## Acceptance criteria

- [ ] A path after a backtick, `{`, `|` or `>` is hidden, with a test
- [ ] A quoted path followed by `]` or `>` keeps the text after it, with a test
