# PMK-154: say when a `current` reader finds no active sprint

## Problem

Found in PMK-116. `issues list --sprint current` prints `warning: there is no active sprint, so --sprint current matches no issues; run pmkit cycle list` on stderr when no sprint is active. Three gaps remain:

1. `--json` output has no warnings. The CLI prints every `result.warnings` line on stderr only (`run` in `scripts/pmkit.mjs`), and `issues list --json` and `views run --json` print the search result without them. The agent reads the JSON, so it sees an empty list and can tell the user "no issues".
2. `commands/issues/find.md` has no clause for the warning, and `skills/pmkit/references/conventions.md` has no rule for reading warnings (rule 4 covers `note:` only).
3. Other readers of `current`. A survey of the CLI:

| Reader | No active sprint |
|---|---|
| `issues list --sprint current`, `views run` (a view with `sprint: current`) | empty list and the warning (`issueSearchResult`) |
| `issues bulk ... --sprint current` | empty set, "nothing would change", **no warning** |
| `team load --sprint current` | the same warning |
| `cycle capacity current`, `team capacity` | `NOT_FOUND`, no sprint is active |
| `render sprint --sprint current`, `release-notes --sprint current`, `release-readiness --sprint current`, `issues create/update --sprint current`, `cycle add --to current` | `INVALID_INPUT`, there is no active sprint |

So `issues bulk` is the one reader that still fails silently.

## Goal

Every reader of `current` either fails or warns, the warning reaches `--json`, and the command files and conventions tell the agent to show it.

## Approaches

1. **`warnings` in the JSON of the search results, the warning in `issues bulk`, one conventions rule (chosen).** `issues list --json` and `views run --json` add `warnings` (the lines the CLI prints as `warning:`) when there is at least one, as `issues bulk` already holds `warnings` in its data. `issues bulk` adds the no-active-sprint line when its filter has `sprint: current`, the set is empty and no sprint is active.
2. A `warnings` key on every `--json` result, added in `run`. It would change the shape of every command's JSON (an array result such as `cycle list` cannot take a key) and every golden, for warnings most commands never have.
3. Make `--sprint current` fail with `INVALID_INPUT` in reads too. PMK-116 chose a warning so a saved view or a filter keeps working between sprints; reversing it is a product change the issue does not ask for.

## Design

- `scripts/pmkit.mjs`, `issueSearchResult`: `data` is `{ ...found, warnings }` when `warnings` is not empty, else `found` as today. `issues list` and `views run` go through it.
- `scripts/pmkit.mjs`, `runTeamLoad`: the same for `team load --json`, which printed the warning on stderr only (found while building; `team load` is a `current` reader).
- `scripts/pmkit.mjs`, `runBulk`: when the filter (or the view's filter) has `sprint: 'current'`, no issue matched and `currentCycle()` is null, push the same line, `there is no active sprint, so --sprint current matches no issues; run pmkit cycle list`, to `warnings` and `data.warnings`. One constant holds the line for both places.
- `skills/pmkit/references/conventions.md`, a rule after rule 4: show every warning. The CLI prints each as `warning:` on stderr; with `--json`, a result that has warnings also holds them in `warnings`. Repeat them as printed. An empty result that comes with a warning is not "nothing matches": say what the warning says.
- `commands/issues/find.md`, step 6: when the result has `warnings`, show them under the table; with the no-active-sprint line, say there is no active sprint instead of "no issues", and offer `pmkit cycle list`.
- `commands/issues/bulk.md`, the `writes` is `0` bullet: when `warnings` says there is no active sprint, say that instead of "nothing would change".
- Tests: `scripts/cli.test.mjs` (or the file that holds the PMK-116 test) gets `--json` cases for `issues list` and `views run`; `scripts/cli-bulk.test.mjs` a bulk case. The golden files change only where a case has a warning.
- CHANGELOG.

## Interview

- Does `found.warnings` already exist? The GitHub search returns `warnings` (fields it could not read on an issue), so on GitHub the JSON already holds those. `issueSearchResult` merges them with the problems, the cut read and the sprint line into the printed lines; the `warnings` key becomes that full list, which keeps GitHub's lines and adds the rest. Local and Linear results have no `warnings` key today.
- Are `problems` and `hasMore` duplicated? They stay where they are in the JSON; the `warnings` lines are their printed form, as on stderr. The conventions rule says to repeat them once.
- A view run of a Linear native view: `runView` returns the same shape and goes through `issueSearchResult`.
- New terms: none. ADR: none, the JSON key is additive.
- Approval: the issue names the three gaps; the chosen shape follows `issues bulk`. pmkit PO approves.
