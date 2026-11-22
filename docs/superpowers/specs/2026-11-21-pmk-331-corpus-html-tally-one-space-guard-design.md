# PMK-331: tally the corpus HTML ends apart and guard the one-space write in npm test

## Problem

PMK-327 added HTML blocks in containers, status lines before break lines, and one-space status lines to the corpus of `scripts/dev/adr-commonmark-diff.mjs`. Its review left gaps:

1. **Tally.** The driver tallies container cases by `item.end`. The HTML cases (`HTML_CONTAINERS`) share the PMK-321 end names, so `end of file` mixes 16 fence or `<div>` cases with the HTML ones, and every line says `(PMK-321)`.
2. **`isStatus` cannot fail.** In `scripts/dev/adr-write-compare.test.mjs` it is `STATUS_NEAR.includes(line)`, and the generators build their status lines from `STATUS_NEAR`, so it is true by construction.
3. **No guard on the one-space write.** The test checks the shape of `oneSpacePairs`, not that `setAdrStatus` writes one of its bodies in place over the one-space line. That write is what makes the one-space mutation exit 1.
4. **Counts in words.** The `cases()` count comment lists `240 + 1,638 + 42,588` and leaves out the `3,766` that the assertion adds. The code comment and the CHANGELOG say the pairs and triples hold one-space lines "among them". But only the `oneSpacePairs` bodies written in place can catch the mutation.

## Approaches

1. **Tag the HTML container cases** (chosen). `HTML_CONTAINERS` cases get `group: 'HTML, PMK-327'`. The PMK-321 cases keep their exact shape `{ text, end }`, because the PMK-324 prefix test hashes `JSON.stringify` of each case. The driver reads `item.group ?? 'PMK-321'`, so the older lines read as before and the HTML ones get their own lines.
2. Tally by kind (opener). That makes 10 lines per end, which is more than the acceptance criterion needs to read.

## Design

- `scripts/dev/adr-write-compare.mjs`:
  - `HTML_CONTAINERS` maps each case to `{ ...item, group: 'HTML, PMK-327' }`, and `CONTAINERS` is unchanged. The PMK-324 prefix hash covers `CONTAINERS` and not the HTML cases, so it stays green with its constant unchanged.
  - `STATUS_WORDS` and `STATUS_OTHER` are exported for the test.
  - The comment over `oneSpacePairs` and the PMK-327 module comment say which bodies catch the mutation.
- `scripts/dev/adr-commonmark-diff.mjs`: tally by `` `${item.group ?? 'PMK-321'}` `` and end, and print `` container cases ending at ${end} (${group}) ``. The header comment says the HTML cases are tallied apart.
- `scripts/dev/adr-write-compare.test.mjs`:
  - `isStatus(line)`: the issue's own rule. The line is a `STATUS_WORDS` or `STATUS_OTHER` line, or one plus exactly one trailing space (after trimming leading spaces). A mutation that puts an `ALPHABET` line in a status place fails it.
  - A new test, `setAdrStatus writes a oneSpacePairs body in place over its one-space line (PMK-331)`. For each `ONE_SPACE` line, at least one body has no guard refusing it, and its write is in place (`writeShape(...).inPlace`) with `oldLine` equal to the one-space line. The count of such bodies is pinned, and a mutation of `oneSpacePairs` that puts every one-space line next to a break line fails it.
  - The count comment adds `+ 3,766` (the one-space pairs).
- `CHANGELOG.md`: the PMK-327 line (0.6.0) says that only the one-space pairs written in place catch a write that keeps the space, and a PMK-331 line goes under Unreleased.

## Checks

- `--base 3fb6707b --head worktree` run: the HTML end-of-file writes show on their own lines. The PR quotes those lines.
- Mutations, each in a throwaway edit: `statusBreakPairs` with `ALPHABET` in place of `STATUS_NEAR` fails `isStatus`; `oneSpacePairs` without the lines alone fails the in-place test.
- `scripts/lib` unchanged; the PMK-324 prefix test is green with its constant unchanged.

## Interview

- Tag name or kind? Tag. The acceptance criterion allows either, and the tag keeps the output short.
- New terms or ADRs: none. This is a developer check only.
- Approval: there is no product question and the acceptance criteria are exact, so the design is approved under the owner's rule.
