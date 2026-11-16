# PMK-59 design: the estimate-issue command

## Goal

`/pmkit:issues:estimate <id>` proposes an estimate for an issue from the code it affects and from similar completed issues. It saves the estimate after one confirmation. When the tracker has no estimate field, it posts the estimate as a comment instead.

Sources: the Unified model Dev catalog (`estimate-issue`: "Estimates from the affected code and similar issues", degradation "Comments the estimate") and the Linear tab ("Saves the estimate after confirmation"). Those lines live in `docs/superpowers/specs/2026-10-23-pmkit-mvp-skills.md` and `docs/superpowers/specs/2026-10-23-pmkit-design.md`.

## Decisions

1. The command is a Markdown file, `commands/issues/estimate.md`. It uses existing CLI operations only: `capabilities`, `discover`, `issues get`, `issues list`, `issues update --estimate` and `issues comment`. There is no new operation, so the Linear manifest needs no `unsupported` entry. `issues update` and `issues comment` already exist on Linear.
2. "Without estimation" means the `estimation` capability has `path: absent` in `pmkit capabilities --json`. On the Local tracker it is always native. On Linear it is absent when the team has estimates off or `mappings.fields.estimate` is `none`.
3. The estimate comes from the scale in `discover` (`estimate.unit` and `estimate.scale`). The command never invents a value outside the scale. When `discover` returns no scale (the absent case), the comment states the estimate in ideal days.
4. Similar issues are completed issues (`--category done`) found by `issues list --text` with keywords from the title, then read with `issues get` for the estimate. Issues with no estimate are not evidence and are listed apart.
5. One confirmation. The proposal and the `before` and `after` of the dry run are shown together, and the user accepts, picks another scale value or declines. `write_policy.confirm: none` skips the question, never the proposal.
6. An issue that already has the proposed estimate changes nothing, and the command says so.
7. An epic ID is not accepted. Epics have no estimate.

## Registration

README command list, `commands/help.md` has no list to edit (it reads the command files), the routing table of `skills/pmkit/SKILL.md`, the `COMMANDS` map in `scripts/plugin.test.mjs`, the command-file count in `scripts/scenarios.test.mjs`, a scenario module with its snapshot, and a CHANGELOG line.
