# PMK-315: exercise the status line choice in adr-commonmark-diff (design)

Small change (estimate 1). Only `scripts/dev/adr-commonmark-diff.mjs`, one pure helper beside it with a test, and a CHANGELOG line. `scripts/lib/adr.mjs` is out of scope.

## Why
The corpus has no status words, so after PMK-311 `adrInfo` reads the whole section in every case: the "one line of it" count is 0 and the choice of the status line and what the in-place write keeps are covered by unit tests only. An empty status is counted as "one line of it".

## Goals
- Corpus lines that are status words (`Accepted`, `Proposed`, `Superseded by ADR 2`, with and without `*`, `**`, `_` emphasis), dates, `Supersedes` and `Key: value` lines, in the fixed pairs/triples and in the random runs, without losing a current case (the CommonMark extent check is unchanged).
- Per body, what `setAdrStatus` removes at each ref, and a count of bodies where the head removes text the base kept or refused. Exit 1 when that count is not 0.
- Empty status counted on its own report line.

## Definitions
- **Refusal.** A ref refuses a body the way `docs adr-status` does: its guards `adrHtmlHeld`, `adrFenceHeld` or `adrStatusDropped` (all exported at both refs) report something, so `setAdrStatus` is never called. A refusal is its own outcome, never "removed".
- **Threw.** An exception from a guard or from `setAdrStatus` is a bug, not a refusal: counted as `threw` (with an example), its own outcome. The run exits 1 when the head throws on a body; a base that throws is only counted and reported (review of PR #282).
- **Removed text.** For a write, the multiset of trimmed non-blank lines of the document before minus those after. The write adds `Superseded by <sentinel>`, which no corpus line equals, so nothing cancels. The line the write replaces is always removed; that is the status line.
- **Status line allowance.** The head's own status line (`adrInfo(text).status` at the head, the line the head replaces) is not counted as "extra" removed text.
- **Head removes text the base kept or refused** (`worse`):
  - both write: head's removed lines that the base did not remove (multiset), other than the head's status line;
  - base refuses, head writes: any removed line besides the head's status line (a refused body whose text the head deletes);
  - base writes, head refuses: not worse, counted as `newly refused`; both refuse: `refused on both`.
  - base refuses, head writes and removes only its status line: counted as `accepted where the base refused` (the intended PMK-311 change).
- **Empty status:** the head's whole-section reading is empty (`''`). Counted as `empty status` and not as "one line of it".

## Approaches
1. Compare removed text with a pure function over two reader objects, in a sibling module that needs no commonmark (chosen: testable in `npm test`, the script only wires it).
2. Inline in the script (no test, evidence only from runs).
3. Diff whole output documents (loses what was removed vs added).

## Corpus size / time
Added kinds go in as new alphabet lines and one weighted random kind; the random count stays at 1,000,000. The totals and time of the full run are reported in the PR; if a run is too slow the fixed pair/triple blocks keep the new lines and the random count is the knob.

## Evidence
Full run `--base 3f24c7e6 --head 5d09c170`, a mutation run (temporary copy, in-place write drops a kept line, exit 1), both in the PR. Tests for the pure helper.
