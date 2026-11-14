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

Approved by the coordinator with one correction: whole-section replacement stays byte-identical (refusals, messages, `adr-get` notes), so `held.unclosed` keeps its meaning and only the in-place guard takes the top-level criterion.

- `sectionEnd` (`scripts/lib/adr.mjs`): next to `held.openFence`, set `held.openHtml`, the PMK-320 criterion for an HTML block: the block directly in the document (`open.length === 2`) when it is an HTML block of kind 1 to 5, else `null`. A quote or list item that ends ends the block it holds; at the end of the file every container ends, so only a top-level block still takes in later lines. `held.unclosed` is unchanged.
- `adrHtmlHeld`: in place, a line is named only when its block is `held.openHtml` (was `held.unclosed`). The `late` clause and the replacement path keep `held.unclosed`, so replacement is unchanged. When the block is top level, `held.openHtml === held.unclosed` (an HTML block is a leaf, the last open block), so the top-level in-place refusals are unchanged too.

Rejected: redefining `held.unclosed` to the top-level block. It also drops the `late` lines of a nested block open at the end of the file from replacement refusals (`- Accepted`, blank, `- <!--`, blank, `  text`: the cause and the `adr-get` note change), which the issue keeps out of scope.

## Tests (scripts/adr.test.mjs, scripts/cli.test.mjs)

- New: for each kind 1 to 5, quote (`> <opener>`, `> ## X`) and list item (`- <opener>`, `  ## X`), with and without a final newline: `adrHtmlHeld` is null, `docs adr-status` writes in place (dry run and real, one line changed), `docs adr-get` has no note and `htmlHeld: null`.
- Controls kept: top-level kind 1 to 5 block that never closes refuses; whole-section replacement refuses (existing tests). New: the replacement message for `- Accepted`, blank, `- <!--`, blank, `  text` at the end of the file is pinned (it names the HTML block and `text`).
- Existing tests: none pinned the old in-place refusal; none changes.

## Proof

- Scratchpad script (outside the repo): develop x branch on random Status bodies (quote and list prefixes, kinds 1 to 7 openers and closers, headings, endings with and without final newline, CRLF), checked against commonmark.js 0.31.2: new writes only where commonmark.js puts a kind 1 to 5 `html_block` in a container ending at the last line and no top-level unclosed one; no new write changes more than one line or deletes a line; 0 new refusals; `adrInfo` equal everywhere; for every body both refuse, the `adrHtmlHeld`, `adrFenceHeld` and `adrStatusDroppedAt` results (message and note inputs) are equal; every body the head writes and the base wrote gives the same text. Probe of 200,000 bodies: 59 new writes, all in place and all this case, 0 others. The PR runs 2,000,000.
- `node scripts/dev/adr-commonmark-diff.mjs` in full: 0 worse.

## Docs

ADR 0006 (PMK-314 bullet, `adr-get` contract), `commands/spec/adr-status.md` refusal list, README row for `docs adr-status`, CHANGELOG.
