# PMK-300: say that the old setext heading stays below the status adr-status writes

## Intent
`adr-status` on `## Status\nAccepted\n---` writes the new status above the heading and leaves `Accepted\n---` below it. The PMK-294 note describes the text before the write, so a reader of the result sees two statuses with no warning. After a write the note must say the heading stays below the new status, naming it.

## Goals
- When `adr-status` writes (the text changes), the note names the heading and its real underline (`{ heading, underline }`, `---` or `===`) and says it stays below the new status. With and without a `Status:` line or `status:` key.
- Dry run that would write says "stays" the same way (the dry run shows what would be written). Same in the JSON (`notes`) and the text.
- A status equal to the current one (nothing written) keeps today's `statusHeadingNote`: no claim about a "new status".
- `adr-get` keeps its note unchanged.

## Non-goals
- Removing the heading (it may not be a status). No change to what is read or written.

## Approaches
1. Replace the trailer in `runAdrStatus` only (chosen): `statusHeadingNote` stays shared; adr-status builds a separate written-note when `before !== after`. Smallest, adr-get untouched.
2. Add a `written` flag to `statusHeadingNote`: mixes two texts in one template for little gain.

## Design (my call, autonomous run)
Written note: `<path>: "<heading>" reads as a heading (an underline, <underline>, follows it) and stays below the status written here (<line>); docs adr-status does not remove it, so delete "<heading>" and its <underline> line yourself if it is not part of the status`. Dry run: "would stay" / "would write".
