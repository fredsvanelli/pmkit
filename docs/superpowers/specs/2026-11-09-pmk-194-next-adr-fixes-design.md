# PMK-194: docs next-adr fixes (design)

Issue: PMK-194. Source: PMK-65, PR #103. File: `scripts/lib/adr.mjs`.

## Intent
`docs next-adr` plans the next ADR number, slug and path. Four defects make it wrong or useless to a team.

## Decisions
1. **Path outside the repo.** When the tracker folder lies outside the repository, `path` is relative to the tracker folder (`docs/adr/<file>`), never absolute. A note says so, and `destination: tracker` plus `docPath` tell it from the repo file. Notes that name the two folders say "in the tracker" for this folder so they stay distinct from `docs/adr`.
2. **Numbers.** Only names of the form `NNNN-...md` (four or more digits, then a hyphen) count. `20261031.md` and `0007a-x.md` are listed as "not counted".
3. **Same folder twice.** When the tracker's ADR folder resolves to `<root>/docs/adr` (for example `tracker.path: .`), it is read once, as the repo folder. No false "also has ADRs" note.
4. **Slug.** Unicode letters and digits are kept (lowercased). Latin accents are still stripped, but only on Latin letters, so `й` stays `й` and Hangul stays composed. `ß æ œ ø đ ł ð þ` are transliterated (`ss ae oe o d l d th`). Everything else is one hyphen. The title is refused only when nothing is left; the message no longer implies Latin letters.

## Non-goals
Improvements in `docs/superpowers/epc-6-follow-ups.md`; a new command; changes to `docs create`.
