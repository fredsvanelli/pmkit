# PMK-8: JSON Schemas for both config files

Design for PMK-8 in epic EPC-1 ("Local tracker: close the gaps of 0.1.0"). Claude wrote it in an autonomous brainstorming session on 2026-10-25, with no human available. Every decision below is Claude's call, taken from the issue, the code, `CONTEXT.md` and the ADRs. The user has not confirmed any of them.

The issue quotes a Technical spec that is not in the repository: "The build exports both to JSON Schema, and `setup` adds a `# yaml-language-server: $schema=…` line at the top of each file". That sentence is the source for this design.

## Why

`.pmkit/config.yaml` and `.issues/config.yaml` are edited by hand. Today the user learns about a typo in an enum value or a wrong type only when a command fails or `pmkit validate` reports it. A JSON Schema lets an editor with a YAML language server (the Red Hat YAML extension in VS Code, JetBrains IDEs) complete keys, list the allowed values and mark a bad value while the user types. The `# yaml-language-server: $schema=<url>` comment on the first line tells the editor which schema to use, with no editor setting.

The schemas only help if they say the same thing as the CLI. A schema that accepts what `pmkit validate` rejects, or the reverse, teaches the user wrong rules. So the work is the two schema files, the line that points to them, and a test that keeps each schema in step with its validator.

## Acceptance criteria

From the issue:

1. JSON Schemas for `.pmkit/config.yaml` and `.issues/config.yaml` ship with the plugin.
2. Setup writes the `$schema` line at the top of each file.
3. A test fails when a schema and its validator disagree.

## Goals

- Two JSON Schema files in the plugin, one per config file.
- `init` writes the `$schema` line on a first run, and `init --update` adds or fixes it in an existing config, without touching any other line.
- The line shows in the dry run like any other change, so `/pmkit:setup` previews it.
- A test that fails on the usual kinds of drift: an enum changed on one side, a field checked on one side only, a key required on one side only, a schema keyword the test cannot evaluate.

## Non-goals

- No registration in SchemaStore. Its catalog matches files by name, and the issue asks for the line in the file.
- No JSON Schema library and no build step (ADR-0003).
- `pmkit validate` does not start checking `.pmkit/config.yaml`, and `init` does not start running `validatePmkitConfig`. Both are worth doing and are separate issues.
- `/pmkit:upgrade` does not edit project config files. It keeps its rule ("It never edits the project config").
- The cross-field rules of `.issues/config.yaml` stay out of the schema. JSON Schema cannot say "`default_status` names a key of `statuses`" or "every category has a status".

## Anti-goals

- The CLI never needs the network or the schema files to run. The schemas are for editors only.
- `init --update` never rewrites a `$schema` line that points somewhere other than pmkit. A user who chose another schema keeps it.
- A schema never rejects a config that its validator (`validatePmkitConfig` or `validateLocalConfig`) accepts, and never accepts a value of a known key that its validator rejects. The cross-field rules are the one named exception.

## Constraints

- Node 18+, no dependency in `package.json` (ADR-0003, enforced by `plugin.test.mjs`).
- The plugin installs from the marketplace `fredsvanelli/skills`, whose `pmkit` entry has a `github` source `fredsvanelli/pmkit` with no `ref` (PMK-110). An install is the repository's `main` branch at the time of install. The repository has no git tags today.
- Config files keep their comments and key order. `init --update` edits only the lines it must (`scripts/lib/yaml-edit.mjs`).
- The YAML parser (`scripts/lib/yaml.mjs`) ignores comment lines, so a first-line comment changes nothing for the loader, `validate` or `migrate`.

## Current state

What the validators accept today, read from `scripts/lib/config.mjs`:

- `validatePmkitConfig` checks `version` (must be 1), `tracker.system` (one of 6), `tracker.path` (a string, required when the tracker is `local`), `git_host.system` (`github` or `none`), `write_policy.confirm` (one of 3) and `write_policy.preview` (a list). Only tests call it. `loadConfig` does its own lighter checks and defaults `tracker.path` to `.issues` when it is missing.
- `validateLocalConfig` checks the prefixes, `id_style`, each status's category, that every category has a status, `default_status`, `types`, `priorities`, `estimate.unit`, member ids and `availability`, and every key under `defaults`. `pmkit validate` runs it on the raw file, without defaults, so a file missing `types` or `epic_prefix` is a problem there. `init` runs it on the file it is about to write. The tracker runs it on the config with defaults applied.
- Neither validator rejects an unknown key, at any level.
- Some keys the CLI uses are not checked: `labels`, `estimate.scale`, member `name` and `email`, `auto_commit`, `git_host.repo`, `git_host.default_branch`, the items of `write_policy.preview`. A member written as `fred:` with no value passes, and so does `auto_commit: "yes"`, which the CLI then reads as off (`auto_commit !== true`).
- The templates in `templates/` hold every key setup writes.

