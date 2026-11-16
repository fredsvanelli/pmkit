# PMK-316: name a non-status item and a repeated fence closer right in the adr-status refusal

## Intent
`docs adr-status` refuses a `## Status` section it would have to replace whole, and the message names the other text to move. Two cases still name the wrong lines (nothing is written or lost in either; only the names are wrong):
1. `- see ADR 3`, blank, `Accepted`: `statusLineOf` takes the first item or quote as the status (PMK-313) without asking whether it reads as one, so `Accepted` is named as text to delete and the note is taken as the status.
2. `- Accepted`, blank, a fence holding `## X`, blank, `Date: 2024-01-02`, blank, the same fence again: the loop in `runAdrStatus` removes the fence lines from the other text by text (`indexOf`), so the second fence's lines come back as other text (`"```"`).

## Goals
- Case 1 (review cycle 1: the later line must also be text at the top of the section: not inside a fence or an HTML block, not indented 4 columns, not a block opener, `Key: value` or reference line, so a `Accepted` in a fence, comment or indented code stays named): when the first line is an item or quote that does not read as a known status and a later line does, the later line is the status and the item is text to move. The known-status rule is the one `topLevelStatus` and `statusSection` use (`readsAsStatus`, `KNOWN_STATUS`); no second rule. When no later line reads as a known status the choice stays as today (the first item or quote): the section is refused either way and nothing better can be named.
- Case 2: every fence line the guard names (opener and closing line of each at-risk fence) is taken out of the other text by its line position, never by text. A line outside a fence with the same text as a fence line stays named.

## Non-goals
- What is refused, what is written, what `adr-get` reads. `count > 1 && safe === -1` still decides the refusal; `statusLineOf` only picks which line is called the status (the number of dropped lines is unchanged); `adrInfo` reads `text ?? raw.filter(Boolean).join(' ')`, which does not use `at`. Proved with a develop x branch comparison on 200k+ random Status bodies.
- Other first lines that are not items (`Date: x`, then `> Accepted`) keep today's naming: out of this issue (candidate follow-up).
- The HTML/fence guard lines (`## X`) and the first fence opener keep their text match in `runAdrStatus` except where a position replaces it for fence lines.
- `sectionEnd`'s section extent is untouched, so `adr-commonmark-diff.mjs` stays at 0 worse.

## Approaches
1. Case 1 by a single global rule (the first line that reads as a known status, whatever the first line is). Rejected: it also changes the name for a first line that is not an item (`Date: x`), outside what the issue lists, and the comparison would show a third kind of divergence.
2. (Chosen) Case 1: keep today's choice, and when it came from the item/quote rule and does not read as a known status, take the first later non-comment line that does, if any.
3. Case 2 by counting text matches (remove as many equal lines as fence lines). Rejected: an unrelated line with the same text would be removed instead of its fence line. By position: `fenceRisk` already knows each fence line (`block.closer`); the opener gets `block.start`; `adrFenceClosers` returns the line indices of the closers and a new `adrFenceLines` the indices of every fence line named; `adrStatusDroppedAt` gives `{ at, line }` for the dropped lines.
4. (Chosen) Case 2 by position as in 3: `runAdrStatus` removes the dropped entries whose `at` is a fence line. The existing opener-by-text and heading-by-text removals for HTML blocks stay.

## Notes (my calls)
- The issue says the repeated *closer* is named again; the repro's leftover `"```"` is in fact the second fence's opener (text matching removed the second opener in place of the second closer, and only the first fence's opener was ever removed). By position both the opener and the closer of every named fence go with their fence, so neither is other text. That is the "none as other text" of the acceptance criterion.
- `commands/spec/adr-status.md` describes the refusal in general terms; no wording changes. CHANGELOG gets one line.

## Result of the comparison (develop x branch, 250 000 random Status bodies, seed 11)
Dry run of `docs adr-status 1 deprecated` and `docs adr-get 1` at `origin/develop` and at the branch: the code (refused or not), the text written (`after`), the notes and what `adr-get` reads are equal on all 250 000 bodies (195 180 refused, 54 820 written). 50 628 refusal messages differ, all in the names: 12 563 by case 1, 35 973 by case 2 and 2 092 by both, 0 unexplained. By position the fence lines of a *named* fence are the ones taken out, so where develop's text match took out a line of another block (a quote fence with the same text) or the same text in another order, the branch names the right lines (12 308 of the case 2 bodies). `node scripts/dev/adr-commonmark-diff.mjs` (commonmark 0.31.2, `origin/develop` x worktree): 2 690 320 cases, 0 worse, 0 newly refused, 0 written where the base refused, 0 removed.

## Review cycle 1 (PR #287)
- The refusal names every fence by its opening line (`the code fences "```", "~~~js" take ...`, one name when the openers have the same text), so a second fence with another opening line no longer drops out. Chosen over keeping the other openers as other text because the issue's repro (two equal fences) must leave no fence line as other text; every line the write deletes is then named once, with its fence, with its HTML block or as other text. `adrFenceHeld` and `adr-get` are untouched; `adrFenceBlocks` replaces `adrFenceClosers` and `adrFenceLines` (the closing line text is no longer kept).
- Comparison v2 (250 000 bodies, seed 17): a property check on both refs that every line `adrStatusDropped` returns is named once. See the PR.
- Review cycle 2: the set of lines a fence or HTML block holds is worked out once per `statusSection` call (it was a `sectionEnd` walk per candidate: 1.9 s for 4000 lines); a `assertFast` probe (20000 lines, `probe-targets.mjs#adrInfoBody`) covers it.
