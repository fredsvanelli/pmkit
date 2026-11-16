# PMK-186: no cache in the test fixtures (design)

Size: a small change (two copy sites, one comment, one test). No questions were asked; the issue and its two acceptance criteria are the input.

## Intent
Running `node scripts/pmkit.mjs` inside `scripts/__fixtures__/*` writes `.issues/.cache`. The tests copy the whole fixture, so the copy carries a stale index and 14 tests (`reindex`, `pr open`, query-index) fail. The header comment of `scripts/scenarios-live.mjs` repeats counts (runs, entries, dollars) that go stale.

## Decisions (the author's calls)
1. The CLI keeps writing the cache wherever it runs; refusing by path would put test knowledge in product code. Instead a fixture copy never takes `.issues/.cache`: one `copyFixture(src, dest)` in `scripts/test-helpers.mjs` filters it, and both copy sites (`makeRepo`, `prepareCopy`) use it. A test checks that the copy of a folder with a cache has none.
2. `.gitignore` lists `scripts/__fixtures__/**/.issues/.cache/` so git never shows a cache there (the cache already ignores itself with a `*` `.gitignore`; this makes it explicit).
3. The counts in `scripts/scenarios-live.mjs` come out of the comment: it says "every scenario entry" and "one run per entry, up to $1 each", and the suite reads the number from the list at run time. A test fails when the header gives a number of runs or entries again.

## Out of scope
The improvements in `docs/superpowers/epc-6-follow-ups.md`.