## Approaches considered

### A. Hand-written schemas, checked against the validators by a test (chosen)

Two JSON files written by hand and committed under `schemas/`. A test file runs every config the test can build through both the validator and a small JSON Schema evaluator that lives in the test code, and fails when the two verdicts differ. A second check compares each schema enum and pattern with the constant the validator uses.

Cost: two descriptions of the same rules, kept equal by the test rather than by construction. The test catches drift only on keys it knows about, which are the keys of the templates and of the schemas. A rule added to the validator for a key that is in neither escapes it until the key reaches the template. The evaluator is about 80 lines of test code and supports only the keywords the schemas use.

### B. One shape description, a generator script, validators and schemas both built from it

A JS module describes each key (type, enum, pattern, required). A repo script `scripts/schemas.mjs` writes `schemas/*.json` from it, and the validators read the same module. A test regenerates the schemas and fails when the committed files differ.

Cost: both validators are rewritten around a new description format, and their messages come from it, so `pmkit validate` output changes. The cross-field rules still need hand-written code next to the description. The "build" of the source sentence becomes a script someone must remember to run, and the freshness test only proves the committed files match the generator, not that the hand-written cross-field code agrees. Too much rewrite for a priority-low, estimate-3 issue, and the closest thing to a build that ADR-0003 avoids.

### C. The schema is the source, and the validator evaluates it at runtime

The CLI ships a small JSON Schema evaluator in `scripts/lib/` and validates both files against the schemas, plus code for the cross-field rules.

Cost: a schema evaluator becomes production code that must produce messages as clear as today's ("id_prefix must be 2 to 5 capital letters"). Every message changes or needs a custom keyword to carry it, and the tests that assert messages change with it. It removes drift by construction, but it moves the risk into the evaluator.

A is the cheapest change that meets the criteria. It keeps the validators and their messages, adds no build, and the test it needs is the same test B and C would want anyway.

## Design

### Schema files

Two files at the plugin root, next to `templates/`:

- `schemas/pmkit.config.schema.json` for `.pmkit/config.yaml`
- `schemas/issues.config.schema.json` for `.issues/config.yaml`

They ship because the plugin is the repository folder. Both declare `"$schema": "http://json-schema.org/draft-07/schema#"`, carry a `title` and a `description` on the root and on each key (the editor shows them on hover), and carry a `default` where `DEFAULTS` in `config.mjs` has one. They have no `$id`, so the files hold no URL or version that a release would need to change.

The schemas use only these keywords, which the test evaluator supports: `type`, `enum`, `const`, `pattern`, `minimum`, `maximum`, `minItems`, `items`, `properties`, `required`, `additionalProperties`, `propertyNames`, plus the annotations `$schema`, `title`, `description` and `default`. A key that is optional in the file is left out of `required`. An optional key with the value `null` (written `key:` with nothing after it) is invalid on both sides, with one exception, `tracker.path`, which accepts `null` as `loadConfig` does. Today the validators already reject `null` for `id_style`, `availability` and `write_policy.preview`. For `labels`, `estimate.scale`, `members`, `defaults` and `auto_commit` they accept it, and the new checks below are what make it invalid. Each of those `null` values breaks a reader today: `withLocalDefaults` keeps the `null`, and `valueProblems` then calls `local.labels.length`.

Unknown keys stay allowed. Neither validator rejects them today, the design spec plans new keys (`tracker.scope`, `mappings`), and a config written by a newer pmkit must not fail an older one. So no object sets `additionalProperties: false`. `additionalProperties` holds a schema only for the maps whose keys the user picks: each status under `statuses`, each member under `members`, and `defaults`, where the validator already checks every key. Under `defaults`, known keys get their own schema, and any other key must be an integer of 1 or more, as the validator says.

#### `.pmkit/config.yaml`

