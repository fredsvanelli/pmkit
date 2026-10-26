# PMK-8 Config Schemas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship JSON Schemas for `.pmkit/config.yaml` and `.issues/config.yaml`, have `init` write a `$schema` line at the top of each, and add a test that fails when a schema and its validator disagree.

**Architecture:** Two hand-written draft-07 schemas under `schemas/`. The validators in `scripts/lib/config.mjs` gain the missing per-key checks and export the constants the schemas mirror. A test helper evaluates the schemas with a small keyword subset and compares its verdict with the validator's over many probe values. `setSchemaLine` in `yaml-edit.mjs` places the line, and `runInit` calls it in both modes.

**Tech Stack:** Node 18+, `node:test`, no dependencies (ADR-0003).

**Spec:** `docs/superpowers/specs/2026-10-25-pmk-8-config-schemas-design.md`

Orchestrator decisions that override the spec:
- Do not edit `CHANGELOG.md`. The PR description suggests the changelog lines (the two schemas, the new validator checks, and a `Setup:` line), and the release writes them.
- Do not run `init --update` on this repository. Run only `node scripts/pmkit.mjs validate` after the validator changes.
- Checking that `pmkit validate` or `init` runs `validatePmkitConfig` is out of scope.

## Global Constraints

- **Schema files:** `schemas/pmkit.config.schema.json` (for `.pmkit/config.yaml`) and `schemas/issues.config.schema.json` (for `.issues/config.yaml`), at the plugin root next to `templates/`.
- **Draft:** `"$schema": "http://json-schema.org/draft-07/schema#"`. No `$id`. Each has `title` and `description` on the root and on every key, and `default` where `DEFAULTS` in `config.mjs` has one.
- **Keywords the evaluator accepts (exact list):** `type`, `enum`, `const`, `pattern`, `minimum`, `maximum`, `minItems`, `items`, `properties`, `required`, `additionalProperties`, `propertyNames`, plus the annotations `$schema`, `title`, `description`, `default`. Any other keyword makes the evaluator throw. `type` may be a string or an array of strings. `integer` means `Number.isInteger`.
- **No `additionalProperties: false` anywhere.** `additionalProperties` holds a schema only for `statuses`, `members` and `defaults`. Under `defaults`, other keys must be integers with `minimum: 1`.
- **Null:** an optional key written with no value (`null`) is invalid on both sides, except `tracker.path`, which is `["string", "null"]` and optional for every tracker.
- **Constants** exported from `scripts/lib/config.mjs`: `TRACKERS` (`local, linear, jira, github, gitlab, azure-devops`), `GIT_HOSTS` (`github, none`), `CONFIRM` (`all_writes, single_writes, none`), `PREVIEW` (`bulk, delete, publish_update, move_scope`), `WEEKDAYS`, `ESTIMATE_UNITS` (`points, hours, sizes`, moved from `scripts/pmkit.mjs`), `PREFIX` (regex), `MEMBER_ID` (regex). `CATEGORIES` stays in `model.mjs` and `ID_STYLES` in `ids.mjs`. The validators and `runInit` use these arrays instead of inline lists.
- **Line format (first line of each file):** `# yaml-language-server: $schema=<url>`
- **URL format:** `https://raw.githubusercontent.com/<owner>/<repo>/main/schemas/<name>`, where `<owner>/<repo>` comes from the `repository` field of `.claude-plugin/plugin.json` (`https://github.com/<owner>/<repo>`) and `<name>` is one of the two schema file names. For this repository: `https://raw.githubusercontent.com/fredsvanelli/pmkit/main/schemas/pmkit.config.schema.json`.
- **Regex for a pmkit schema line** (exported as `schemaLineMatcher(url)` in `scripts/lib/yaml-edit.mjs`): `^#\s*yaml-language-server:\s*\$schema=(\S+)\s*$` finds any schema line. It counts as a pmkit line when its URL matches `^https://raw\.githubusercontent\.com/<owner>/<repo>/[^/\s]+/schemas/(pmkit|issues)\.config\.schema\.json$`, with `<owner>/<repo>` taken from the new URL and any ref.
- **New validator messages, `.issues/config.yaml`:** `version must be a whole number of 1 or more`, `statuses must be a map`, `default_status must be a string`, `labels must be a list of strings`, `estimate must be a map`, `estimate.scale must be a list of numbers or strings`, `members must be a map`, `member <id> must be a map`, `member <id>: name must be a string`, `member <id>: email must be a string`, `defaults must be a map`, `auto_commit must be true or false`.
- **New validator messages, `.pmkit/config.yaml`:** `git_host.repo must be a string`, `git_host.default_branch must be a string`, `write_policy.preview must be a list of bulk, delete, publish_update, move_scope`. `tracker.path` is no longer reported as missing.
- **Shape and cross-field split:** `localConfigShapeProblems(obj)` (exported from `config.mjs`) holds every per-key check. `validateLocalConfig(obj)` returns the shape problems followed by `id_prefix and epic_prefix must differ`, the `category <c> has no status` problems and `default_status must be a status`. The last one runs only when `default_status` is a string.
- **`init --update` failure on an invalid config:** the error message stays `the <file> is not valid: <problems joined by "; ">` and the next step is `Fix <file> by hand, then run init --update again` (`<file>` is the slash-style path, such as `.issues/config.yaml`). A first run keeps `Fix the init flags`.
- **Files that must not change:** `CHANGELOG.md`, `.issues/`, `commands/upgrade.md`, `templates/` (the templates stay without the line).
- **Commit trailer:** every commit message carries the issue ID, for example `feat: add schemas (PMK-8)`, and ends with `Co-Authored-By: Claude <model of the implementer> <noreply@anthropic.com>`, naming the model that made the commit.
- **Tests:** run `node --test scripts/<file>.test.mjs` per task and `npm test` before each commit. A test that creates a temporary directory removes it in `finally`.

