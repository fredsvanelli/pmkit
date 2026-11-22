# PMK-155: check the design spec CLI table against the usage strings

## Problem

The `## CLI` table in `docs/superpowers/specs/2026-10-23-pmkit-design.md` is written by hand and drifts from the CLI. PMK-117 found the `cycle add` row showing `--to <sprint|none>` while the usage says `<sprint|current|none>`. Nothing checks the table, so the next drift goes unnoticed too.

A prototype comparison over every row finds four drifts today:

- `issues assign <id> <member|none>`: the usage is `<member|me|none>`.
- `cycle add <id...> --to <sprint|none>`: the usage is `<sprint|current|none>`.
- `cycle capacity <id>`: the usage is `<id|current>`.
- `release-notes [--release id|--sprint id|current|--since d ...]`: without spaces around the `|` that separates the flags, the row cannot be told apart from a value list. The usage writes `--release id | --sprint current|id | --since d`.

## Goal

A test fails when a row of the table names a command the CLI does not have, a flag its usage does not take, or a set of values (`a|b|c`) for a flag or a positional argument that differs from the usage. The four rows above are fixed.

Non-goals: the table stays a summary. It does not have to list every flag of a command, and the "Does" column is not checked.

## Approaches

1. **Structural comparison (chosen).** For each backticked command in the first cell of a row, find the CLI command by its longest matching name in `COMMANDS` (`scripts/pmkit.mjs`). Then check that every `--flag` of the row is in the command's usage (the global `--json` and `--dry-run` excepted), that a flag value with `|` has the same set of choices in the usage, and that each positional `<a|b>` has the same set of choices as the usage's positional at the same place. Order of the choices does not matter.
2. Exact string equality between row and usage. It would force the table to copy every flag, and the summary would become a second copy of `--help`.
3. Generate the table from `COMMANDS`. The spec is a hand-written design document with **(builder's call)** notes in its rows; generating it would lose those.

## Design

- `scripts/design-spec-cli.test.mjs`: reads the `## CLI` section, takes each row starting with `` | ` ``, unescapes `\|`, and applies approach 1. Each problem is a line naming the command and the drift; the test asserts the list is empty, so one run shows every drift.
- A second test runs the same check over a small inline table with a known drift (`cycle add <id...> --to <sprint|none>`), so the checker is shown to catch the PMK-117 case and not pass by finding nothing.
- The spec: fix the four rows above.

## Interview

- Does a row with several commands (`cycle list [--state s]`, `cycle current`, ...) work? Each backticked command is checked on its own.
- A command with a longer name sharing a prefix (`epic update` and `epic update-status`): the longest name that matches followed by a space or the end wins.
- Flags with no value in the row (`[--type]`) are only checked for existence.
- New terms or ADRs: none. The check is a test, easy to change.
- Approval: there is no product question; the issue states the fix and the test. pmkit PO approves.