| Key | Schema | Required |
|---|---|---|
| `version` | `const: 1` | yes |
| `tracker` | object | yes |
| `tracker.system` | enum of `TRACKERS` | yes |
| `tracker.path` | string or null | no |
| `git_host` | object | yes |
| `git_host.system` | enum `github`, `none` | yes |
| `git_host.repo` | string | no |
| `git_host.default_branch` | string | no |
| `write_policy` | object | yes |
| `write_policy.confirm` | enum of `CONFIRM` | yes |
| `write_policy.preview` | array of enum `bulk`, `delete`, `publish_update`, `move_scope` | no |

#### `.issues/config.yaml`

| Key | Schema | Required |
|---|---|---|
| `version` | integer, minimum 1 | yes |
| `id_prefix`, `epic_prefix` | string, pattern `PREFIX` | yes |
| `id_style` | enum of `ID_STYLES` | no |
| `statuses` | object, each value an object with `category` (enum of `CATEGORIES`, required) | yes |
| `default_status` | string | yes |
| `types`, `priorities` | array of strings, `minItems: 1` | yes |
| `labels` | array of strings | no |
| `estimate` | object | yes |
| `estimate.unit` | enum `points`, `hours`, `sizes` | yes |
| `estimate.scale` | array of numbers or strings | no |
| `members` | object, `propertyNames` pattern `MEMBER_ID` | no |
| `members.<id>` | object with `name` (string), `email` (string), `availability` (number, 0 to 1), all optional | n/a |
| `defaults` | object; `sprint_start_weekday` enum of `WEEKDAYS`; the five day counts and any other key integer, minimum 1 | no |
| `auto_commit` | boolean | no |

The `version` key is the tracker format. The schema checks only that it is a whole number of 1 or more. Whether it matches the CLI's `FORMAT_VERSION` is the loader's job, and a schema on `main` cannot know which CLI the user runs.

### Validator changes

The test needs a validator function that checks the same things the schema can express. Today's validators differ from the schema above in two ways, and the design closes both on the validator side.

**The cross-field rules split out.** `config.mjs` exports `localConfigShapeProblems(obj)`, which holds every per-key check of `validateLocalConfig`. `validateLocalConfig(obj)` returns the shape problems followed by the cross-field rules: `id_prefix` and `epic_prefix` differ, every category has a status, `default_status` names a status. Its callers do not change. The test compares the schema with `localConfigShapeProblems` only.

**The unchecked keys get checks.** Each one is a value the CLI reads and can misuse, so the new check catches a real fault. The new messages, in the style of the current ones:

- `.issues/config.yaml`: `version must be a whole number of 1 or more`, `statuses must be a map`, `default_status must be a string`, `labels must be a list of strings`, `estimate must be a map`, `estimate.scale must be a list of numbers or strings`, `members must be a map`, `member <id> must be a map`, `member <id>: name must be a string`, `member <id>: email must be a string`, `defaults must be a map`, `auto_commit must be true or false`.
- `.pmkit/config.yaml`: `git_host.repo must be a string`, `git_host.default_branch must be a string`, `write_policy.preview must be a list of bulk, delete, publish_update, move_scope`.

The `version` check never fires in practice, because the loader and `validateRepo` check the format before `validateLocalConfig` runs. It is there so the shape function is complete.

One check gets looser. In `validatePmkitConfig`, `tracker.path` becomes optional for every tracker, and when present it is a string or `null`. That is what `loadConfig` accepts (it falls back to `.issues` for both), and it keeps an `if`/`then` out of the schema.

`config.mjs` exports the constants the schemas mirror: `TRACKERS`, `GIT_HOSTS` (`github`, `none`), `CONFIRM`, `PREVIEW`, `WEEKDAYS`, `ESTIMATE_UNITS`, `PREFIX`, `MEMBER_ID`. `ESTIMATE_UNITS` moves there from `scripts/pmkit.mjs`, and `runInit` imports it and `GIT_HOSTS` instead of its inline lists. `CATEGORIES` and `ID_STYLES` are already exported from `model.mjs` and `ids.mjs`. The validators use these constants instead of inline lists, so the list in a message and the list in the check are the same array.

#### Effect on writes and on `init --update`

The new checks live in `validateLocalConfig`, so they reach every caller, not only `pmkit validate`:

- `requireWriter` in `scripts/lib/local/tracker.mjs` refuses every tracker write while the config has a problem, with the first problem and the next step `pmkit validate`. A config holding `auto_commit: "yes"` or a member written as `fred:` refuses writes after the upgrade until the user fixes the line.
- `runInit` validates the file it is about to write, in both modes. With `--update`, a hand-edited config that fails a new check stops `init --update` before it writes anything, the `$schema` line included.

