# PMK-321: check the new line and the lines outside the section in the write check, and exercise container fences (design)

Small change (estimate 2). Only `scripts/dev/adr-write-compare.mjs` and its test, the wiring and corpus in `scripts/dev/adr-commonmark-diff.mjs`, and a CHANGELOG line. `scripts/lib/` is out of scope (PMK-319 and PMK-320 work there in parallel); the full run stays out of `npm test`.

## Why
After PMK-318 `compareWrites` checks the shape of a write, but (1) the text of the new line of an in-place write is not checked, so `foo`, an empty line or a lost hard line break count as `acceptedWhereRefused`; (2) a whole-section write compares the lines outside the section by trimmed text, so a stripped indent after the section counts as `same`; (3) the corpus has no fence or HTML block in a quote or list item, so PMK-317's guard is never exercised.

## Goals
- In place: the new raw line is exactly `indent of the old line + the requested status + the hard line break of the old line`. The requested status is `Superseded by sentinel.md`, the script's sentinel. Anything else (empty, `foo`, lost break, changed indent) is `worse`.
- Whole section: the raw lines of the document outside the section (`span`, as CommonMark ends it) are the same, byte for byte, not trimmed. A stripped indent after the section is `worse`.
- Corpus: status on a plain line, then a fence or an HTML block in a quote and in a list item holding a heading-like line, ended by a later line, a blank line, an ATX heading, a setext heading or the end of the file. Added after the cases of PMK-291, 311 and 315, which stay as they are and in the same order. The summary counts the outcomes of these cases apart, by terminator.

## Non-goals
- No change to `scripts/lib/adr.mjs`; no importing the hard line break rule from the head under test.
- No weakening of the check when develop's real `setAdrStatus` fails it: that stops the work and goes to the orchestrator.

## Approaches
1. `writeShape` also returns the raw old and new line of an in-place write, and, given the `span`, whether the lines outside it are unchanged raw; `compareWrites` takes the requested `status`, computes the expected line with a helper copy of the hard line break rule and compares (chosen: pure, testable without commonmark, one place for each rule).
2. Compare whole raw documents in the script with a re-implementation of the write: duplicates the head's logic, rejected.
3. Import `hardBreak` from the head: the defect of PMK-315 again, rejected.

The copy of the hard line break rule is locked by a test against `setAdrStatus` of `scripts/lib/adr.mjs`, as the copy of `KNOWN_STATUS` is.

## Evidence for the PR
Unit tests; full run `--base 3f24c7e6 --head <develop>` with time and totals (0 worse, exit 0); the container cases tallied by terminator; two mutations in a temporary worktree (hard break dropped in place, indent stripped after the section on a whole-section write), each exit 1, and the run without mutation exit 0.
