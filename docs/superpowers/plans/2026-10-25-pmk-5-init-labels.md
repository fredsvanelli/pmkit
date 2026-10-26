# PMK-5: init labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `init` add labels to the Local tracker's `labels` list, and let `/pmkit:setup` offer the `needs-criteria` label.

**Architecture:** `init` gets a repeatable `--label` flag. `runInit` in `scripts/pmkit.mjs` appends new names with `setScalar` on the `labels` flow list, so comments and key order stay. `commands/setup.md` asks the question and passes the flag. When the tracker's `labels` list is empty and issues already use labels, setup passes those labels too, so `validate` keeps passing.

**Tech Stack:** Node 18+ ES modules with no dependencies, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-25-pmk-5-init-labels-design.md`. The empty-list rule in "Global Constraints" comes from the orchestrator and extends the spec.

## Global Constraints

- Flag: `--label <name>`, repeatable, each value may hold commas. Parse with the existing `csv(ctx.list('label'))` helper in `scripts/pmkit.mjs`. Add `'label'` to the `flags` list of `init`.
- It works with and without `--update`. Without `--update` it fills `labels` in the generated config. With `--update` it appends to the existing list.
- It only adds. A name already in `labels` is skipped without error. A name repeated inside the flag counts once. Order: existing labels first, then new ones in flag order.
- Name regex: `^[a-z0-9][a-z0-9_-]*$`. A name that fails exits with code 2 (`usageError`). The message names the value and the rule: `label "<value>" must match ^[a-z0-9][a-z0-9_-]*$, like needs-criteria`.
- Write with `setScalar(local, ['labels'], [...existing, ...added])`, wrapped in the existing `edit(issuesConfig, 'labels', ...)` helper. A block-style `labels:` list fails with `INVALID_INPUT`, a message naming `.issues/config.yaml` and `labels`, and the hint to edit by hand. Skip the write when nothing is new.
- `validateLocalConfig` runs after the edit, as for the other flags.
- Text output adds `labels added: a, b` and `labels kept as they were: c`, each line only when its list is not empty, placed after the `members kept as they were:` line. `--json` adds `labelsAdded` and `labelsKept` (arrays of strings, `[]` when empty) to `data`. `--dry-run` shows the same diff as every other `init` change and writes nothing.
- Usage line gains `[--label name ...]`, placed after `[--estimate-unit points|hours|sizes]`. The README row for `init` gains `--label name` in its flags.
- Do not edit `CHANGELOG.md`. The CHANGELOG is written at release.
- Setup question text: "Add the `needs-criteria` label?" with yes first and marked "(Recommended)". Declining changes nothing and setup says in one line that `/pmkit:spec:import` then lists those issues under "needs criteria".
- Empty `labels` rule: `labels: []` allows any label (`scripts/lib/validate.mjs`). When `labels` is empty and issues carry labels, setup passes those labels in the same `init` call, one `--label` per name, together with `needs-criteria`. Setup lists labels in use with `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --archived --json`, taking the union of `issues[].labels`. `--archived` adds archived issues to the result, and `validate` checks those too. No new command. When the user declines, setup warns that adding the first label later makes `validate` reject issues that use other labels, and names the labels in use.
- Tests: `node --test scripts/cli-init.test.mjs`, then `npm test` before each commit. Tests that create directories use `tmp()` and remove them in `finally` (`fs.rmSync(dir, { recursive: true, force: true })`).
- Every commit message carries the issue ID, for example `feat: add init --label (PMK-5)`, and ends with `Co-Authored-By: Claude <model of the implementer> <noreply@anthropic.com>`, naming the model that made the commit.
- Code, tests and docs are in English. Do not edit `.issues/` by hand.

## Review Focus

1. Comments and key order in `.issues/config.yaml` survive `init --update --label`, including a trailing comment on the `labels:` line. Pinned in Task 1.
2. A label already in the list, or repeated in the flag, appears once and is reported as kept, with no error. Pinned in Task 1.
3. An invalid name (`Bad`, `-x`, `a b`, empty after a comma is dropped) exits 2 and changes no file. Pinned in Task 1.
4. `--dry-run` writes nothing and reports the diff and `labelsAdded`. Pinned in Task 1.
5. A block-style `labels:` list fails with the by-hand hint and changes no file. Pinned in Task 1.
6. `init --label` without `--update` fills the generated config, and the existing "refuses to overwrite" behavior is unchanged. Pinned in Task 1.
7. Setup passes existing labels with `needs-criteria` when `labels` is empty, and the question is skipped when `needs-criteria` is already listed. Checked by reading `commands/setup.md` in Task 2.

---

### Task 1: `init --label` in the CLI

Complexity: standard

Covers: `init --update` adds labels from a flag and keeps the existing labels and comments

**Files:**
- Modify: `scripts/pmkit.mjs` (`init` entry near line 184, `runInit` near line 700)
- Modify: `scripts/cli-init.test.mjs`
- Modify: `README.md` (the `init` row, line 45)

**Interfaces:**
- Consumes: `csv`, `setScalar`, `edit`, `parsedLocal`, `usageError`, `validateLocalConfig`, already in `scripts/pmkit.mjs`.
- Produces: the `--label` flag of `init`, and `data.labelsAdded` and `data.labelsKept` in the `--json` result. Task 2 relies on the flag name and on the validation message.

- [ ] **Step 1: Write the failing tests** in `scripts/cli-init.test.mjs`, using the existing `run`, `json`, `tmp`, `read` and `hashTree` helpers. Each test removes its directories in `finally`.
  - `--label on a first run fills labels from repeated and comma-separated flags`: `init --label a --label b,c --label a` gives `labels` equal to `['a', 'b', 'c']` in the parsed config and `labelsAdded` equal to `['a', 'b', 'c']`, `labelsKept` equal to `[]`.
  - `--update --label appends and keeps existing labels, comments and key order`: after `init`, replace `labels: []` with `labels: [bug-report] # shown in the board` and add a `# keep me` comment line above `types:`. Run `init --update --label needs-criteria,bug-report`. Assert the `labels` line is exactly `labels: [bug-report, needs-criteria] # shown in the board`, the `# keep me` line is present, the key order from `Object.keys(parseYaml(...))` is unchanged, `labelsAdded` is `['needs-criteria']` and `labelsKept` is `['bug-report']`.
  - `--label text output lists added and kept labels`: stdout of `init --update --label x,y` (labels already `[x]`) contains `labels added: y` and `labels kept as they were: x`.
  - `an invalid label exits 2 and writes nothing`: for `Bad`, `-x` and `a b`, `init --update --label <value> --json` exits 2, the error message contains the value and `^[a-z0-9][a-z0-9_-]*$`, and `hashTree(dir)` is unchanged.
  - `--update --label --dry-run writes nothing and reports the diff`: `hashTree` unchanged, the `.issues/config.yaml` entry has action `change` with a `diff` containing `+labels: [needs-criteria]`, and `labelsAdded` is `['needs-criteria']`.
  - `a block-style labels list fails with the by-hand hint`: rewrite the file with `labels:\n  - bug-report`, run `init --update --label x --json`, expect exit 2, code `INVALID_INPUT`, message matching `/\.issues\/config\.yaml/` and `/labels/`, `nextStep` matching `/by hand/`, and `hashTree` unchanged.
  - `init --label without --update still refuses an existing setup`: a second `init --label a` exits 2 with code `CONFLICT`.