This is on purpose. One validator decides what a valid config is, the schema matches it, and each new check names a value that a reader already misuses or crashes on. A second, softer list that only `validate` reports would give the schema two validators to agree with. Two changes keep the cost low:

- In `--update` mode, the `runInit` error names the file to fix and the next step "Fix `<file>` by hand, then run init --update again". Today it says "Fix the init flags", which is wrong when the problem is a line the user wrote.
- The release changelog lists each new check in its section, and `commands/setup.md` "Existing config" step 2 already shows `validate` problems before the update, so the user sees them before `init --update` refuses.

### The `$schema` line

The first line of each config file is:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/fredsvanelli/pmkit/main/schemas/pmkit.config.schema.json
```

and the same with `issues.config.schema.json` for `.issues/config.yaml`.

The URL is built at runtime from the `repository` field of `.claude-plugin/plugin.json` (`https://github.com/<owner>/<repo>`), the branch `main` and the schema's path. A fork that changes `repository` points its users at its own schemas.

A path to the plugin folder cannot work. The file is committed and shared, and the plugin lives in each user's home folder, at a path that differs per machine and per version. So the URL is remote.

It points at `main`, not at a version tag:

- Installs come from `main` (the marketplace source has no `ref`), so `main` holds the schemas of the latest plugin, which is what `/pmkit:upgrade` installs.
- The repository has no tags, and nothing in the release process creates them. A tag URL would return 404 until someone pushes the tag, and the editor would show a load error on every config file in the meantime.
- The line never changes between versions, so `init --update` does not show a diff on both config files after every upgrade, and `/pmkit:upgrade` keeps its rule of not touching project config.

The cost: a user who has not upgraded sees the newest schema. Unknown keys are allowed, so a new key never marks their file. A rule that gets stricter on `main` can mark a value their older CLI still accepts. That is an editor warning, not a failure, and `/pmkit:upgrade` ends it. If the project later tags releases, switching the URL to the tag is one constant plus a `Setup:` line in the changelog.

The schema file paths become a public URL. A test asserts that each file the URL names exists in the repository, so a rename fails the build of the PR that makes it.

### Who writes the line

One function in `scripts/lib/yaml-edit.mjs`, `setSchemaLine(text, url)`, returns the text with the line in place:

1. When a line matches `^#\s*yaml-language-server:\s*\$schema=(\S+)` and its URL is a pmkit schema URL (the `raw.githubusercontent.com/<owner>/<repo>/<ref>/schemas/<name>.schema.json` shape for this repository, any ref), the function replaces that line with the new one, where it is.
2. When such a line exists but points elsewhere, the function returns the text unchanged.
3. Otherwise it inserts the line before the first line.

Every other line, comment, blank line and the trailing newline stay as they are. The function works on the normalized text (`\r\n` to `\n`, BOM dropped), as the rest of `yaml-edit.mjs` does.

The templates stay as they are, with no line. `runInit` calls `setSchemaLine` on both files, after the other edits, in both modes:

- First run: the files are `create`, and their content starts with the line.
- `init --update`: a config with no line, or with an old pmkit URL, shows as `change` with a one-line diff. A config already holding the current line is `keep` (when nothing else changed). This is how existing setups get the line: the PR's changelog section adds a `Setup:` line, and `/pmkit:upgrade` already suggests `/pmkit:setup` for each `Setup:` reason.
- `--dry-run` writes nothing and lists the same actions and diffs, through the code that exists today.

`init --update` reads the tracker path from `.pmkit/config.yaml` as today. The line does not change how either file parses.

`commands/setup.md` gets one sentence in each flow, so the agent can explain the new diff: the first line points editors at the pmkit schema, and the CLI ignores it. `commands/upgrade.md` does not change.

### The agreement test

A new test file, `scripts/schemas.test.mjs`, and a test helper `scripts/json-schema-subset.mjs` (not a `.test.mjs`, like `contract-suite.mjs`).

**The evaluator.** `validateSchema(schema, value)` returns a list of errors for the keywords listed above, following draft-07 semantics for them. `integer` means `Number.isInteger`. It throws on any keyword outside the list, so a schema that starts using `if`, `oneOf` or `format` fails the test with a clear message instead of passing unchecked. A few unit tests in `schemas.test.mjs` cover each keyword.

