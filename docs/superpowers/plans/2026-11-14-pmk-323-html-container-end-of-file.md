# PMK-323 plan: write in place past an HTML block its quote or list item holds at the end of the file

Design: `docs/superpowers/specs/2026-11-14-pmk-323-html-container-end-of-file-design.md`. Small task, inline execution, TDD. Every commit carries PMK-323.

## Task 1: failing tests (scripts/adr.test.mjs)

1. Add to the PMK-314 "written in place, real and dry run, with no note in adr-get" table, generated for each opener `<!--`, `<?php`, `<![CDATA[`, `<!X`, `<script>`: quote (`> <opener>`, `> ## X`) and list item (`- <opener>`, `  ## X`), each with and without a final newline (20 cases).
2. Add a test pinning the replacement refusal for `## Status\n\n- Accepted\n\n- <!--\n\n  text` (no final newline): real and dry run exit 2, the message as develop gives it (names the HTML block `<!--` and `"text"`), file unchanged, `adr-get` has `htmlHeld` and the note.
3. Run `node --test scripts/adr.test.mjs`: the 20 new cases fail (adrHtmlHeld not null), the pin passes.

## Task 2: the fix (scripts/lib/adr.mjs)

1. `sectionEnd`: `held.openHtml = open.length === 2 && open[1].type === 'html' && open[1].kind <= 5 ? open[1] : null`, with a comment, and the doc comment of `sectionEnd` names it.
2. `adrHtmlHeld`: in place compare with `held.openHtml`.
3. Run `node --test scripts/adr.test.mjs`: all pass. Commit.

## Task 3: docs and CHANGELOG

ADR 0006 (PMK-314 bullet), `commands/spec/adr-status.md` (refusal list), README row of `docs adr-status`, CHANGELOG line like PMK-320's with the counts. Commit.

## Task 4: proof

1. Scratchpad `fuzz.mjs` (outside the repo) at 2,000,000 bodies, seed 1: new writes only this case (commonmark.js 0.31.2), all in place, none deletes a line, 0 new refusals, `adrInfo` equal, guard results equal where both refuse, write text equal where both write.
2. `node scripts/dev/adr-commonmark-diff.mjs --commonmark <scratchpad>/cm/node_modules/commonmark --head worktree` in full: 0 worse.

## Task 5: secure and ship

`/utils:review-work`, `npm test` exit 0, PR via `pmkit pr open`, summary comment, move to `in_review`.
