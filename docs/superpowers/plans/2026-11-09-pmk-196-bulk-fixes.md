# PMK-196 plan

Spec: `docs/superpowers/specs/2026-11-09-pmk-196-bulk-fixes-design.md`. TDD, one commit per task, ID in every message.

1. **Trim and remove-with-comma** (`scripts/lib/bulk.mjs`, tests in `scripts/bulk.test.mjs` and `scripts/cli-bulk.test.mjs`). Test: `label-add " a"` adds `a`; `label-remove "ui, web"` removes it from an issue that has it; `label-add "a,b"` still refused. Make `oneLabel` trim and refuse the comma only for add.
2. **One-issue error code** (`runBulk`). Test: one-issue batch with a `NOT_FOUND` (e.g. `parent ISS-NOPE` or `assign ghost` on one issue) keeps its code; the three-issue case stays `INVALID_INPUT`.
3. **Whitespace `--text` and next step** (`checkBulkFilter`). Test: `--text " "` is `INVALID_INPUT`; view with only a sort has a nextStep that does not contain `--label` and mentions `views save`; flags keep `--label`.
4. **Commit-only failure** (`commands/issues/bulk.md` step 7 and Output; test that an `auto_commit` failure after full success carries `written.applied` and no `failed`, if not already covered).
5. **Sort test** (`cli-bulk.test.mjs:192`): ordered comparison.
6. Docs: CHANGELOG line, mark criteria (`issues update PMK-196 --check n`), commit `.issues/`, `npm test` in foreground, PR.
