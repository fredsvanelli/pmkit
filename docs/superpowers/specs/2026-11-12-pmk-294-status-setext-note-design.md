# PMK-294: note when the Status section is empty and a setext heading follows

## Intent

`## Status\nAccepted\n---` is, in CommonMark, an empty Status section followed by an h2 heading `Accepted` (PMK-273, pinned by PMK-283). `adr-get` reads a null status and `adr-status` writes `Deprecated` above `Accepted`, so a human sees two statuses with no hint why. The agent reads the JSON, so the hint goes there and in the text.

## Goals

- `docs adr-get` and `docs adr-status` add a note, in `notes` (JSON and text), when the `## Status` section holds no text and the first thing that ends it is a setext heading. The note names the heading line (`Accepted`).
- The note carries the next step: remove the underline (`---` or `===`) so the line reads as the status.
- Both commands also return `data.statusHeading`: the heading's first line, or `null`.

## Non-goals / anti-goals

- What is read and written does not change (PMK-283 characterization stays; `===` is added to it).
- No warning where the line is not a heading: a list item (`- Accepted\n---`, a thematic break), a quote, a fence, an empty `## Status` before an ATX heading or the end of the file.

## Approaches

1. Re-scan the lines after `## Status` in the command. Duplicates `sectionEnd` rules: rejected.
2. Add `adrInfo().notes`. Breaks the many `deepEqual` pins of `adrInfo`'s shape: rejected.
3. (chosen) A small export `adrStatusHeading(text)` in `scripts/lib/adr.mjs` that uses `locate().end`, the same `sectionEnd` that decides the section: the note is true exactly when the section ended at a setext heading. The section is empty when the lines up to `end` are blank; the end is setext when the line at `end` is not an ATX heading (`sectionEnd` returns either an ATX line, a setext paragraph's first line, or the line count).

## Decisions (my calls)

- The note names the first line of a multi-line setext heading (`Accepted\nmore\n---` names `Accepted`).
- `adr-status` computes it on the text before the write; it says the status is written above the heading and the heading is left alone.
- With a front matter `status:` key and the empty section too, the note still shows: the section is empty and the line is a heading.
