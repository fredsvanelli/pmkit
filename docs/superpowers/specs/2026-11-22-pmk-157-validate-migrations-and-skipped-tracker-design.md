# PMK-157: tidy how validate handles migrations and a skipped tracker

## Root cause

Found in PMK-118 and PMK-119. Three defects, each traced in the code:

1. **A missing migration crashes `validate`.** `chain()` in `scripts/lib/local/migrations.mjs` throws `NOT_SUPPORTED` (`this pmkit has no migration from tracker format X toward format Y`) with no `details`. `loadConfig` reaches it through `migratedCopy` → `planMigration` for a tracker behind the current format. `brokenConfigProblem` in `scripts/lib/validate.mjs` keeps only `INVALID_INPUT` and format errors, so it rethrows, and `pmkit validate` exits 2 instead of listing the problem, the one command that should list it.
2. **`setScalar` runs outside the `try` in `planMigration`.** The version bump after each step (`fs.writeFileSync(configFile, setScalar(fs.readFileSync(configFile), ...))`) is not wrapped, so a step that leaves `config.yaml` missing or unreadable throws a raw `Error` (no code, no next step, no `details.migration`), and `validate` crashes on it the same way.
3. **A skipped tracker reads as an empty one.** When `validate` cannot or does not check the tracker files (the tracker config does not load, the tracker is hosted, the format is not current), it returns `checked: noneChecked()` and prints `checked: 0 issues, 0 epics, ...`, which says the tracker is empty. `/pmkit:local:doctor` reports "the files checked (from `checked`)".

## Goal

`validate` lists a missing migration and a failing version bump as `migration` problems and exits 0, and says when it skipped the tracker files and why, in the text and the JSON.

## Approaches for 3

1. **`checked: null` and `skipped: <reason>` (chosen).** The JSON says the files were not checked, and the text leads with `tracker files not checked: <reason>`. An agent cannot read `null` as "0 issues".
2. Keep `checked` at zero and add `skipped`. A reader that looks at `checked` alone still gets "0 issues".
3. Text only. The agent reads the JSON (lessons of EPC-6), so the JSON would still say 0.

## Design

- `chain()`: its two `NOT_SUPPORTED` errors carry `details: { migration: { from, to } }` (the versions asked for) and next step `/pmkit:upgrade`, since only a pmkit with the migration can read the tracker.
- `brokenConfigProblem`: an error with `details.migration` is a `migration` problem whatever its code, so `NOT_SUPPORTED` from `chain()` is listed as `migration 1 to 2 ...`'s sibling, `this pmkit has no migration from tracker format 1 toward format 2`.
- `planMigration`: the version bump moves inside the `try`, so its failure becomes the same `INVALID_INPUT` `migration <from> to <to> failed: <message>` with `details.migration`.
- `validateRepo`: every early return gives `checked: null` and `skipped`: `the tracker config could not be loaded; see the problems` (config or migration problem), `the tracker is <system>, so validate checks only .pmkit/config.yaml and the ADRs` (hosted), `the tracker files are in format <n>, not <current>; see the problems` (format).
- `validate` text: `tracker files not checked: <skipped>` in place of the `checked:` line when `checked` is null.
- `commands/local/doctor.md` step 1 and Output: when `checked` is null, say the tracker files were not checked and why (`skipped`), not "0 files".
- Tests in `scripts/migrations.test.mjs` (missing migration, failing bump) and `scripts/validate.test.mjs` or `scripts/cli.test.mjs` (the skipped text and JSON for each of the three reasons). The golden `basic/validate.txt` keeps its `checked:` line: the basic fixture is checked.
- CHANGELOG.

## Interview

- Can a real install hit 1? Not with the shipped migrations (they chain from 1 to the current format). A pmkit installed from a branch that bumped `FORMAT_VERSION` without its migration would, and the test suite's custom `migrations` does; `validate` must not crash on it either way.
- Does anything else read `checked`? `doctor.md` (updated). The CLI's own text. No other command file.
- Is `/pmkit:upgrade` the right next step for 1? Yes: the tracker is older than this pmkit's format and this pmkit cannot move it; a pmkit with the migration (an upgrade) can.
- New terms or ADRs: none.
- Approval: the issue names the three defects; no product question. pmkit PO approves.