**Structural checks.** Each schema enum and pattern equals the constant its validator uses: `tracker.system` with `TRACKERS`, `estimate.unit` with `ESTIMATE_UNITS`, `id_prefix` with `PREFIX.source`, `statuses.*.category` with `CATEGORIES`, and so on for every enum and pattern in both schemas. Every key path of each template is a property in its schema, so a key setup writes always has editor completion.

**Verdict checks.** For each config file, the test builds a base config from the template, plus one member `fred` with `name`, `email` and `availability` so the member keys have values to change. The base must be valid on both sides. Then, for each key path in the union of the template's paths and the schema's property paths, the test builds one config per probe value and runs it through the schema evaluator and the shape validator (`validatePmkitConfig`, or `localConfigShapeProblems`). The two verdicts, valid or invalid, must be equal. On a mismatch, the assertion message names the file, the key path, the probe and each side's verdict.

The probes are: the key absent, `null`, `''`, `'x'`, `0`, `1`, `-1`, `0.5`, `true`, `[]`, `['x']`, `[1]`, `{}`, `{ x: 1 }`, every value of every enum in the schema and in the exported constants, and strings that test the patterns (`AB`, `ABCDEF`, `ab`, `agent:claude`, `Fred`). For a map keyed by user names (`statuses`, `members`, `defaults`), the test also adds one new key with each probe as its value, and for `members` a key that breaks `MEMBER_ID`.

The verdict compares valid against invalid, not messages, so the schema's wording is free.

How typical drift fails the test:

| Drift | What fails |
|---|---|
| `ESTIMATE_UNITS` gains `days`, the schema does not | The structural check on `estimate.unit`. The probe `days` (from the constant) also gives "validator valid, schema invalid". |
| The schema enum for `write_policy.confirm` loses `none`, the validator keeps it | The structural check, and the probe `none`. |
| The validator starts rejecting `auto_commit: "yes"`, the schema still has no rule | If the schema lacks `auto_commit`, the probe `'x'` on `auto_commit` (a template key) gives "validator invalid, schema valid". |
| The schema marks `labels` as required, the validator does not | The probe "absent" on `labels`. |
| A new key in the template with no schema property | The check that every template path is a schema property. |
| The schema starts using `oneOf` | The evaluator throws on the unknown keyword. |
| A validator rule for a key that is in neither the template nor the schema | Not caught. The key reaches the test when it is added to the template or the schema. |

### Other tests

- `cli-init.test.mjs`: a first run writes both files with the line first and the template after it. `--update` on a config without the line adds it and changes no other line, comments included. `--update` on a config with the current line is `keep`. `--update` on a line with another pmkit ref is replaced. `--update` on a line pointing at another host is left alone. `--dry-run` reports `change` and writes nothing.
- `yaml-edit.test.mjs`: `setSchemaLine` cases for the three branches, an empty file, and a file that starts with a comment.
- `config.test.mjs`: one case per new message, the looser `tracker.path` (absent, `null` and a string pass), and `validateLocalConfig` still returning the cross-field problems.
- `cli-init.test.mjs`: `init --update` on a config that fails a new check refuses, writes nothing, and names the file in its next step.
- A tracker write on a config with `auto_commit: "yes"` refuses with the new message.
- `plugin.test.mjs`: both schema files exist and parse as JSON, and `plugin.json` has a `repository` that is a `https://github.com/<owner>/<repo>` URL.

### Docs

- `CHANGELOG.md`: the section of the release that carries this adds the two schemas and the new validator checks, plus a `Setup:` line: "setup adds a line at the top of both config files that points your editor at the pmkit JSON Schemas". The version number is the plan's call.
- `README.md`: a short paragraph on editor support, naming the Red Hat YAML extension.

## Decisions

