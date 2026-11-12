# PMK-294 plan

1. Test first (`scripts/adr.test.mjs`): `adrStatusHeading` on `---` and `===` gives `Accepted`; gives `null` for a list item + `---`, a quote, a thematic break, a filled section, an empty section before `## Context`, an empty section at the end, a section with a fence; multi-line heading names its first line.
2. `scripts/lib/adr.mjs`: add `adrStatusHeading`.
3. Test first: `docs adr-get` and `docs adr-status` on `---` and `===`: `data.statusHeading`, a note naming `Accepted` and the next step, written text unchanged (`Deprecated\n\nAccepted\n===`), text output holds the note; no note on a normal ADR. Extend the PMK-283 characterization to `===`.
4. `scripts/pmkit.mjs`: both commands add the note and `statusHeading`.
5. Docs: README rows, `commands/spec/adr-status.md` (show notes already), CHANGELOG line.
6. Check the criteria, `npm test` (Node 22) in the foreground, PR.
