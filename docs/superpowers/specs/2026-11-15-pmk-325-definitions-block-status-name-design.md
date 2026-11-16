# PMK-325: name the status after link definitions a blank line closes, in the adr-status refusal

## Intent
Since PMK-322 the `adr-status` refusal names as the status the line the reader sees: a line glued to the first shown paragraph counts, also after definitions glued to that paragraph (`paragraphOf.after`). When the definitions are a block of their own, closed by a blank line, the walk sees a paragraph of definitions only (hidden) and then a separate paragraph, so `paragraphOf.after(first)` is undefined, nothing is glued, and the glued status is named as text to delete (or, with no later status, the hidden definition is kept). Only names change; refusal, text written and `adr-get` status stay equal.

Checked on develop 97a3bd03 (`adrStatusDropped`):
- `[a]: /u`, blank, `Date: x`, `Accepted`, blank, `> Proposed` names `"[a]: /u", "Date: x", "Accepted"` (keeps `> Proposed`). Same with `[b]: /v` glued, with `[b]: /v` as a second block, in a quote (`> [a]: /u`, `>`, ...) and in a list item.
- `[a]: /u`, blank, `Date: x`, `Accepted` names `"Date: x", "Accepted"` (keeps the hidden definition).

## Approach (one sensible way)
In the existing walk of `statusSection` (`scripts/lib/adr.mjs`), which already loops over `held.paragraphs` and fills `map` and `after`: keep, per parent block, the run of consecutive definitions-only paragraphs (`{ line, index }`: the first line of the run and the block index of its last paragraph). When a shown paragraph is the very next block of the same parent (`paragraph.index === run.index + 1`), set `after.set(run.line, start)`. `statusLineOf` is unchanged: `glued = paragraphOf.after(first)` now also finds the paragraph after a definitions block, so its glued lines count as with no definition, and the definition, never seen (`sees(first)` false), is never the status when a glued line reads as one.

- Block indexes count every block of the parent (`add`), so a thematic break or indented code between the definitions and the paragraph breaks the run: `[a]: /u`, `---`, `Date: x`, `Accepted` and indented code first keep their names (out of scope, fallback stays).
- Quote and list item: the shown-paragraph rule for them (`index - 1 === hidden count`) is unchanged; the run only adds the `after` entry.
- Other approaches dropped: a second walk, or a test in `statusLineOf` on raw lines (a second way of deciding block kind), both ruled out by the issue.

### Definitions before a quote or item (coordinator condition)
On develop `[a]: /u`, blank, `> Date: x`, `> Accepted` names `"> Date: x", "> Accepted"`, so it keeps the definition, and with `> Proposed` after it keeps `> Proposed`. The scope says the hidden definition is never kept, so this is fixed here, in the same loop: `add` gives every block its `parent` (not only paragraphs), and from the shown paragraph the loop climbs while the block is the first of its quote or item (`index === 1`); at each level, a run of definitions right before the block (`run.index === node.index - 1`) maps the run's first line to the paragraph. `[a]: /u`, blank, `> Date: x`, `> Accepted`, blank, `> Proposed` then keeps `> Accepted`, as without the definition.

The run's first line is only ever read as `after(first)`, the first non-blank line of the section, so a run that does not open the section changes nothing.

## Files and functions
- `scripts/lib/adr.mjs`: `add` in `sectionEnd` (`parent` on every block when `held.paragraphs` is asked for), the `walk` closure in `statusSection` (a few lines), their comments and `statusLineOf`'s comment.
- `scripts/adr.test.mjs`: new tests. `CHANGELOG.md`: one line.

## Tests
New, failing first (`adrStatusDropped` and the CLI `docs adr-status`, dry run and real, file unchanged):
1. `[a]: /u`, blank, `Date: x`, `Accepted`, blank, `> Proposed` → `["[a]: /u", "Date: x", "> Proposed"]`; with `[b]: /v` glued and as its own block; in a quote → `["> [a]: /u", ">", "> Date: x", "> Proposed"]`; in a list item.
2. `[a]: /u`, blank, `Date: x`, `Accepted` → `["[a]: /u", "Date: x"]`; in a quote (`> [a]: /u`, `>`, `> Date: x`, `> Accepted`) → `["> [a]: /u", ">", "> Date: x"]`.
3. Before a quote: `[a]: /u`, blank, `> Date: x`, `> Accepted` → `["[a]: /u", "> Date: x"]`; with blank, `> Proposed` after → `["[a]: /u", "> Date: x", "> Proposed"]`.
Controls (pass before and after): `[a]: /u`, `---`, `Date: x`, `Accepted` → `["---", "Date: x", "Accepted"]`; `    code`, blank, `Date: x`, `Accepted` → `["Date: x", "Accepted"]`.
Tests that change on purpose: none expected; any that pins an old name will be listed with its reason.

## How the acceptance criteria are shown
1. and 2. The tests above.
3. A develop x branch comparison through the CLI (script in the scratchpad, `PMK-325/`), on random Status bodies with a seed: refused yes/no, `nextStep`, text written and `adr-get` status equal; every name difference classified (a definitions block before the first shown paragraph); counts, seed and time in the PR. `scripts/dev/adr-commonmark-diff.mjs` full run: 0 worse.

## Complexity
No new walk; one map lookup per paragraph inside the existing loop.