| Decision | Reason |
|---|---|
| Schemas are written by hand and kept equal to the validators by a test (approach A) | No build and no dependency (ADR-0003), the validators and their messages stay, and the size fits a priority-low, estimate-3 issue. The source sentence says "the build exports"; there is no build, so a test does the job the build would have done. |
| Files at `schemas/pmkit.config.schema.json` and `schemas/issues.config.schema.json` | A top-level folder next to `templates/` ships with the plugin and gives a short, stable URL path. |
| JSON Schema draft-07 | Every editor YAML server supports it, and the keywords used here mean the same in later drafts. |
| No `$id` in the schema files | An `$id` would carry a URL that a fork or a branch change would need to edit. |
| The `$schema` URL is `raw.githubusercontent.com/<owner>/<repo>/main/schemas/<file>`, built from `plugin.json` `repository` | A relative or local path cannot work for a committed file. Installs come from `main`, the repo has no tags, and a URL that never changes keeps `init --update` quiet after upgrades. |
| `/pmkit:upgrade` does not edit the line; the release changelog has a `Setup:` line and `init --update` adds it | The upgrade command keeps its rule of not editing project config, and the existing `Setup:` mechanism already sends users to setup. |
| `runInit` writes the line through `setSchemaLine` in both modes; templates stay without it | One code path for first run and update. The URL depends on `plugin.json`, which a static template cannot know. |
| `init --update` replaces only a pmkit `$schema` line and leaves another schema line alone | A user who chose a different schema keeps it. |
| Unknown keys stay allowed; no `additionalProperties: false` | The validators accept them today, planned keys (`tracker.scope`, `mappings`) are coming, and an older CLI or schema must not reject a newer config. |
| The test compares verdicts from a schema evaluator written in the test code with the validators, plus a structural comparison of enums and patterns | It needs no library, catches changes on either side, and the evaluator throws on keywords it does not know. |
| Cross-field rules move to the end of `validateLocalConfig`, and a new `localConfigShapeProblems` holds the per-key checks | JSON Schema cannot express them, and the test needs a validator that checks only what the schema can. |
| Validators gain checks for `labels`, `estimate.scale`, member `name`, `email` and shape, `defaults` and `members` as maps, `auto_commit`, `git_host.repo`, `git_host.default_branch` and the items of `write_policy.preview` | The schema should type every key the CLI reads, and the test requires the validator to agree. Each check catches a value the CLI would misuse, such as `auto_commit: "yes"` read as off. |
| `tracker.path` becomes optional in `validatePmkitConfig`, a string or `null` | `loadConfig` already falls back to `.issues` for both, and it keeps `if`/`then` out of the schema. |
| The new checks go into `validateLocalConfig`, so they also refuse tracker writes and `init --update` on a config that fails them | One validator defines a valid config and the schema matches it. Each check names a value a reader already misuses. The `--update` error names the file to fix, and the changelog lists the checks. |
| `.issues/config.yaml` `version` is an integer of 1 or more in the schema, with no upper bound | Whether the format matches the CLI is the loader's job (ADR-0004), and the schema on `main` does not know the user's CLI. |
| `pmkit validate` and `init` keep not checking `.pmkit/config.yaml` with `validatePmkitConfig` | Out of scope for PMK-8. Worth a follow-up issue. |

## Acceptance criteria and where the design meets them

| Criterion | Design part |
|---|---|
| JSON Schemas for `.pmkit/config.yaml` and `.issues/config.yaml` ship with the plugin | "Schema files": `schemas/pmkit.config.schema.json` and `schemas/issues.config.schema.json` in the plugin folder. `plugin.test.mjs` checks both exist and parse. |
| Setup writes the `$schema` line at the top of each file | "The `$schema` line" and "Who writes the line": `setSchemaLine` in `runInit`, on first run and `--update`, shown in the dry run that `/pmkit:setup` previews. The `Setup:` changelog line brings existing setups to it. |
| A test fails when a schema and its validator disagree | "The agreement test": structural checks on enums and patterns, verdict checks over probes on every key path, and an evaluator that throws on unknown keywords. The drift table shows each case and the check that fails. |

## Left to the builder

- The exact `title`, `description` and `default` text in the schemas.
- The order of messages inside `validateLocalConfig`, as long as the shape problems come before the cross-field ones and existing tests that count problems are updated on purpose.
- Whether `default_status` missing gives one message or two (shape and cross-field).
- The internal shape of the evaluator and of the probe generator.
- The plugin version and changelog wording of the release.

## Risks for the plan

- The new validator checks change `pmkit validate` output, refuse tracker writes and stop `init --update` on configs that were already wrong. This repository's own `.issues/config.yaml` and `.pmkit/config.yaml` pass them (checked by reading both files). The plan should still run `pmkit validate` after the change.
- This repository's own config files do not get the line until someone runs `/pmkit:setup` (or `init --update`). `.issues/` must not be edited by hand, so the plan should run `init --update` through the CLI or leave it for after merge.
- The `main` URL resolves only after the PR merges. Until then an editor on a branch shows a load error for the line, which is expected.
- `config.test.mjs` asserts `validatePmkitConfig` finds 4 problems in one case and `validateLocalConfig` finds 8 in another. The new checks and the split may change those counts.
