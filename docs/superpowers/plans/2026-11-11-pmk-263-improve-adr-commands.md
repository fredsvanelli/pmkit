# PMK-263 implementation plan

Spec: `docs/superpowers/specs/2026-11-11-pmk-263-improve-adr-commands-design.md`. Every task starts with a failing test.

1. **adr-status writes every status line** (criterion 5). Test in `scripts/adr.test.mjs`: front matter + `Status:` line, and `Status:` line + `## Status`, both show the new status in all places. Change `setAdrStatus` in `scripts/lib/adr.mjs`: also rewrite the `Status:` line above the first `##` when yaml or a section was found; keep `before`/`after` and the unchanged check covering it.
2. **`docs adr-get`** (criterion 1, CLI part). Tests in `scripts/adr.test.mjs` (`adrInfo` for title and status) and `scripts/cli.test.mjs` (output, NOT_FOUND, writes nothing). Add `adrInfo` to `adr.mjs`, the command to `scripts/pmkit.mjs`, `docs adr-get` to `documents` in `scripts/lib/capabilities.mjs`, and the entries the registry tests ask for (`golden-cases.mjs` with goldens, `cli-degraded-coverage.test.mjs`, ADR-0001 counts if a path changes).
3. **record-decision** (criteria 1 to 3, command part). Edit `commands/spec/record-decision.md` as the spec says; update `scripts/plugin.test.mjs` step assertions, the `spec-record-decision` scenarios and goldens, and add a scenario for two replaced ADRs if the scenario harness allows one more entry (counts in `scenarios.test.mjs` and `scenarios-live.mjs`).
4. **validate hosted** (criterion 4). A test in `scripts/validate.test.mjs` or `cli-linear` that runs `validate` through the CLI on a Linear config with two ADRs of one number.
5. **Docs**: `CHANGELOG.md` line under Unreleased, the README command table row for `docs adr-get`, `skills/pmkit/SKILL.md` if it lists CLI commands, `commands/spec/adr-status.md` if it names the status forms.
6. Check the criteria with `issues update PMK-263 --check n`, commit `.issues/`, `npm test` in the foreground, then deliver (steps 9).
