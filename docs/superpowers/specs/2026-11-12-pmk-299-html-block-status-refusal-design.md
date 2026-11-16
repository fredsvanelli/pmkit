# PMK-299: refuse to delete what an HTML block takes into the Status section

## Intent

Since PMK-291, `sectionEnd` follows CommonMark HTML blocks. `<!-- note` without `-->` runs to the end of the file; `<div>` and `<custom-tag>` (kinds 6 and 7) run to the next blank line. A heading inside such a block belongs to the `## Status` section, so `adr-status` replaces it with the new status and deletes the user's `## Context`. Reading is right by CommonMark; deleting text is not.

## Goals

- `docs adr-status` writes nothing (dry run too) and fails with `INVALID_INPUT` and a next step when the lines it would replace hold a line that reads as an ATX heading inside an HTML block, or text that an HTML block of kind 1 to 5 left unclosed takes in after a blank line.
- `docs adr-get` adds a note naming the cause and the same next step, and returns `htmlHeld` (the lines, or `[]`).
- A closed HTML comment in the section works as before.

## Non-goals

- How the section is read (`adrInfo`, `sectionEnd` result) does not change; `scripts/dev/adr-commonmark-diff.mjs` shows 0 differences.
- Keeping the text and writing only the status is not offered (the issue picks refusal).

## Approaches

1. Re-scan the section in the command. Duplicates `sectionEnd`: rejected.
2. Any ATX-looking line in the body. Also refuses fenced code and ignores plain text an unclosed comment takes: rejected.
3. (chosen) `sectionEnd` takes an optional `held` array and records the non-blank lines an HTML block continues, with the block; `adrHtmlHeld(text)` turns that into the lines at risk. Same walk as the reading, so the refusal is true exactly when an HTML block took the line in.

## Decisions (my calls)

- At risk: a continuation line that reads as an ATX heading (any kind, closed or not), or a line after a blank line in a kind 1 to 5 block still open at the end of the file.
- The first line of the block (the HTML line itself) is the status text the user wrote, so it is never "held".
- The refusal runs before `setAdrStatus`, in `runAdrStatus`; `setAdrStatus` is unchanged.
