---
id: PMK-326
title: Say the in-place rule in the adrHtmlHeld comment and test HTML in a container with CRLF
type: chore
status: backlog
priority: low
estimate: 1
assignee: fred
parent: EPC-6
created: 2026-11-15T00:13:35.957Z
updated: 2026-11-15T00:13:35Z
---

## Description

### Context

PMK-323 made the in-place write name an HTML block of kind 1 to 5 only when it is the top-level block still open at the end of the walk (`held.openHtml`). Two things lag behind. Checked at a9ce211c:

- The doc comment of `adrHtmlHeld` in `scripts/lib/adr.mjs` still says it names the lines that come after a blank line in a block of kind 1 to 5 that never closes, with no word on the in-place rule; only the inline comment in the body says it.
- The PMK-323 tests are all LF. The CRLF loop in `scripts/adr.test.mjs` (`a fence its container closes at ... is exempt with CRLF line ends too`) covers fences only. The CLI already does the right thing with CRLF: `Accepted`, blank, `> <!--`, `> ## X` with no final newline, `- <!--`, `  ## X` with one, and `- <script>`, `  ## X` with none are written in place with no note in `adr-get`, and a top-level `<!--`, `## X` still refuses with `would delete "## X", which the HTML block "<!--" takes into the Status section`. Nothing locks it.

Source: PMK-323 (PR #296, review cycle 1, notes 3 and 4).

### Scope (in)

- The `adrHtmlHeld` doc comment says that in place only a top-level block still open at the end of the walk is named, and that the whole-section replacement keeps naming the late lines of any block of kind 1 to 5 that never closes.
- CRLF tests for the PMK-323 cases.

### Out of scope

- Any change of behaviour: the CLI already writes these cases in place.

### Tasks

- [ ] Update the `adrHtmlHeld` doc comment
- [ ] Add CRLF variants of the PMK-323 cases and of the top-level control

## Acceptance criteria

- [ ] The `adrHtmlHeld` doc comment states the in-place rule (`held.openHtml`) and the whole-section rule
- [ ] With CRLF line ends, a status line followed by an HTML block of kind 1 to 5 in a quote, and in a list item, holding a heading-like line and open at the end of the file, with and without a final newline, has no `adrHtmlHeld` and is written in place with no note, and a top-level block of kind 1 to 5 that never closes still refuses, with tests; no other code changes
