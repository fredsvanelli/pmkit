# The status of an ADR is one line of its Status section

`docs adr-get` used to read the whole `## Status` section as the status (`Accepted Date: 2024-01-02`), so `docs adr-status` could only replace the whole section, and PMK-306 made it refuse when the section held anything else. MADR ADRs (`Accepted` plus a date line) and Nygard ADRs (`Accepted` plus `Supersedes ...`) could not be marked. The status is now one line, the line `statusLineOf` picks: the first non-blank line that does not open a block (comment, quote, list item, fence, heading, table), else the first non-blank line. `adr-get` reads that line alone and `adr-status` replaces that line in place and keeps every other line of the section. A section of one line reads and writes as before.

## Considered options

- One line, the first that does not open a block. Chosen. It is the line PMK-310 already names in the refusal, so reading and writing share one rule, and it matches how MADR and Nygard put the status first.
- The first paragraph. Rejected: `Accepted` and `Date: 2024-01-02` on adjacent lines are one paragraph, so the date would still read as status.
- Keep refusing (PMK-306). Rejected: it leaves common formats unmarkable by `record-decision`.

## Consequences

- The reading contract changes: a status wrapped over two lines reads as its first line, and `statuses` no longer joins the section. `adrInfo` and `setAdrStatus` call the same `statusLineOf`.
- A section whose lines all open a block, with more than one non-blank line, has no line safe to replace, so `adr-status` still refuses it ("other text"). The HTML block and code fence guards (PMK-299, PMK-302) are unchanged.
- `adr-status` writes no `Supersedes` line (the new ADR holds it), so `--by N` cannot duplicate one; a kept line that already names ADR N gets a note.
