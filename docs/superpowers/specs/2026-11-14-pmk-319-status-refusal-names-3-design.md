# PMK-319: name a status in a quote or item after a plain first line, and each fence once, in the adr-status refusal

## Intent
`docs adr-status` refuses a `## Status` section it would have to replace whole and names the status and the other text to move. Two cases still name the wrong lines (nothing is written or lost in either; only the names are wrong):
1. `Date: 2024-01-02`, blank, `> Accepted` (or `- Accepted`): `statusLineOf` prefers a later line that reads as a known status (PMK-316) only when the first line is an item or quote (`hostsLazy`), so the date is taken as the status and `> Accepted` is named as text to delete.
2. `- Accepted`, blank, a fence holding `## X`, blank, `Date: 2024-01-02`, blank, the same fence holding `## Y`: the refusal in `runAdrStatus` builds `openers` with `new Set` over the opening text, so two fences with the same opening line read as one (`the code fence "```" takes`), while two different openers read as two.

## Goals
- Case 1: the later-line preference also runs when the first line is plain text (not a block opener, `!OPENS_BLOCK`) that does not read as a known status (`readsAsStatus`). It reuses the same predicate for the later line (`text`, top-level text, not in a fence or HTML block, not indented code, not `Key: value`) and the same `inBlock()` computed once per call: no second way to decide. With no later line that reads as a known status the choice stays as today (for a plain first line that is the first line).
- Case 2: every fence the guard names is named once, by its position (its block), not by its opening text.

## Non-goals
- What `adr-status` refuses and writes, and what `adr-get` reads. `at` of `statusSection` only feeds the names of the refusal (`adrStatusDroppedAt`); `count`, `safe`, `text` and `raw` do not use it. Proved by a develop x branch comparison on 100 000+ random Status bodies.
- The fence guard of the in-place write (PMK-320: `fenceRisk`, `sectionEnd`).

## Approaches
1. Case 1: a new rule for plain first lines next to `hostsLazy`. Rejected: a second way to decide the status line.
2. (Chosen) Case 1: widen the entry condition of the existing branch of `statusLineOf` from `hostsLazy(first)` to `hostsLazy(first) || !OPENS_BLOCK.test(first)`. For a plain first line the old path returns that same line (`at == first`), so "no later status" is unchanged by construction.
3. Case 2 by a count (`2 code fences "```" take`). Rejected: it loses which openers there are.
4. (Chosen) Case 2: repeat the opening line once per fence (`the code fences "```", "```" take`). Why: it is the wording that already exists for two different openers, it keeps one name per fence in order, and the singular case and the case of different openers do not change. The JSON `error.message` has no new shape.

## Notes (my calls)
- "Plain" is `!OPENS_BLOCK`: the test the old path uses to pick the first line, so for a plain first line the old and the new choice agree when no later status exists. A thematic break, a link definition or an indented first line counts as plain: the refusal is the same either way, only the name moves to the later status.
- A plain later line (`Date: x`, blank, `Accepted`) is named as the status now too: the issue's rule says "the rule PMK-316 uses", and the brief asks for the same `text` predicate, which accepts a top-level plain line.
- `commands/spec/adr-status.md`: check whether it describes the names; CHANGELOG gets one line.

## Result of the comparison (develop x branch, 150 000 random Status bodies, seed 41)
Dry run and real run of `docs adr-status 1 deprecated` and `docs adr-get 1`, in process, at `origin/develop` (baf8d742) and at the branch, on bodies that start with a plain line, an item, a quote or a status and hold fences with the same opener, comments, HTML, indented code and key lines (136 109 refused, 13 891 written):
- Refused or not, the `nextStep`, the notes, the text written and what `adr-get` reads: equal on all 150 000, 0 divergences.
- Property check on both refs: every line `adrStatusDropped` returns is named once in the refusal (the closing line of a fence goes with its fence; the lines and openers the HTML and fence guards report on their own are not dropped lines). Branch: 0 lines lost, 0 phantom, and one opener per fence the guard names. develop: 1 635 bodies lose a line (the dedup of equal openers).
- Refusal messages that differ: 27 054, only in the names: 25 397 by case 1 (the status the branch leaves out reads as a known status, develop's was the first line, which does not), 1 415 by case 2 (one opener per fence instead of one per distinct text), 242 by both, 0 unexplained.
- `node scripts/dev/adr-commonmark-diff.mjs` (commonmark 0.31.2, `origin/develop` x worktree): 2 690 320 cases, 0 worse, 0 newly refused, 0 written where the base refused, 0 removed.
