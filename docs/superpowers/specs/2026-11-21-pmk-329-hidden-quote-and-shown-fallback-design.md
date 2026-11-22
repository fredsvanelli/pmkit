# PMK-329: skip a quote of definitions and keep a shown line in the adr-status fallback

## Problem

The refusal of `docs adr-status` names the line it keeps as the status and the other lines as text to move (`statusLineOf` in `scripts/lib/adr.mjs`). Since PMK-325, the walk of `statusSection` finds the first paragraph the reader sees past link reference definitions. Two shapes still keep a line the reader does not see. Only the names are wrong: what is refused, written or read does not change.

Reproduced at `c4e15daa`:

| Body | Keeps today | Should keep |
|---|---|---|
| `> [a]: /u`, blank, `> Date: x`, `> Accepted`, blank, `> Proposed` | `> Proposed` | `> Accepted` |
| `> [a]: /u`, blank, `> Date: x`, `> Accepted` | `> [a]: /u` | `> Accepted` |
| `[a]: /u`, blank, `Date: x`, `Foo` | `[a]: /u` | `Date: x` |
| `[Draft]:`, `Rejected`, blank, `see ADR 3` (PMK-322 test) | `[Draft]:` | `see ADR 3` |
| `- [a]: /u`, blank, `- Date: x`, `  Accepted`, blank, `> Proposed` | `> Proposed` | `> Proposed` (unchanged) |

Root causes:

1. **The walk counts only paragraphs as hidden.** `hidden` and `runs` record paragraphs of definitions only, by parent. A quote holding nothing else is a block of the document that is never recorded, so the paragraph of the next quote is not "the first shown after the definitions", and `after` has no entry for the section's first line.
2. **The fallback returns `first` as is.** When no line reads as a status, `statusLineOf` returns `first`, the first non-blank line, even when it is a hidden definition and `glued` (the first shown paragraph after it) is known.

## Approaches

1. **One tracker of hidden blocks, quotes included** (chosen). `runs` keeps, by parent, the last run of hidden blocks with its first and last index. "Every earlier block is hidden" is read from the run (`from === 1` and `index === node.index - 1`), so `hidden` goes, as the PMK-325 review asked. A paragraph of definitions only is hidden; a quote whose blocks are all hidden (its run spans `1..children`) is hidden in its parent too, at any depth. A list item never is: its bullet is shown.
2. Keep `hidden` and add a second pass that marks empty quotes after the walk. Two trackers to keep in step, and the issue asks for one.
3. Post-process the names (drop a kept definition). It would fix the symptom in `statusLineOf` only, and the quote case would still pick `> Proposed`.

## Design

In the walk of `statusSection`:

- `runs`: `Map(parent → { line, from, index })`, the last run of hidden blocks that follow each other in that parent.
- `hiddenBefore(node)`: `node.index === 1`, or the parent's run has `from === 1` and `index === node.index - 1`. It replaces both `index - 1 !== hidden.get(parent)` tests.
- `hide(node, line)`: extend the parent's run when it ends right before `node`, else start one at `node`. When the parent is a quote and its run now spans all of its blocks (`from === 1`, `index === parent.children`), `hide(parent, parent.start)`.
- The walk already sets `index`, `parent` and `children` on every block. A quote gets `start: j`, its first line, for the run's `line`. The run's line is what `after` maps from, and only the section's first line is ever looked up.

In `statusLineOf`, the fallback with no later status keeps the first shown line: `later === -1 ? (sees(first) || glued === undefined ? first : glued) : later`. A first line that the reader sees stays as is, and so does one with no shown paragraph after its definitions. A thematic break or indented code between them is a shown block, so `glued` is undefined there.

## Tests (TDD, `scripts/adr.test.mjs`)

- A PMK-329 loop over the quote shapes, with and without a blank and `> Proposed` after: `adrStatusDropped` names every line but `> Accepted`, dry run and real run through the CLI refuse with those names, and the file is unchanged. A nested case: a quote of a quote of definitions, then `> > Date: x`, `> > Accepted`.
- The list item holding only definitions keeps `> Proposed`, unchanged.
- The fallback: `[a]: /u`, blank, `Date: x`, `Foo` keeps `Date: x` and names `[a]: /u`, `Foo`.
- The PMK-322 test `a definition over two lines with no later status` changes on purpose: it keeps `see ADR 3` and names `[Draft]:`, `Rejected`.

## Evidence for the PR

- develop x branch on random Status bodies (scratch script): refusal, text written and `adr-get` status equal; only names differ, each classified.
- `scripts/dev/adr-commonmark-diff.mjs --base origin/develop --head worktree`, full run: exit 0, 0 worse.

## Out of scope

A list item holding only definitions, any other shown block before the paragraph, and anything that changes what is refused, written or read.

## Interview

Checked against the issue, `CONTEXT.md` and ADR 0006 (the status is one line of the Status section).

- Does a quote of a quote of definitions count as hidden? Yes. CommonMark shows nothing for it, and the rule recurses. Tested.
- Does a hidden quote inside a list item make the item hidden? No. The item's bullet is shown (issue, Out of scope).
- `start` on quote blocks: an internal field of the walk, read only by `statusSection`. No public shape changes.
- New terms: none. ADRs: none, since only refusal names change.
- Approval: there is no open product question, and the acceptance criteria fix the expected names, so the design is approved under the owner's rule.
