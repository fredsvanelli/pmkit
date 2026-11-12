# PMK-273 design: end an ADR's Status section at every heading form

Issue: PMK-273 (follow-up of PMK-269, PR #221). Small change. The issue states the rule, so no questions to the user were needed.

## Problem

`locate().end` in `scripts/lib/adr.mjs` ends the `## Status` section at `/^#{1,6} /`. CommonMark also counts as headings: a setext heading (text underlined with `===` or `---`), an ATX heading indented by up to three spaces, an ATX heading with a tab after the `#`, and an empty ATX heading (`##` alone). None of them ends the section today, so `adr-get` reads their text as part of the status and `adr-status` rewrites it away.

## Decision

Only `end` changes. `adrInfo` (`docs adr-get`) and `setAdrStatus` (`docs adr-status`) both call `locate().end`, so one parser still serves both (PMK-263).

The section ends at the first line, outside a fenced code block and after the `## Status` line, that is either:

- an ATX heading: `^ {0,3}#{1,6}([ \t]|$)`;
- the first line of a paragraph that a setext underline closes. The underline is `^ {0,3}(=+|-+)[ \t]*$` and must directly follow a paragraph line (not a blank line, not a code line). The paragraph is the run of non-blank, non-fenced lines above the underline, and the section ends at its first line, because CommonMark makes the whole paragraph the heading.

A paragraph line that starts with `>`, a list marker or four or more spaces is not a paragraph start for this purpose (a `---` under a quote or list item is a thematic break; a `===` is a lazy continuation), so those do not end the section.

A `---` after a blank line is a thematic break and does not end the section. A `---` that closes front matter lies before the section and is never scanned.

## Tests (`scripts/adr.test.mjs`)

Table of heading forms for `adrInfo` and `setAdrStatus` (both go through the same `locate`): setext `===` and `---`, multi-line setext paragraph, indented 1 to 3 spaces, 4 spaces (not a heading), tab after `#`, empty `##`, `#hashtag` (not a heading). A thematic break after a blank line keeps the section open. `adr-get` and `adr-status` through the CLI on one file with a setext heading. `adr-status` keeps the heading and the text under it.

## Out of scope

Other status forms, the `## Status` heading itself being indented, closing `#` sequences.
