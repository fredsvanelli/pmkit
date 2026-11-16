# PMK-248: adr-status on an unchanged section and on two status forms

## Intent
`docs adr-status` (PMK-228) writes an ADR wrongly in two cases. Fix both in `setAdrStatus` (`scripts/lib/adr.mjs`), the one function the command routes through.

## Behaviour
1. **Unchanged status leaves the file alone.** When every status the ADR holds already equals the requested value, compared after trimming and ignoring letter case, `setAdrStatus` returns the original text (CRLF/BOM already normalised) so `before === after` and the command says `unchanged`. This covers a `## Status` section with no blank lines around it and a lowercase body (`accepted`). A section with several body lines, or an empty one, is a change.
2. **Every status is changed.** An ADR with a `status:` front matter key and a `## Status` section gets both rewritten. The returned `before`/`after` stay those of the front matter key (first form found), as today.

## Non-goals
Other status formats (`Status:` lines) keep their behaviour; the unchanged check applies to them too through the same comparison.

## Decisions (my calls)
- The comparison is on the status value only (`status:` key value, section body, or the `Status:` line value), without the label, quotes or bullet.
