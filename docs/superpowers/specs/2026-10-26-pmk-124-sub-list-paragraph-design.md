# PMK-124: separate the paragraph after a sub-list in pause and spec import

Issue: PMK-124. Origin: PMK-113, which fixed the same defect in `commands/cycle/close.md` step 7.

## Problem

Two command files have an indented paragraph on the line right after a sub-list. Markdown treats that line as a lazy continuation of the last bullet, so the paragraph renders inside that bullet and not as part of step 7.

- `commands/issues/pause.md` line 28, "When the user approves, run the same command without `--dry-run`...". It follows the two bullets about `existing`.
- `commands/spec/import.md` line 29, "When one fails, stop, list what was created...". It follows the numbered sub-items 1 and 2 of step 7.

In both files the paragraph is meant for the whole step. In `pause.md` it covers both bullets. In `import.md` it covers both sub-steps.

The precedent is `commands/cycle/close.md` lines 28 to 33: a blank line after the last bullet, then the paragraph at the same indent (3 spaces).

## Chosen approach

Insert one empty line before each of the two paragraphs. Keep the 3-space indent.

Prove it with a static `awk` check run on the two files. The check fails before the edit and passes after. `npm test` then shows nothing else broke.

### Why the paragraph stays indented

The paragraph has 3 spaces. The step text starts at column 3 (`7. `), so after a blank line the paragraph is a second paragraph of step 7. The last bullet's content starts at column 5, so 3 spaces is not enough to stay inside it. This is the same layout as `close.md`. Removing the indent would end the list and the paragraph would no longer belong to step 7.

## Rejected approaches

1. A new repo-wide test that scans `commands/**/*.md` for this pattern. It is the lasting guard, but the issue names two files and the criteria say no other text changes. A new test file is scope beyond the issue. The scan below shows the pattern exists only in these two files today, so the guard has nothing else to catch yet. Listed as a follow-up.
2. A scenario assertion. The scenarios read the command file only through `parseCommandFile`, which extracts CLI calls and step numbers. It ignores blank lines and rendering, so no scenario can fail on this defect. Changing the scenario runner to check markdown structure is a larger change.
3. No failing check, only the edit and `npm test`. `npm test` passes before and after, so it cannot show the defect. Criteria 1 and 2 would have no proof.

## Before and after

Only blank lines are added. Long lines are cut here with `...`.

### `commands/issues/pause.md`, step 7

Before (lines 27 and 28):

```
   - When `existing` is `true`, the branch already has an open PR, in `pr`. ... Ask once whether to push.
   When the user approves, run the same command without `--dry-run`. When the user declines, skip the push and say the branch is not pushed.
```

After (lines 27 to 29):

```
   - When `existing` is `true`, the branch already has an open PR, in `pr`. ... Ask once whether to push.

   When the user approves, run the same command without `--dry-run`. When the user declines, skip the push and say the branch is not pushed.
```

### `commands/spec/import.md`, step 7

Before (lines 28 and 29):

```
   2. For each new milestone, run `node ... milestone create <id> --name "<name>" [--due <date>] --json` and note its id. ... before step 8.
   When one fails, stop, list what was created and what was not, and do not retry it.
```

After (lines 28 to 30):

```
   2. For each new milestone, run `node ... milestone create <id> --name "<name>" [--due <date>] --json` and note its id. ... before step 8.

   When one fails, stop, list what was created and what was not, and do not retry it.
```

The edit must not touch the text of any other line, and must not change the rest of the file.

## Snapshots

No snapshot changes, so no `UPDATE_GOLDENS=1` run is needed.

- `scripts/scenarios.test.mjs` reads each command file with `parseCommandFile` in `scripts/scenario-helpers.mjs`. The `.after.txt` snapshots hold the CLI calls it finds, their step numbers and the repo changes the scenario makes. They do not hold the command text.
- A blank line matches none of the branches that track step numbers (a heading, a numbered item, a bullet, or a line starting with a non-space character). So the step of every call stays the same.
- Verify it by running `git status --short scripts/` after `npm test`. The output must be empty. If any snapshot changes, stop and read the diff line by line, because the change is not expected. Do not regenerate it without that reading.

## Scan of other command files