## Review Focus

- A schema line that points to another host is left alone by `init --update`, and the file stays byte-equal. Pinned in Task 3.
- A config with CRLF line endings or a BOM gets the line without a stray `\r` or BOM, and no other line changes. Pinned in Task 3.
- An empty config file gets the line plus a trailing newline. Pinned in Task 3.
- `init --update --dry-run` reports `change` for the line and writes nothing. Pinned in Task 3.
- The problem counts in `config.test.mjs` (4 for `validatePmkitConfig`, 8 for `validateLocalConfig`) change on purpose, with the new total written in the test. Pinned in Task 1.
- `null` for every optional key (`id_style`, `labels`, `estimate.scale`, `members`, `defaults`, `auto_commit`, `availability`, `git_host.repo`, `write_policy.preview`) is invalid on both sides, and `tracker.path: null` is valid on both. Pinned in Tasks 1 and 2.
- The evaluator throws on a schema with an unknown keyword. Pinned in Task 2.
- `node scripts/pmkit.mjs validate` still passes on this repository. Checked in Task 1.

---

## File structure

- Modify `scripts/lib/config.mjs`: exported constants, `localConfigShapeProblems`, new checks, looser `tracker.path`.
- Modify `scripts/pmkit.mjs`: import `ESTIMATE_UNITS`, `GIT_HOSTS`; `runInit` writes the line and uses the new `--update` error.
- Modify `scripts/lib/yaml-edit.mjs`: `setSchemaLine`, `schemaLineMatcher`.
- Create `scripts/lib/schema-url.mjs`: `SCHEMA_FILES`, `schemaUrl(file)`.
- Create `schemas/pmkit.config.schema.json`, `schemas/issues.config.schema.json`.
- Create `scripts/json-schema-subset.mjs` (test helper) and `scripts/schemas.test.mjs`.
- Modify tests: `config.test.mjs`, `yaml-edit.test.mjs`, `cli-init.test.mjs`, `plugin.test.mjs`, `tracker-issues.test.mjs` (or the file that already tests `requireWriter`).
- Modify docs: `commands/setup.md`, `README.md`.

