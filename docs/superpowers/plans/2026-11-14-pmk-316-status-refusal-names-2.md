# PMK-316 plan

Spec: `docs/superpowers/specs/2026-11-14-pmk-316-status-refusal-names-2-design.md`.

1. Test first (`scripts/adr.test.mjs`), see them fail:
   - `- see ADR 3`, blank, `Accepted`: `adrStatusDropped` is `['- see ADR 3']`; CLI dry run and real run refuse naming `- see ADR 3` and not `Accepted`.
   - Same with a quote (`> see ADR 3`), a nested item, a one-line comment before, and no later known status (choice unchanged: item is the status).
   - Two fences with the same closing line: each fence named once with its fence, no `"```"` as other text, in dry and real run; a closer whose text equals a line of other text outside a fence keeps that line named.
2. `scripts/lib/adr.mjs`: `statusLineOf` takes `readsAsStatus` into account (case 1); fence block records `start`; `adrFenceBlocks` returns `{ opener, start, closer }` of each named fence (review cycle 1; it replaced `adrFenceClosers` and `adrFenceLines`); `adrStatusDropped` built on `adrStatusDroppedAt` (case 2).
3. `scripts/pmkit.mjs`: remove fence lines from the other text by position.
4. Existing tests unchanged in outcome (`adrFenceClosers` assertion is `[]` still).
5. CHANGELOG line; AC checked off.
6. develop x branch comparison on 200k+ random Status bodies (refusal, written text, adr-get), `adr-commonmark-diff.mjs` full; `npm test` in foreground.
7. PR, summary comment, `in_review`.