- [ ] **Step 2: Run** `node --test scripts/cli-init.test.mjs`. Expected: the new tests FAIL (unknown flag `label`), the older ones pass.
- [ ] **Step 3: Implement** in `scripts/pmkit.mjs`.
  - Add `'label'` to `flags` and `[--label name ...]` to `usage` of the `init` entry.
  - Add `function initLabels(ctx): string[]` next to `initMembers`. It returns `csv(ctx.list('label'))`, deduplicated in order, and throws `usageError` for a name outside the regex. Call it with the other checks at the top of `runInit`, before any file is read.
  - After the members loop, compute `labelsKept` and `labelsAdded` against `parsedLocal().labels ?? []` (empty on a first run from the template). When `labelsAdded` is not empty, run `local = edit(issuesConfig, 'labels', () => setScalar(local, ['labels'], [...current, ...labelsAdded]))`.
  - Add `labelsAdded` and `labelsKept` to `data`, and the two text lines from Global Constraints.
- [ ] **Step 4: Update** the `init` row in `README.md` to add `--label name` to the flags list. The `init --update` row stays.
- [ ] **Step 5: Run** `node --test scripts/cli-init.test.mjs`, then `npm test`. Expected: all PASS.
- [ ] **Step 6: Commit**

```bash
git add scripts/pmkit.mjs scripts/cli-init.test.mjs README.md
git commit -m "feat: add init --label (PMK-5)" -m "Co-Authored-By: Claude <model> <noreply@anthropic.com>"
```

---

### Task 2: Offer `needs-criteria` in `/pmkit:setup`

Complexity: mechanical

Covers: `/pmkit:setup` offers the `needs-criteria` label

**Files:**
- Modify: `commands/setup.md`
- Test: `scripts/plugin.test.mjs` (only if it already checks command files; run it, add nothing otherwise)

**Interfaces:**
- Consumes: `init --label` from Task 1, `discover --json` (`labels`) and `issues list --archived --json` (`issues[].labels`).
- Produces: none.

- [ ] **Step 1: Edit "Parameters"** to list the label question among the inputs setup asks.
- [ ] **Step 2: Edit "First run".** Step 4 becomes "only these five questions" and gains the question "Add the `needs-criteria` label?" with the reason that `/pmkit:spec:import` marks requirements without acceptance criteria with it. Steps 6 and 8 add `--label needs-criteria` when the answer is yes. Step 7 lists the labels. A new tracker has no issues, so no labels in use are passed.
- [ ] **Step 3: Edit "Existing config".** Before step 3, read `labels` from `discover --json`. When it holds `needs-criteria`, skip the question. Otherwise ask it once with `AskUserQuestion`. On yes, step 3 (dry run), the write in step 7 and the summary add `--label needs-criteria`. When `labels` is empty, also run `issues list --archived --json`, take the union of `issues[].labels` and pass each as `--label` in the same calls, so `validate` keeps passing. Say which labels setup adds besides `needs-criteria`. On no, add one line: `/pmkit:spec:import` then lists those issues under "needs criteria"; and when `labels` is empty and issues use labels, warn that adding the first label later makes `validate` reject issues that use other labels, naming them.
- [ ] **Step 4: Edit "Confirmation points"** to name the new question as an input, in both paths, not a confirmation.
- [ ] **Step 5: Verify.** Run `grep -n "needs-criteria\|--label" commands/setup.md`, and expect matches in the first run, the existing config and the confirmation points. Run `npm test`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add commands/setup.md
git commit -m "docs: offer needs-criteria label in setup (PMK-5)" -m "Co-Authored-By: Claude <model> <noreply@anthropic.com>"
```