---

### Task 1: Exported constants and new validator checks

Complexity: standard
Covers: "A test fails when a schema and its validator disagree" (gives the test a validator that checks the same things as the schema)

**Files:**
- Modify: `scripts/lib/config.mjs`, `scripts/pmkit.mjs:667,708,712`
- Test: `scripts/config.test.mjs`, plus the existing test that asserts a tracker write refuses on a bad config

**Interfaces:**
- Produces: exports from `config.mjs`: `TRACKERS`, `GIT_HOSTS`, `CONFIRM`, `PREVIEW`, `WEEKDAYS`, `ESTIMATE_UNITS`, `PREFIX`, `MEMBER_ID`, `localConfigShapeProblems(obj): string[]`. `validateLocalConfig(obj): string[]` and `validatePmkitConfig(obj): string[]` keep their signatures.

- [ ] **Step 1: Write the failing tests in `scripts/config.test.mjs`.**
  - `localConfigShapeProblems` returns `[]` for a valid config built from `templates/issues.config.yaml`, and does not report `id_prefix and epic_prefix must differ` when both prefixes are equal.
  - One case per new message in Global Constraints, each asserting `problems.includes(<message>)`. Use `auto_commit: 'yes'`, `members: { fred: null }` (gives `member fred must be a map`), `labels: null`, `estimate: { unit: 'points', scale: null }`, `defaults: null`, `git_host.repo: 1`, `write_policy.preview: ['x']`.
  - `validatePmkitConfig` accepts `tracker.path` absent, `null` and `'.issues'` for `system: local`.
  - `validateLocalConfig` still returns `id_prefix and epic_prefix must differ` and `default_status must be a status`.
  - Update the two existing count assertions (`8` at line 88, `4` at line 117) to the new totals, after checking by hand which problems the fixtures now produce. Say in the commit message why the counts changed.
- [ ] **Step 2: Run `node --test scripts/config.test.mjs`.** Expected: FAIL on the missing exports and messages.
- [ ] **Step 3: Implement in `config.mjs`.** Export the constants (`PREVIEW` and `GIT_HOSTS` are new, `ESTIMATE_UNITS` moves from `pmkit.mjs`). Split `validateLocalConfig` into `localConfigShapeProblems` plus the cross-field tail. Add the new checks with the exact messages from Global Constraints. Change `validatePmkitConfig` so `tracker.path` is optional, a string or `null`. Replace inline lists with the constants, in messages too.
- [ ] **Step 4: Update `scripts/pmkit.mjs`.** Import `ESTIMATE_UNITS` and `GIT_HOSTS` from `config.mjs`, delete the local `ESTIMATE_UNITS`, and use `GIT_HOSTS` in the `--git-host` check.
- [ ] **Step 5: Add a test that a tracker write refuses on `auto_commit: "yes"`** with the new message as the first problem and the next step `pmkit validate`, next to the existing `requireWriter` test.
- [ ] **Step 6: Run `npm test` and `node scripts/pmkit.mjs validate`.** Expected: all tests pass, and `validate` reports no problem on this repository.
- [ ] **Step 7: Commit** `feat: export config constants and check every config key (PMK-8)`.

---

### Task 2: The two schemas and the agreement test

Complexity: hard
Covers: "JSON Schemas for `.pmkit/config.yaml` and `.issues/config.yaml` ship with the plugin"; "A test fails when a schema and its validator disagree"

**Files:**
- Create: `schemas/pmkit.config.schema.json`, `schemas/issues.config.schema.json`, `scripts/json-schema-subset.mjs`, `scripts/schemas.test.mjs`
- Modify: `scripts/plugin.test.mjs`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `validateSchema(schema, value): string[]` from `scripts/json-schema-subset.mjs`. It returns error strings with the value path, and throws `Error('unsupported keyword <k> at <path>')` on a keyword outside the list in Global Constraints.

