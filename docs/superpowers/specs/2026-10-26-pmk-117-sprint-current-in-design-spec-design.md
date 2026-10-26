# PMK-117: show --sprint current in the pmkit design spec

## Problem

PMK-114 made `issues create --sprint current` and `issues update --sprint current` work, and changed both usage strings in `scripts/pmkit.mjs` to `[--sprint id|current|none]`. The CLI table in `docs/superpowers/specs/2026-10-23-pmkit-design.md` was not updated.

- The `issues create` row (line 330) shows `[--sprint]`.
- The `issues update` row (line 331) shows `[field flags, including --milestone and --branch]` and does not name `--sprint`. A reader cannot tell from the spec that update takes a sprint at all.

The spec describes the CLI, so it should show the flag as the CLI prints it. This issue changes two table rows in one file. No code changes.

Acceptance criteria:

1. The `issues create` row shows `[--sprint id|current|none]`, the same text as the `issues create` usage in `scripts/pmkit.mjs`.
2. The `issues update` row shows `[--sprint id|current|none]`, the same text as the `issues update` usage in `scripts/pmkit.mjs`.
3. `grep -F '[--sprint]' docs/superpowers/specs/2026-10-23-pmkit-design.md` finds nothing, and `npm test` passes.

## Findings

- The CLI usage strings are at `scripts/pmkit.mjs` line 278 (create) and line 288 (update).
- The `issues create` row already matches its usage string flag for flag, except for the `--sprint` text. Only that one token changes.
- The `issues update` row is the only row that summarizes flags with a phrase. Its usage string lists every flag.
- Markdown tables treat `|` as a cell separator. The spec escapes it as `\|` in every row (see the `issues list` row, which shows `[--sprint current\|none\|id]`). The new text must do the same. The raw file will contain `[--sprint id\|current\|none]`, and the rendered text is `[--sprint id|current|none]`, the same as the usage.
- No test or scenario reads the design spec. `grep -rn "2026-10-23-pmkit-design" scripts/` finds nothing, and no file under `commands/` links to it. `npm test` cannot fail because of this edit. It proves only that nothing else changed.
- `cycle add` has the same kind of drift. The spec row says `--to <sprint\|none>` and the usage says `--to <sprint|current|none>`. PMK-114 did not change that usage string, so this gap is older than PMK-114. See the follow-up candidates.

## Approaches

### A. Spell out the full update usage (chosen)

Replace the phrase `[field flags, including --milestone and --branch]` with the flag list the CLI prints, and add `--sprint id\|current\|none` to the create row.

- Both rows then match their usage strings. A reader can copy the row.
- The update row names every flag it accepts, so the next flag that changes shows up as a clear diff against the CLI.
- The row gets longer. The `issues create` and `issues list` rows are already as long.

### B. Keep the short phrase and add one token

Change the update row to `<id> [field flags, including --milestone and --branch] [--sprint id\|current\|none] ...`.

- Smallest diff.
- The row would say `--sprint` twice in effect: once inside "field flags" and once as a token. The phrase also hides which flags exist, which is the cause of this gap.
- The row would not match the usage string, so criterion 2 ("the same text as the usage") would hold only for the one token.

### C. Name the flag inside the phrase

Change the phrase to `[field flags, including --sprint id\|current\|none, --milestone and --branch]`.

- Keeps the row short.
- The text `[--sprint id|current|none]` (with its brackets) does not appear, so criterion 2 fails as written.

## Chosen approach

Approach A. It is the only one that makes both rows equal to the CLI usage strings, which is what criteria 1 and 2 ask for. It also removes the vague phrase that let the gap go unnoticed.

## Changes

All changes are in `docs/superpowers/specs/2026-10-23-pmkit-design.md`. The Does column of each row stays as it is.

### Line 330, `issues create`

Before:

```
| `issues create --title t [--type] [--priority] [--estimate] [--assignee] [--label l,..] [--parent] [--sprint] [--due] [--milestone m] [--description-file f] [--criteria-file f]` | creates |
```

After:

```
| `issues create --title t [--type] [--priority] [--estimate] [--assignee] [--label l,..] [--parent] [--sprint id\|current\|none] [--due] [--milestone m] [--description-file f] [--criteria-file f]` | creates |
```

### Line 331, `issues update`

Before:

```
| `issues update <id> [field flags, including --milestone and --branch] [--description-file f] [--criteria-file f] [--check n] [--uncheck n]` | edits fields and criteria |
```

After:

```
| `issues update <id> [--title] [--type] [--priority] [--estimate] [--label l,..] [--sprint id\|current\|none] [--due] [--milestone] [--branch] [--description-file f] [--criteria-file f] [--check n] [--uncheck n]` | edits fields and criteria |
```

The update flag order follows the usage string in `scripts/pmkit.mjs` line 288. The create flag order is unchanged.

## Proof

Run from the repo root. Each command shows what it prints today (before the edit) and what it must print after.

