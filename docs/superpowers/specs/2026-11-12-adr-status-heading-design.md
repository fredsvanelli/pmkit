# Find an indented or closed Status heading (PMK-282)

## Intent

`docs adr-get` and `docs adr-status` find the `## Status` section with `STATUS_SECTION` (`/^##\s+Status\s*$/i`), while the title, the first section and the end of the section use `headingLevel`, the ATX rule of CommonMark. So ` ## Status`, `\t`-free indentation of one to three spaces and `## Status ##` are not found as the Status section, and the ADR is read as having no status or gets a second `Status:` line.

## Design

- Keep `headingLevel` as the only test of "is this a level-N ATX heading". Add `headingText(item)`: the heading content, with the opening `#` sequence, the white space around it and the closing sequence removed. The closing sequence is a run of `#` preceded by a space or tab (or the whole content), as CommonMark says. `## Status#` is not a closing sequence.
- `section` becomes `headingLevel(item) === 2 && /^status$/i.test(headingText(item))`. `STATUS_SECTION` goes away.
- Unchanged and out of scope: fenced code (the `code` mask already skips it), four spaces of indentation (`ATX_HEADING` allows three), setext `Status` headings (PMK-283).
- `setAdrStatus` replaces only the body lines under the heading, so the heading keeps its indentation and closing sequence. No change needed beyond the finder.

## Tests

`scripts/adr.test.mjs`: `adrInfo` and `setAdrStatus` on ` ## Status`, `   ## Status`, `## Status ##`, `## Status #####`, `##\tStatus`; negatives `## Status#`, four spaces, fenced, setext; the CLI `docs adr-get` and `docs adr-status` (dry run and real). Compare `adrInfo` of develop and this branch over every ADR text in `adr.test.mjs`.
