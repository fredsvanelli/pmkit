# PMK-179 epic goal and goal checks of validate

Source: PMK-179, the defects the review of PR #91 found in PMK-45 (goals on the Local tracker). Extends `2026-10-30-pmk-45-strategic-goals-design.md`.

## Goal

`epic goal` stops losing data and stops clearing a link by accident, `validate` reports every bad epic-to-goal link, and the spec decides how a canceled epic counts in goal progress.

## Non-goals

- The improvements in `docs/superpowers/epc-6-follow-ups.md`.
- Changing how `epic create --goal` or `issues parent` parse their input (they already refuse an empty value).

## Design

### 1. `epic goal <epic> ""` is refused

`setEpicGoal(epic, goal, ...)` takes `null` to remove the link and a goal ID to set it. Any other value that is not a non-blank string (`""`, whitespace, a number) is `INVALID_INPUT`: `goal must be a goal id, or "none" to remove the link`, next step `pmkit goal list`. Only the CLI word `none` becomes `null`, so an empty `$GOAL` in a script fails instead of writing the event `goal -> null`.

### 2. `validate` checks the epic's goal as a link

Today `goalIds` holds every `.md` stem of `goals/`, so `goal: notes` passes when `goals/notes.md` exists, and a goal file that does not parse still counts as present. An epic with a `goal` now yields a `reference` problem on its `epic.md` when:

- the value is not a goal ID (`goal notes is not a valid goal id such as GOAL-1`);
- no goal file has that ID (`goal GOAL-9 does not exist`);
- the goal file exists but does not parse (`goal GOAL-1 does not parse, see goals/GOAL-1.md`). The goal file's own problem stays, so the user sees both.

A goal file held back by conflict markers is "does not parse" for this check.

### 3. `epic goal` rewrites only the `goal` line

The command edits the stored frontmatter text with the line editor of `scripts/lib/yaml-edit.mjs` (`setScalar`, `removeKey`) and leaves every other line as it is: unknown keys (including lists of maps), `# comment` lines, `""` keys, key order and the body byte for byte. The text is normalized to LF first, as every reader does. A new `goal` key goes at the end of the frontmatter block. The result is read back with `parseEpicFile` before it is written. When the line editor cannot edit the file (a `goal` key that holds a block), the command fails with `INVALID_INPUT` and the doctor as next step, and writes nothing. `serializeEpic` is unchanged, since `epic create` writes a new file.

### 4. A canceled epic counts as nothing in goal progress

An epic whose status category is `canceled` is out of the goal: its issues, open or done, are left out of every sum of `goalProgress` (`total`, `done`, `canceled`, `points`, `pointsDone`, `byCategory`), the same way a canceled issue leaves `total`. The epic stays in `epics` so the agent and the user see it, with its own `progress` (what `deliverableProgress` returns) and `counted: false`. Every other epic has `counted: true`. An epic whose status maps to no known category is counted: an unknown state never removes work. A goal whose epics are all canceled has `total: 0`, which `goals overview` already reports as "not known", not 0%.

`goal progress` text marks a not counted epic (`canceled, not counted`) and the JSON carries `counted`, so the message exists in both.

## Acceptance criteria map

1. `""` refused, `none` clears: section 1, tests in `scripts/goals.test.mjs` and `scripts/cli.test.mjs`.
2. `validate`: section 2, tests in `scripts/validate.test.mjs`.
3. Keys and comments kept: section 3, test with an epic holding a comment, a `""` key and a list of maps, byte-compared.
4. Canceled epic: section 4 (this document) with a test.

## Decisions taken without the user

- A canceled epic is excluded from the sums but listed (`counted: false`), rather than removed from the list or counted as before.
- Edit the stored text with `yaml-edit.mjs` rather than teach `stringifyYaml` lists of maps and comments.
- A `reference` problem code for all three validate cases, as the existing goal check uses.