Command, run from the repo root. It flags a line that starts with spaces and is not a list item, when the line before it is an indented bullet or numbered item. It covers `commands/` and `skills/`.

```
for f in $(git ls-files 'commands/*.md' 'commands/**/*.md' 'skills/**/*.md'); do
  awk -v F=$f 'prev ~ /^ +([-*]|[0-9]+\.) / && $0 ~ /^ +[^ ]/ && $0 !~ /^ +([-*]|[0-9]+\.) / {print F":"NR": "substr($0,1,50)} {prev=$0}' $f
done
```

Output before the edit:

```
commands/issues/pause.md:28:    When the user approves, run the same command wi
commands/spec/import.md:29:    When one fails, stop, list what was created and
```

Only the two files in the issue match. The scan does not catch a paragraph after a sub-list inside a bullet at deeper indent, or one in another folder such as `docs/`. Those are out of scope.

## How each criterion is proven

Run each command from the repo root.

### Criterion 1: `pause.md` step 7

```
awk 'prev ~ /^ +([-*]|[0-9]+\.) / && $0 ~ /^ +[^ ]/ && $0 !~ /^ +([-*]|[0-9]+\.) / {print FILENAME":"NR} {prev=$0}' commands/issues/pause.md
```

- Before: prints `commands/issues/pause.md:28`.
- After: prints nothing.

```
sed -n 27,29p commands/issues/pause.md | cut -c1-30
```

- After: line 27 starts with `   - When `existing` is`, line 28 is empty, line 29 starts with `   When the user approves`.

### Criterion 2: `import.md` step 7

```
awk 'prev ~ /^ +([-*]|[0-9]+\.) / && $0 ~ /^ +[^ ]/ && $0 !~ /^ +([-*]|[0-9]+\.) / {print FILENAME":"NR} {prev=$0}' commands/spec/import.md
```

- Before: prints `commands/spec/import.md:29`.
- After: prints nothing.

```
sed -n 28,30p commands/spec/import.md | cut -c1-30
```

- After: line 28 starts with `   2. For each new milestone`, line 29 is empty, line 30 starts with `   When one fails`.

### Criterion 3: nothing else changes, tests pass

```
git diff --numstat main -- commands/
```

- After: two lines, `1	0	commands/issues/pause.md` and `1	0	commands/spec/import.md`. Each file gains exactly one line and loses none.

```
git diff -U0 main -- commands/ | grep '^[+-]' | grep -v '^+++\|^---'
```

- After: prints two lines, each a lone `+` (an added empty line).

```
npm test
```

- Before: 1011 tests, 1011 pass, 0 fail.
- After: the same counts, with the `issues-pause` and `spec-import` scenarios among the passes.

```
git status --short scripts/
```

- After: empty, so no snapshot changed.

The implementation should run the `awk` commands first and see them print the two lines (the failing check), then add the blank lines, then run every command above.

## Decisões

1. Insert one empty line, keep the 3-space indent. Reason: it matches `close.md`, and the indent is what keeps the paragraph inside step 7.
2. Prove the criteria with an `awk` check on the two files, not a new test. Reason: it fails before the edit and passes after, it needs no new file, and it stays within the issue's two files. The one-liner can run again at any time.
3. Do not add a scenario assertion. Reason: the scenarios read CLI calls and step numbers only, so they cannot see this defect.
4. Do not add a repo-wide test now. Reason: the scan finds no other instance, so the guard would protect against a future change only. It is a follow-up, not part of the smallest proof of the criteria.
5. No snapshot regeneration. Reason: the parser ignores blank lines and the snapshots hold no command text. A changed snapshot after the edit is a signal to stop and read it.
6. Add the blank line to `import.md` before the paragraph, which follows numbered sub-items, not bullets. Reason: the defect is the same. The issue calls them sub-list bullets, but the `import.md` sub-items are numbered, and the scan pattern covers both.
7. The choices above were made without asking the user, as the stage instructions say. Each is the recommended option.

## Follow-up candidates

- A static test in `scripts/scenarios.test.mjs` (a new rule) that fails when a command file has an indented paragraph right after a sub-list item with no blank line. The scan today finds only the two spots in this issue, so the test would stay green after this fix and catch regressions.
- The same check for `skills/**/*.md` and `docs/`. The scan covered `skills/` and found nothing, and `docs/` was not scanned.
