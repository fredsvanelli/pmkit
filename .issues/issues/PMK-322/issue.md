---
id: PMK-322
title: "Name the status the reader sees, and each fence apart, in the adr-status refusal"
type: bug
status: in_progress
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-322-name-the-status-the-reader-sees-and-each
created: 2026-11-14T20:46:32.664Z
updated: 2026-11-14T21:36:01Z
---

## Description

### Context

When `adr-status` refuses to replace the whole Status section, the refusal names the line it takes as the status and lists the rest as text to delete. Since PMK-319 that choice prefers a later line that reads as a known status after a plain first line that does not. A few names are still wrong; nothing refused, written or read changes. Checked with the CLI at bac7dc92:

- A first line that is not paragraph text but starts with a status word is taken as the status: `    Accepted` (indented code), blank, `> Proposed`, `## Context` refuses with `would delete the other text of the Status section, "> Proposed"`; the same with `[Accepted]: /u` (a link reference definition, not rendered). The reader sees `> Proposed` as the status and `Accepted` as code or nothing, so the names are swapped.
- A lazy continuation line of a quote is taken as a status line of its own: `Date: x`, blank, `> see ADR 3`, `Accepted` names `"Date: x", "> see ADR 3"`, though in CommonMark `Accepted` is part of the quote's paragraph.
- Two fences with the same opening line are named `the code fences "```", "```" take "## X", "## Y"`, which does not say which fence takes which line (`- Accepted`, blank, a fence holding `## X`, `Date: 2024-01-02`, a fence holding `## Y`, `## Context`). On the same text `adr-get` notes `the code fence "```" takes "## X", "## Y"`, one fence where the refusal counts two.

Source: PMK-319 (PR #291, review cycle 1, findings 1, 3 and 4).

### Scope (in)

- The status line the refusal names is a line of top-level paragraph text that starts a paragraph: indented code, a link reference definition and a lazy continuation line of a quote or list item are never chosen.
- Each fence in the refusal is named with the lines it takes, so two fences with the same opener read apart; the `adr-get` note counts the fences as the refusal does.

### Out of scope

- A later line glued to the first line's paragraph (`Date: 2024-01-02`, `Accepted` with no blank between): the same first-word rule as `topLevelStatus`, which decides writing too.
- What is refused, written or read: only names change.
- The HTML guard at the end of the file (its own issue).

### Tasks

- [ ] Skip indented code, link reference definitions and lazy continuation lines when `statusLineOf` picks the named status line
- [ ] Name each fence with its own lines in the refusal, and count fences the same way in the `adr-get` note

## Acceptance criteria

- [ ] `    Accepted` or `[Accepted]: /u` followed by `> Proposed`, and `Date: x`, blank, `> see ADR 3`, `Accepted`, refuse naming the status the reader sees (not the code, the definition or the lazy line) as kept and every other line as text to delete, real and dry run, with tests
- [ ] Two fences with the same opener are named each with the lines it takes, in the refusal and in the `adr-get` note, with the PMK-319 tests that count fences changed on purpose
- [ ] A develop x branch comparison on random Status bodies shows refusal, text written and `adr-get` status equal, and only names differ, each difference explained, in the PR
