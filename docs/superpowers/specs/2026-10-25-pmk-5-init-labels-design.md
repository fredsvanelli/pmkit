# PMK-5: let init add labels to the Local tracker

Issue: PMK-5, epic EPC-1 (Local tracker: close the gaps of 0.1.0).

## Problem

`/pmkit:spec:import` marks requirements without acceptance criteria with the `needs-criteria` label, but only when the tracker's `labels` list in `.issues/config.yaml` contains it. `init` has no flag for labels, so the user has to edit the file by hand. `/pmkit:setup` never mentions labels.

## Current state

- `labels` in `.issues/config.yaml` is a list of plain names, written as a flow list (`labels: []` in `templates/issues.config.yaml`).
- `validate` checks an issue's labels against the list only when the list is not empty (`scripts/lib/validate.mjs`). An empty list allows any label.
- `init --update` edits the config with `scripts/lib/yaml-edit.mjs` (`setScalar`, `addMapEntry`), which changes only the lines it names. Comments and key order stay. The write is `change` in the file table, with a diff, and `--dry-run` shows it without writing.
- `issues list`, `issues create` and `issues update` already take `--label` as a repeatable, comma-separated flag (`csv(ctx.list('label'))`).

## Approaches

1. Add `--label` to `init`, repeatable and comma-separated like the issue commands. It appends names to `labels` with the existing line editor. Recommended.
2. Add a separate command (`labels add`). It would give removal and listing too, but it adds a command, a help entry and a write path for one gap, and `init --update` is already the place that edits this file.
3. Make `/pmkit:setup` edit `labels` itself without a CLI flag. It breaks ADR 0002's split: commands describe steps, the CLI does the writes, and it loses the dry run and the tests.

## Design

### CLI

- `init` accepts `--label <name>`, repeatable, each value may hold commas. The parser is the same `csv` helper the issue commands use.
- The flag works with and without `--update`. Without `--update` it fills `labels` in the generated config. With `--update` it appends to the existing list.
- The flag only adds. Names already in the list are skipped without error and listed in the output as "labels kept as they were", as members are. Duplicates inside the flag count once.
- A name is valid when it matches `^[a-z0-9][a-z0-9_-]*$`. Anything else fails with a usage error (exit code 2) naming the value and the rule. The pattern keeps names safe as plain YAML scalars and as values in `--label a,b` filters.
- Each label is a plain string, the format the config and `validate` already use. No color or description.
- The edit rewrites the `labels` line as a flow list, with `setScalar(local, ['labels'], [...existing, ...added])`. The line keeps its position and a trailing comment. A block-style `labels:` list, which the editor cannot change, fails with the existing "cannot set labels in .issues/config.yaml" error and the hint to edit by hand.
- The config goes through `validateLocalConfig` after the edit, as for the other flags.
- The text output adds `labels added: a, b` and `labels kept as they were: c`. `--json` adds `labelsAdded` and `labelsKept` to `data`. `--dry-run` shows the same before/after diff as every other `init` change and writes nothing.
- Help text, usage line, `flags` list and the README/CHANGELOG entry for `init` gain `[--label name ...]`.

### Setup command

- First run: step 4 gets a fifth question, asked with `AskUserQuestion`: "Add the `needs-criteria` label?" (yes recommended). `/pmkit:spec:import` uses the label for requirements that arrive with no acceptance criteria. The preview in step 6 and the write in step 8 add `--label needs-criteria` when the answer is yes. The step 7 summary lists the labels.
- Existing config: before step 3, read `labels` from `discover --json`. When `needs-criteria` is missing, ask the same question once. On yes, step 3 and step 7 add `--label needs-criteria`, and the dry run shows the change like any other. When it is already there, skip the question.
- Declining changes nothing. `spec:import` already handles a missing label: it does not pass the flag and lists those issues under "needs criteria" in its output. Setup says so in one line.
- Setup's parameters section and the "Confirmation points" section name the new question as an input, not a confirmation.

### Tests

In `scripts/cli-init.test.mjs`: a repeatable and a comma-separated flag; a first-run `init --label`; `--update` that appends and keeps existing labels, a comment and key order; a duplicate name skipped; an invalid name exits with 2; `--dry-run` writes nothing and reports the diff; a block-style list fails with the by-hand hint.

## Decisions

| Decision | Reason |
| --- | --- |
| Flag is `--label`, repeatable and comma-separated | Matches `issues create/update/list`. One parser, no new convention. |
| Flag adds only, never removes | The criteria say "adds ... keeps the existing". Removing a label can invalidate issues that use it, so it needs its own design. |
| An existing label is skipped without error | Setup must be safe to run again. Members already behave this way. |
| Name must match `^[a-z0-9][a-z0-9_-]*$` | Keeps the name valid as a plain YAML scalar and in comma-separated filters. Existing labels such as `needs-criteria` pass. |
| Labels stay plain strings | The config, `validate` and `discover` use strings. Color and description have no consumer. |
| Flag also works without `--update` | A new project can start with its labels, and setup's first run needs it. |
| Write with `setScalar` on the flow list | It already preserves comments and order, and `init --update` has the diff and dry run for it. No new editor code. |
| Offer the label in both setup paths | The criteria ask for the offer. Users with an existing config are the ones who hit the gap. |
| Declining is silent in the tracker | `spec:import` already degrades when the label is missing. |

## Acceptance criteria map

| Criterion | Part of the design |
| --- | --- |
| `init --update` adds labels from a flag and keeps the existing labels and comments | CLI: `--label` with `--update`, append through `setScalar`, skip duplicates, keep comments and order; tests for append, comments and order |
| `/pmkit:setup` offers the `needs-criteria` label | Setup command: new question in the first run, the same question in the existing-config path, `--label needs-criteria` in the dry run and write |

## Risks

- A tracker with an empty `labels` list allows any label. After the first label is added, `validate` rejects issues that use other labels. Setup's `validate` step shows these. The setup text warns about it when `labels` was empty and issues exist.
- A hand-edited block-style `labels` list cannot be changed by the editor. The error says so.
