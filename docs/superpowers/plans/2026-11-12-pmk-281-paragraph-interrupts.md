# PMK-281 plan

Spec: `docs/superpowers/specs/2026-11-12-pmk-281-paragraph-interrupts-design.md`. All code in `scripts/lib/adr.mjs`, tests in `scripts/adr.test.mjs`. Each task is test first.

1. Ordered start and empty item (criterion 1). Red: `Accepted\n2. foo\n===`, `Accepted\n*\n===`, `Accepted\n1.\n===` end at `Accepted` (status `Accepted 2. foo`... the section is only `Accepted`); `Accepted\n1. foo\n===` and `Accepted\n\n2. foo\n===` and `Accepted\n\n-\n===` stay open. Green: narrow `INTERRUPTS_PARAGRAPH` for the walk, wide `BLOCK_START` for the start of a block.
2. Tab-indented code (criterion 2). Red: `Accepted\n\n\tcode\nmore\n===` ends at `more`; `Accepted\n\n\tcode\n===` stays open; `Accepted\n\tcode\nmore\n===` ends at `Accepted`; ` \t` counts as 4 columns. Green: `indentColumns`, skip the code run.
3. PMK-280 review points: `- a\n\n  b\n- - -` keeps the section open as a thematic break, not an item; move the `LIST_ITEM` comment.
4. CLI test (`adr-get`, `adr-status`), CHANGELOG line, `npm test`, tick criteria, PR.
