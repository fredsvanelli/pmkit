# PMK-299 plan

1. Tests first (`scripts/adr.test.mjs`): `adrHtmlHeld` on `<!--` unclosed, `<div>`, `<custom-tag>` with `## Context` glued, closed comment (none), no section (none); `docs adr-status` refuses with `INVALID_INPUT`, next step, dry run too, file unchanged; `docs adr-get` note and `htmlHeld`; closed comment still writes.
2. `sectionEnd(lines, from, held)` records HTML continuation lines; `adrHtmlHeld(text)` in `scripts/lib/adr.mjs`.
3. `scripts/pmkit.mjs`: note in `runAdrGet`, refusal in `runAdrStatus`.
4. CHANGELOG line; run `adr-commonmark-diff.mjs`; `npm test` with Node 22; tick criteria; PR.