1. Criterion 1. The create row matches the create usage string.
   - `grep -cF 'issues create --title t [--type] [--priority] [--estimate] [--assignee] [--label l,..] [--parent] [--sprint id\|current\|none] [--due] [--milestone m] [--description-file f] [--criteria-file f]' docs/superpowers/specs/2026-10-23-pmkit-design.md` prints `0` now and must print `1` after.
   - `grep -cF -- "--title t [--type] [--priority] [--estimate] [--assignee] [--label l,..] [--parent] [--sprint id|current|none] [--due] [--milestone m] [--description-file f] [--criteria-file f]" scripts/pmkit.mjs` prints `1` now and after, so the CLI usage is the same string.
2. Criterion 2. The update row matches the update usage string.
   - `grep -cF 'issues update <id> [--title] [--type] [--priority] [--estimate] [--label l,..] [--sprint id\|current\|none] [--due] [--milestone] [--branch] [--description-file f] [--criteria-file f] [--check n] [--uncheck n]' docs/superpowers/specs/2026-10-23-pmkit-design.md` prints `0` now and must print `1` after.
   - `grep -cF -- '<id> [--title] [--type] [--priority] [--estimate] [--label l,..] [--sprint id|current|none] [--due] [--milestone] [--branch] [--description-file f] [--criteria-file f] [--check n] [--uncheck n]' scripts/pmkit.mjs` prints `1` now and after.
3. Criteria 1 and 2 together, compared as rendered text. This command reads both files, unescapes `\|` to `|` in the spec, and prints whether each row contains `issues create ` or `issues update ` followed by the usage string from `scripts/pmkit.mjs`. It prints `issues create false` and `issues update false` now, and must print `issues create true` and `issues update true` after. It was run against a copy of the planned rows outside the repo and printed `true` for both.

   ```
   node -e 'const fs=require("fs");const s=fs.readFileSync("docs/superpowers/specs/2026-10-23-pmkit-design.md","utf8").replace(/\\\|/g,"|");const c=fs.readFileSync("scripts/pmkit.mjs","utf8");for(const n of ["issues create","issues update"]){const u=c.match(new RegExp("name: \x27"+n+"\x27[^\\n]*\\n\\s*usage: \x27([^\x27]*)\x27"))[1];console.log(n,s.includes("\x60"+n+" "+u+"\x60"))}'
   ```
4. Criterion 3.
   - `grep -cF '[--sprint]' docs/superpowers/specs/2026-10-23-pmkit-design.md` prints `1` now (line 330) and must print `0` after, with exit code 1.
   - `grep -cF '[--sprint id\|current\|none]' docs/superpowers/specs/2026-10-23-pmkit-design.md` prints `0` now and must print `2` after.
   - `npm test` passes. No test reads the spec, so the count of passing tests equals the count on `main`.
5. Scope check. This branch also carries the claim commit, which changed `.issues/issues/PMK-117/`, so a plain `git diff main` lists those files. Use these two commands instead.
   - `git diff --name-only main...HEAD -- . ':(exclude).issues' ':(exclude).superpowers' ':(exclude)docs/superpowers/specs/2026-10-26-pmk-117-sprint-current-in-design-spec-design.md'` prints nothing now and must print only `docs/superpowers/specs/2026-10-23-pmkit-design.md` after the edit is committed.
   - `git diff -U0 main...HEAD -- docs/superpowers/specs/2026-10-23-pmkit-design.md | grep -c '^[-+]|'` prints `0` now and must print `4` after (two removed rows and two added rows). I confirmed `4` with the planned rows in a copy outside the repo.

## Decisões

- **Spell out the update usage in full.** The row is meant to match the CLI. A phrase like "field flags" cannot match, and it hid the missing `--sprint`.
- **Escape the pipes as `\|`.** An unescaped `|` splits the table cell. The rendered text is identical to the usage string, which is what the criteria compare.
- **Do not touch the Does column.** The wording "creates" and "edits fields and criteria" is still true.
- **Update a spec that PMK-114 left alone.** The PMK-114 spec called the design spec historical and left it alone. This issue updates it on purpose, because PMK-114 raised the gap.
- **Leave `cycle add` out.** Its row is stale too, but the issue and its criteria name only `issues create` and `issues update`. Adding it changes the scope, so it is a follow-up candidate.
- **Do not add a changelog entry or a test.** The edit changes a design document only. The CHANGELOG is written per release (PMK-114 decided the same), and no test reads the spec.
- **Do not add a tool that checks the spec table against the CLI usage.** It would prevent this kind of drift, but it is a feature of its own. See the follow-up candidates.

## Follow-up candidates

- Update the `cycle add` row to `<id...> --to <sprint\|current\|none>`. The usage string already has it, and `cycle add --to current` worked before PMK-114.
- Compare every row of the CLI table in the design spec with the usage strings in `scripts/pmkit.mjs`, in case other rows drifted. This issue checked only the three rows that take a sprint.
- A test that reads the CLI table in the design spec and compares each row with the usage string of the same command. It would catch this drift at `npm test` time. It needs a decision on whether the spec table is a contract or a summary.