- [ ] **Step 1: Write `scripts/schemas.test.mjs` first.**
  - Evaluator unit tests, one per keyword (type incl. array form and integer, enum, const, pattern, minimum, maximum, minItems, items, properties, required, additionalProperties, propertyNames), and one test that `{ oneOf: [] }` and `{ format: 'x' }` throw.
  - Structural checks: `tracker.system` enum equals `TRACKERS`, `git_host.system` equals `GIT_HOSTS`, `write_policy.confirm` equals `CONFIRM`, `write_policy.preview.items` equals `PREVIEW`, `estimate.unit` equals `ESTIMATE_UNITS`, `id_prefix` and `epic_prefix` pattern equals `PREFIX.source`, `members` `propertyNames` pattern equals `MEMBER_ID.source`, `statuses.*.category` equals `CATEGORIES`, `id_style` equals `ID_STYLES`, `sprint_start_weekday` equals `WEEKDAYS`. Every key path of each template (parsed with `parseYaml`) is a property in its schema.
  - Verdict checks as in the spec section "The agreement test": base config from the template plus member `fred` with `name`, `email`, `availability`; assert the base is valid on both sides; for every key path in the union of template and schema paths, run each probe (list in the spec, plus every enum value from the schema and the constants) through `validateSchema` and through `validatePmkitConfig` or `localConfigShapeProblems`, and assert equal verdicts. Map-keyed objects (`statuses`, `members`, `defaults`) also get a new key per probe, and `members` a key that breaks `MEMBER_ID`. The assertion message names the file, the key path, the probe, and each verdict.
  - Include `tracker.path: null` (valid on both) and `null` for each optional key (invalid on both).
  - A drift check: mutate a copy of the `issues` schema (drop `sizes` from `estimate.unit`, add `labels` to `required`) and assert the verdict function reports a mismatch. This proves the test can fail.
- [ ] **Step 2: Add to `plugin.test.mjs`:** both schema files exist and parse as JSON; `plugin.json` `repository` matches `^https://github\.com/[^/]+/[^/]+$`.
- [ ] **Step 3: Run `node --test scripts/schemas.test.mjs scripts/plugin.test.mjs`.** Expected: FAIL (missing files).
- [ ] **Step 4: Implement `validateSchema`** in `scripts/json-schema-subset.mjs` following draft-07 semantics for the listed keywords only. `additionalProperties` applies to keys absent from `properties`.
- [ ] **Step 5: Write the two schemas** from the tables in the spec (sections "`.pmkit/config.yaml`" and "`.issues/config.yaml`"). `.issues` `version`: `integer`, `minimum: 1`. `members.<id>` is the `additionalProperties` schema of `members`, with `availability` `minimum 0`, `maximum 1`. Fix any validator/schema disagreement the test finds on the validator side, in `config.mjs`, unless the rule cannot be expressed in the listed keywords.
- [ ] **Step 6: Run `npm test`.** Expected: PASS.
- [ ] **Step 7: Commit** `feat: add JSON Schemas for both config files and an agreement test (PMK-8)`.

---

### Task 3: `setSchemaLine` and `runInit`

Complexity: standard
Covers: "Setup writes the `$schema` line at the top of each file"

**Files:**
- Create: `scripts/lib/schema-url.mjs`
- Modify: `scripts/lib/yaml-edit.mjs`, `scripts/pmkit.mjs` (`runInit`)
- Test: `scripts/yaml-edit.test.mjs`, `scripts/cli-init.test.mjs`

**Interfaces:**
- Produces: `schemaUrl(file: 'pmkit.config.schema.json' | 'issues.config.schema.json'): string` and `SCHEMA_FILES = { pmkit: 'pmkit.config.schema.json', issues: 'issues.config.schema.json' }` in `schema-url.mjs`. `setSchemaLine(text: string, url: string): string` and `schemaLineMatcher(url)` in `yaml-edit.mjs`.

