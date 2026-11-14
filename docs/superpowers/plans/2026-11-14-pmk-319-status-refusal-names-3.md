# PMK-319 plan

Spec: `docs/superpowers/specs/2026-11-14-pmk-319-status-refusal-names-3-design.md`.

1. Tests first in `scripts/adr.test.mjs` (see them fail):
   - Case 1: `Date: 2024-01-02`, blank, `> Accepted` and the same with `- Accepted` (and `Accepted`, nested): `adrStatusDropped` is `['Date: 2024-01-02']`; the CLI dry run and the real run refuse naming the date as other text and not `Accepted`; the file is unchanged. No known status after a plain first line: choice unchanged. A known status in a fence or comment after a plain line stays named. A plain first line that reads as a status keeps it.
   - Case 2: two closed fences with the same opener (list item and quote variants, three fences) are named as `the code fences "```", "```" take`, once each; different openers unchanged.
   - Probe: a plain first line that is not a status before many lines in a fence or quote, `assertFast`.
2. `scripts/lib/adr.mjs`: widen the entry of `statusLineOf`.
3. `scripts/pmkit.mjs`: `openers` is one entry per fence.
4. Existing tests unchanged in outcome; `commands/spec/adr-status.md` and CHANGELOG.
5. develop x branch on 100 000+ random Status bodies (refusal, written text, adr-get, property: each dropped line named once, 0 lost, 0 phantom) and the full `node scripts/dev/adr-commonmark-diff.mjs`.
6. Check the criteria, `npm test` in the foreground (Node 22), PR, summary comment, `in_review`.
