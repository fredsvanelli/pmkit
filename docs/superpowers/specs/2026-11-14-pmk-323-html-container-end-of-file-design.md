# PMK-323: write in place past an HTML block its quote or list item holds at the end of the file

Short design (estimate 1). The coordinator chose the approach (reuse PMK-320's criterion); brainstorming questions were answered from the code.

## Intent

In place, the HTML guard names a block of kind 1 to 5 only when it is `held.unclosed`, the block still open at the end of the walk that ends the `## Status` section. `sectionEnd` sets it from the innermost open block wherever it is, so a block in a quote or list item that is open at the end of the file counts, though nothing comes after it to take (the container ends with the file). `adr-status` refuses `Accepted`, blank, `> <!--`, `> ## X` (no final newline) and `- <!--`, `  ## X` (with or without), and `adr-get` notes them. The fence guard (PMK-320, `held.openFence`) writes these.

## Goals

- In place, an HTML block of kind 1 to 5 in a quote or list item open at the end of the file is not refused and gets no `adr-get` note (no `htmlHeld`), real and dry run, for `<!--`, `<?php`, `<![CDATA[`, `<!X`, `<script>`, with and without a final newline.

## Non-goals

- A top-level kind 1 to 5 block that never closes: keeps refusing.
- Whole-section replacement: keeps refusing.
- `statusLineOf` (PMK-322) and `scripts/dev/` (PMK-324).

## Design

One line in `sectionEnd` (`scripts/lib/adr.mjs`), the PMK-320 criterion: `held.unclosed` is the block directly in the document (`open.length === 2`) when it is an HTML block of kind 1 to 5, else `null`. A quote or list item that ends ends the block it holds; at the end of the file every container ends, so only a top-level block still takes in later lines. `adrHtmlHeld` is unchanged. The doc comment of `sectionEnd` says it.

### Side effect on whole-section replacement (stated, not hidden)

`adrHtmlHeld` uses `held.unclosed` in a second place: the `late` lines (after a blank line of the block) of an unclosed block are named in any mode. With the change, a nested block open at the end of the file no longer names its late non-heading lines, as a nested block its container ends earlier already did not. Probe at this branch: `- Accepted`, blank, `- <!--`, blank, `  text` was refused by the HTML guard and by the other-text guard (`adrStatusDroppedAt`); now only by the other-text guard. It still refuses, nothing new is written; only the refusal message changes from naming the HTML block to naming the other text, and `adr-get` loses the note for it. Heading-like lines are still named in replacement mode whatever holds them. A whole-section replacement always drops the block's lines, so the other-text guard always covers them. The comparison below checks that 0 replacement bodies become writes.

## Tests (scripts/adr.test.mjs, scripts/cli.test.mjs)

- New: for each kind 1 to 5, quote (`> <opener>`, `> ## X`) and list item (`- <opener>`, `  ## X`), with and without a final newline: `adrHtmlHeld` is null, `docs adr-status` writes in place (dry run and real, one line changed), `docs adr-get` has no note and `htmlHeld: null`.
- Controls kept: top-level kind 1 to 5 block that never closes refuses; whole-section replacement refuses (existing tests).
- Existing tests: running the full suite with the change gives 0 failures, so no test pinned the old refusal; none changes.

## Proof

- Scratchpad script (outside the repo): develop x branch on random Status bodies (quote and list prefixes, kinds 1 to 7 openers and closers, headings, endings with and without final newline, CRLF), checked against commonmark.js 0.31.2: new writes only where commonmark.js puts a kind 1 to 5 `html_block` in a container ending at the last line and no top-level unclosed one; no new write changes more than one line or deletes a line; 0 new refusals; `adrInfo` equal everywhere. Probe of 200,000 bodies: 59 new writes, all in place and all this case, 0 others. The PR runs 2,000,000.
- `node scripts/dev/adr-commonmark-diff.mjs` in full: 0 worse.

## Docs

ADR 0006 (PMK-314 bullet, `adr-get` contract), `commands/spec/adr-status.md` refusal list, README row for `docs adr-status`, CHANGELOG.
