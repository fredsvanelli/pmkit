---
id: PMK-173
title: "Clean up tests, comments and ADR-0005 left from EPC-5"
type: chore
status: backlog
priority: low
estimate: 5
related: [PMK-28]
created: 2026-10-29T02:47:21.691Z
updated: 2026-10-29T02:47:21Z
---

## Description

Test, wording and comment cleanups from the EPC-5 reviews that are still open on main. Each item names the file, the problem and the fix.

Tests
1. scripts/cli.test.mjs:504, :516 and :526. The test names say "linear" but the tests run the first tracker without an adapter (`UNSUPPORTED`). Rename them to "a system without an adapter".
2. scripts/lib/linear/client.test.mjs:99-140. There are no tests for a BOM, a comma or a tab before `mutation`. Add them to the `isMutation` tests.
3. scripts/cli-migrate.test.mjs:235, :412 and :601. No test for a whitespace-only `--expect`. Add `['--expect', '  ']` to the three loops.
4. scripts/lib/args.mjs:46. No unit test for the three-word parse (`linear triage show`). Add one in a new args test file.
5. scripts/cli-degraded-coverage.test.mjs:155-156. `pr open` and `pr ready` notes are tested only with `--dry-run`. Add a case after a real write.
6. scripts/cli-degraded-coverage.test.mjs:88. The COVERED check passes if the argv text appears anywhere in the file. Point each command at a named degraded test.
7. scripts/lib/linear/degraded-live.mjs:55. The live rows have no `release get` case (code 2, `releases` is absent). Add one.
8. scripts/lib/linear/cycles.test.mjs:42. The no-overlap loop lacks `23:00:00.000Z`. Add it.
9. scripts/lib/linear/client-live.mjs:170. The `start <= end` assert runs before the diagnostics. Move it after them.
10. scripts/scenario-helpers.mjs:582. The helper changes `process.env` and never restores it. Restore the keys after the run.
11. scripts/adr-linear-auth.test.mjs. The test greps ADR prose. Keep the key-leak and workspace tests, and drop or merge the rest.

Comments and code wording
12. scripts/lib/yaml-edit.mjs:121-124. `setMap` drops the header comment and the comments inside the old block. Keep them, or state the loss in the function comment.
13. scripts/pmkit.mjs:323-324. The comment says only `local: true` commands use `ctx.local()`, but `milestone create` (pmkit.mjs:645) does too. Fix the comment.
14. schemas/pmkit.config.schema.json:31 and :96. The descriptions open with "Hosted trackers only:". Use "Hosted trackers only." like `tracker.path`.
15. docs/superpowers/specs/2026-10-23-pmkit-design.md:129. The `mappings:` example line has no value. Give it one.
16. scripts/lib/linear/client-live.mjs:2 and :4 (parentheses) and scripts/lib/linear/client.mjs:232 (a colon in the middle of a sentence) break the Unslop rules. Rewrite them.

ADR-0005 (docs/adr/0005-linear-uses-a-personal-api-key-from-the-environment.md)
17. Line 5. Cite the source of "Bearer gives HTTP 400".
18. Lines 3, 12 and 20. State a source for "401 for an unknown key", the 24-hour OAuth refresh, `previousUrlKeys` and "Linear has no official CLI".
19. Line 20 and docs/superpowers/specs/2026-10-27-pmk-28-linear-auth-design.md:106. "when the configured key matches neither" should say "workspace".
20. Lines 7, 15 and 16. "The user chose" reads oddly in an ADR. State the rule.
21. Lines 17-31. The consequences repeat the spec. Trim them to what each issue must do.

## Acceptance criteria

- [ ] Item 1: The three test names no longer say "linear"
- [ ] Item 2: Tests cover a BOM, a comma and a tab before `mutation`
- [ ] Item 3: Each of the three loops covers a whitespace-only `--expect`
- [ ] Item 4: A unit test covers the three-word parse
- [ ] Item 5: `pr open` and `pr ready` have a test after a real write
- [ ] Item 6: The COVERED check names a degraded test for each command
- [ ] Item 7: A live row covers `release get`
- [ ] Item 8: The no-overlap loop includes 23:00:00.000Z
- [ ] Item 9: The live cycle diagnostics run before the start and end assert
- [ ] Item 10: `process.env` has its original values after the helper runs
- [ ] Item 11: The ADR test keeps only the key-leak and workspace checks
- [ ] Item 12: `setMap` keeps the comments or the function comment states the loss
- [ ] Item 13: The `ctx.local()` comment names `milestone create`
- [ ] Item 14: Both schema descriptions use "Hosted trackers only."
- [ ] Item 15: The `mappings:` example in the design spec has a value
- [ ] Item 16: The named lines pass the Unslop rules
- [ ] Item 17: ADR-0005 cites a source for the Bearer claim
- [ ] Item 18: ADR-0005 cites a source for each of the four claims
- [ ] Item 19: ADR-0005 and the PMK-28 spec say "workspace"
- [ ] Item 20: ADR-0005 states each rule without "The user chose"
- [ ] Item 21: ADR-0005 consequences are trimmed to what each issue must do
