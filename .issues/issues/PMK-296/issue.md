---
id: PMK-296
title: "Close a quoted path before a period, comma, semicolon or brace"
type: bug
status: backlog
priority: low
estimate: 1
parent: EPC-6
created: 2026-11-12T22:25:13.781Z
updated: 2026-11-12T22:25:13Z
---

## Description

### Context

A quoted path closes at its quote only when the quote is followed by the line end, a space, `:`, `)`, `]` or `>` (`QUOTED_CLOSE`, `scripts/lib/paths.mjs:37`). Followed by `.`, `,`, `;` or `}`, the path runs to the line end, so the rest of the line is lost: `'/Users/x/a'. next` gives `'<path>`, and git's `Cloning into 'file:///x/y'...` gives `Cloning into 'file:<path>`. Nothing leaks; the message loses its cause. Source: PMK-284, PR #239 (review cycle 2), and PMK-285, PR #243.

### Scope (in)

- The quote closes before `.`, `,`, `;` and `}` under the same rule as before `]` and `>`: only when what follows ends the path.
- A quote inside a name still keeps the rest hidden.

### Out of scope

- Unquoted paths, which run to the line end by design (spaces in names).

### Tasks

- [ ] Extend the closing rule with tests first
- [ ] Run the PMK-284 battery against develop

## Acceptance criteria

- [ ] `'/Users/x/a'. next` and `Cloning into 'file:///x/y'...` keep the text after the quote, with tests
- [ ] A path with a quote in its name followed by one of these characters shows no part of the path, with a test
