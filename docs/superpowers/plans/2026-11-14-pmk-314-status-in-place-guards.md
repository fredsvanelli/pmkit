# PMK-314 plan

Spec: `docs/superpowers/specs/2026-11-14-pmk-314-status-in-place-guards-design.md`. TDD, inline.

1. Tests first (`scripts/adr.test.mjs`, CLI cases next to the PMK-311/313 ones): closed comment and closed fence holding `## X` after a status line: real, dry run, `adr-get` has no note; unclosed comment, no status line, item/quote status, ambiguous section: still refused; hard break (two spaces, `\`) kept and read without it, one-line section with a break; `***` and `___` give no continuation note.
2. `scripts/lib/adr.mjs`: `statusSection` returns `text` (status without break) and `brk`; the three guards return nothing when `safe !== -1`; `adrInfo` and `setAdrStatus` use them; `adrStatusContinuation` skips `THEMATIC`.
3. Docs: `commands/spec/adr-status.md`, `commands/spec/record-decision.md` step 7 if the text changes, ADR 0006 (read contract), README, CHANGELOG, criteria checked.
4. Proof: develop x branch random bodies; `adr-commonmark-diff.mjs` before and after; `npm test` in the foreground.