- [ ] **Step 1: Write failing tests in `yaml-edit.test.mjs`** for `setSchemaLine`: no line inserts it first and keeps the rest byte-equal; an old pmkit URL with another ref is replaced in place; a line with another host returns the text unchanged; empty text gives `<line>\n`; a text starting with another comment still gets the line first; CRLF and a BOM come out normalized with the line first and no `\r`; calling it twice gives the same text.
- [ ] **Step 2: Write failing tests in `cli-init.test.mjs`:** a first run writes both files with the right line first and the template after it (compare with `parseYaml` equality and a first-line check); `--update` on a config without the line changes only that line (use `lineDiff` against the old text); `--update` on a config with the current line reports `keep` for both files; an old-ref line is replaced; a line for another host is left alone; `--update --dry-run` reports `change` and the files are byte-equal afterwards; `--update` on a config holding `auto_commit: "yes"` exits with the new error, writes nothing, and the next step names `.issues/config.yaml` and says `init --update again`. Temp directories go through `tmp()` and are removed in `finally`.
- [ ] **Step 3: Run `node --test scripts/yaml-edit.test.mjs scripts/cli-init.test.mjs`.** Expected: FAIL.
- [ ] **Step 4: Implement `schemaUrl`** (reads `.claude-plugin/plugin.json` relative to `import.meta.url`, builds the URL from Global Constraints, throws a clear error when `repository` is not a GitHub URL) and **`setSchemaLine`** (three branches, using `split`/`join` so normalization matches the rest of the file).
- [ ] **Step 5: Call `setSchemaLine` in `runInit`** on both files after the other edits and before validation, in both modes. Change the validation error: in `--update` mode the next step is `Fix <file> by hand, then run init --update again`.
- [ ] **Step 6: Run `npm test`.** Expected: PASS.
- [ ] **Step 7: Commit** `feat: write the schema line in init and init --update (PMK-8)`.

---

### Task 4: Docs

Complexity: mechanical
Covers: "Setup writes the `$schema` line at the top of each file" (setup text explains the new diff); "JSON Schemas ... ship with the plugin" (README)

**Files:**
- Modify: `commands/setup.md`, `README.md`

- [ ] **Step 1: `commands/setup.md`.** In "First run" step 7, add one sentence: the first line of each config file points editors at the pmkit schema and the CLI ignores it. In "Existing config" step 4, add one sentence: a one-line `change` on the first line is the schema line, and say that `init --update` refuses when a config fails a validator check and names the file to fix. Keep the file's style and count of numbered steps.
- [ ] **Step 2: `README.md`.** Add a short paragraph on editor support under "Commands" or "CLI": schemas live in `schemas/`, setup writes the `# yaml-language-server: $schema=` line, and the Red Hat YAML extension (VS Code) or a JetBrains IDE uses it. Say the line points at `main` on GitHub.
- [ ] **Step 3: Run `npm test`** (the docs tests check command files). Expected: PASS.
- [ ] **Step 4: Final check.** Run `node scripts/pmkit.mjs validate` and `git status`. Expected: no problems, and `CHANGELOG.md` and `.issues/` unchanged.
- [ ] **Step 5: Commit** `docs: explain the schema line in setup and README (PMK-8)`.

---

## Self-review

- Spec coverage: schemas (Task 2), validator changes and constants (Task 1), line and `runInit` (Task 3), tests listed in "Other tests" (Tasks 1 to 3), docs (Task 4). The CHANGELOG items are left to the PR description by decision.
- Tracker-write refusal test, `plugin.test.mjs` checks and the drift check are in Tasks 1 and 2.
- Names used across tasks: `localConfigShapeProblems`, `validateSchema`, `setSchemaLine`, `schemaUrl`, `SCHEMA_FILES`.
