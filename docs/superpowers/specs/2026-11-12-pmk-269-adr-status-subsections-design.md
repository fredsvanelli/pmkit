# PMK-269 design: keep subsections of an ADR's Status section

Issue: PMK-269 (follow-up of PMK-263, PR #216). Small change, no questions to the user needed: the issue states the rule.

## Problem

`locate()` in `scripts/lib/adr.mjs` ends a `## Status` section at the next `#` or `##` heading. A `### Notes` subsection is therefore part of the section: `adr-get` reads `Accepted Notes more` as the status, and `adr-status` rewrites the whole section and drops the subsection.

## Decision

The section ends at the first heading of any level (`#` to `######`) outside a fenced code block. The fence rule (`fencedLines`) is unchanged, so a heading inside a code block still does not end the section. `adrInfo` and `setAdrStatus` both call `locate().end`, so one change fixes both and they cannot disagree.

- `adr-get`: the status is the text between `## Status` and the first heading.
- `adr-status`: replaces only that text; the heading and everything after it stay as they were.
- Not in scope: other status forms, setext headings.

## Tests

In `scripts/adr.test.mjs`: `adrInfo` on a section with a `### Notes` subsection (and a `####`), `setAdrStatus` keeps the subsection, the unchanged check (`done`) still holds, and a heading in a fenced block does not end the section.
