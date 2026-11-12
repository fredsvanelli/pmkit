# PMK-291 plan

1. TDD: add three tests in `scripts/adr.test.mjs` (wider sibling, fence at column 0, lazy continuation) for `adrInfo`, `setAdrStatus` and the CLI path (`adr-get`, `adr-status`); see them fail.
2. Rewrite `continuesItem` in `scripts/lib/adr.mjs` as the forward stack walk of the spec; see the new and old tests pass.
3. Compare `adrInfo` develop vs branch over generated list cases with commonmark.js as oracle (scratchpad script); no case worsens; record the changes for the PR.
4. CHANGELOG line, check the acceptance criterion, `npm test` in foreground, PR, comment, move to `in_review`.
