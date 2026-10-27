# PMK-22 design: releases in the Local tracker

Issue PMK-22, epic EPC-3. Status: draft from an autonomous brainstorm. The "Open questions" section holds the four calls that belong to the user. The design below applies the recommended answer to each, so a plan can start from it once the user confirms or changes them.

## Problem

The Local tracker has no releases. `SERVED_BY.releases` in `scripts/lib/capabilities.mjs` is an empty list, so `pmkit capabilities` reports `releases` as `absent` with the hint `No pmkit command serves releases in the Local tracker yet`. Two phase 2 commands depend on it:

- PMK-23 (`release-notes`) groups completed issues by release. Without releases it falls back to a sprint or a period.
- PMK-69 (`release-readiness`) lists the open issues, pull requests and deploys of a release. Without releases it falls back to a milestone or a sprint.

Sources: Local adapter, Entity mapping ("`releases/<version>.md`, optionally tied to a git tag"). Unified model, contract family Releases (`list_releases`, `release_issues`, `mark_released`).

Acceptance criteria:

1. `releases/<version>.md` holds a release, optionally tied to a git tag.
2. The CLI lists releases, lists the issues of a release and marks a release released.
3. `capabilities` reports `releases` as native.

The closest existing feature is milestones (PMK-3, `docs/superpowers/specs/2026-10-25-pmk-3-milestones-design.md`). This design follows it wherever a release behaves like a milestone, and says where it differs.

## Goals

- A release is a file, `releases/<version>.md`, with a name, an optional git tag, an optional target date and, once released, the time it was released.
- An issue belongs to at most one release through a new `release` field.
- The CLI creates, lists and prints releases, lists the issues of a release, and marks a release released.
- `pmkit capabilities` reports `releases` as `native`.
- A teammate on the previous plugin version keeps reading and writing the same tracker.

## Non-goals

- Renaming, deleting or reopening a release, or editing its target date or name after creation.
- Creating, pushing or moving git tags. The plugin never writes to git on its own (ADR-0001).
- Deploys, pull requests or a "what is left" view. PMK-69 builds those on top of `release issues`.
- Release notes text. PMK-23 builds it on top of `release issues`.
- A `--release` filter on `issues list`, and a `release` field on epics.
- Importing existing git tags as releases.
- A `/pmkit:...` slash command for releases. The acceptance criteria ask for the CLI, and PMK-23 and PMK-69 add the commands that use it.

## Anti-goals

- No tracker format bump. A bump would lock teammates on the previous plugin out of reads for a change that alters no existing file.
- No write that works today may start failing. Every new check applies only to the new `release` field and the new folder.
- `release issues` must not guess membership from git history or commit messages. PMK-23 and PMK-69 need a list a person decided and can review.

## Approaches

1. **A `release` field on the issue, plus a file per release.** Membership lives where `sprint` and `milestone` already live. `issues update --release 1.2.0` sets it, the event log records the change as an `update` event, and `release issues` is a search on the field.
2. **An `issues:` list inside the release file.** One file holds the whole scope. Two people adding issues to the same release on two branches edit the same line and get a merge conflict. No event records when an issue joined, and the issue file does not show its release.
3. **Membership derived from git.** `release issues` would read the commits between the previous tag and this tag and collect the issue IDs in their messages. It only works after the tag exists, so it cannot serve a planned release or PMK-69. It also depends on commit message habits.

Recommended: approach 1 (open question 1). It reuses the field, event and validation paths that `sprint` and `milestone` already have, merges cleanly, and serves planned and released releases alike.

## Design

### Release file

`releases/<version>.md` under the tracker folder:

```markdown
---
name: 1.2.0
tag: v1.2.0
target: 2026-11-30
released: 2026-11-28T14:05:00Z
---

Webhook retries and the billing export.
```

- The file stem is the release id, and it is the version. The frontmatter has no `id` key, as with milestones and sprints, so the id and the file name cannot disagree.
- `name` is a one-line, non-empty string. `release create` always writes it and defaults it to the id. A file written by hand without `name` reads with the id as its name.
- `tag` is optional. It is the git tag the release is tied to, as written, such as `v1.2.0`. It is one line with no whitespace, and it passes git's ref name rules for the parts pmkit can check without git: no `..`, no `~`, `^`, `:`, `?`, `*`, `[` or `\`, it does not start with `-` or `/`, and it does not end with `/`, `.` or `.lock`. The exact regular expression is the builder's call.
- `target` is optional, `YYYY-MM-DD`, the planned date. It uses the epic's key for a planned end.
- `released` is optional. It is the time `release mark-released` ran, an ISO timestamp with `Z` or an offset, in the same shape as a sprint's `closed`. Its presence is what makes a release released.
- The body after the frontmatter is the description. `release create` writes no body. A description written by hand reads back in `release get`.
- The reader ignores other frontmatter keys and keeps them on the next write, as `parseSprint` does with `extra`. `mark-released` is the one command that rewrites a release file, so it must not drop a key a person added.

The model is `Release { id, name, tag?, target?, released?, state, description }`, added as a typedef in `scripts/lib/model.mjs`. `state` is computed on read, never stored: `released` when the file has `released`, otherwise `planned`. Storing it would let `state` and `released` disagree. The Unified model's `mark_released` maps to setting `released`.

**Id rule.** A release id follows the milestone id rule. It starts and ends with a letter or digit and holds only letters, digits, `.`, `_` and `-`. `1.2.0`, `v1.2.0`, `2026.10`, `1.0.0-rc.1` and `mobile-3.4` pass. `1.0.0+build.5` fails because of `+`, which the user can write as `1.0.0-build.5` or put in `name`. Matching is exact and case-sensitive, and `release create` refuses an id that equals an existing one when case is ignored. The builder moves `validMilestoneId` to a name that fits both (for example `validFileId` in a shared module) or imports it under a second name. That choice does not change behavior.

**Order.** `listReleases` returns releases in version order, oldest first, so a table reads like a changelog. The comparison drops a leading `v` or `V`, then splits the id at its first `-` into a core and a suffix. Cores compare in natural order, with digit runs compared as numbers, so `1.10.0` comes after `1.9.0`. When the cores are equal, an id with a suffix comes before the same core without one, so `1.0.0-rc.1` comes before `1.0.0`. Two suffixes compare in natural order. The raw id breaks any remaining tie. The function lives in the new module and has its own unit tests.

A new module, `scripts/lib/local/releases.mjs`, holds the id and tag checks, parsing, serializing and sorting, as `milestones.mjs` does. Parsing uses `parseFile` from `epics.mjs`. Conflict markers throw `CONFLICT`. A missing or unreadable frontmatter, a `name` with a line break, a bad `tag`, a bad `target` or a `released` that is not a timestamp with a zone throws `INVALID_INPUT`. Both carry the next step `/pmkit:local:doctor`.

**No event log for releases.** A release is one file, as a sprint and a milestone are, and neither has `events.jsonl`. `release create` and `release mark-released` are its only writes, and git history records both.

### The issue's `release` field

- `ISSUE_KEYS` in `scripts/lib/local/issue-file.mjs` gains `release` right after `milestone`, so the frontmatter order is `sprint`, `milestone`, `release`, `due`. `parseIssueFile` reads it into `issue.release`, and `toFrontmatter` writes it. The `Issue` typedef gains `release`.
- `CREATE_KEYS` and `UPDATE_KEYS` in `tracker.mjs` gain `release`.
- `NORMALIZE.release` runs `oneLine`, then requires a file in `releases/` whose stem equals the value exactly, or it throws `INVALID_INPUT` with the message `release <value> does not exist` and the next step `pmkit release create <value>`. Unlike milestones, the check is always on. No tracker has release values today, so no free-text value needs a grace period. The check compares against the list of stems from `readdirSync`, not `fs.existsSync`, for the same case reason as milestones.
- Clearing the field with `--release none` is never checked. A write that does not set `release` does not check it, so an issue whose release file was deleted stays editable.
- Setting `release` to a release that is already released is allowed, because a person may add an issue that was missed. The CLI adds the warning `release <id> is already released`.
- `issueRecord` in `scripts/lib/format.mjs` prints `release` after `milestone`. `issueTable` does not change.

### Events

No new event op. A change to `release` is an `update` event with `field: "release"`, `from` and `to`, written by the same `change` path as `milestone`. `replay` already applies any `update` field, and `driftEvents` checks every key in `ISSUE_KEYS`, so a hand edit of `release` gets a synthetic `update` event on the next write. A `create` event holds `release` in its `to` map when the issue is created with one.

PMK-23 can therefore tell when an issue joined or left a release from `pmkit events` or `issues get --history`. `EVENT_OPS` in `model.mjs` and `CONTEXT.md`'s list of ops stay as they are.

### Tracker operations

The contract gets a Releases family. `scripts/lib/contract.mjs` adds five names to `TRACKER_OPERATIONS`, and the design spec's Contract table gets a row.

- `listReleases({ state })` returns every release file that parses, in version order. `state` is optional, `planned` or `released`, and anything else is `INVALID_INPUT`. A file that does not parse, or whose stem breaks the id rule, is left out, as `listMilestones` does, and `validate` reports it. A missing folder returns `[]`.
- `getRelease(id)` returns the release whose file stem equals `id`. Otherwise it throws `NOT_FOUND` with the next step `pmkit release list`.
- `releaseIssues(id)` calls `getRelease(id)` first, so an unknown id is `NOT_FOUND`. It returns the issues whose `release` equals `id`, archived ones left out, in creation order, with computed fields, as `cycleIssues` does. It is `searchIssues` with a new filter key, `release`. `FILTER_KEYS` in `query.mjs` gains `release`, `checkFilter` requires a string, and `runQuery` keeps an issue when `issue.release === filter.release`. The key accepts no `none` or `current` forms, because no CLI flag exposes it yet.
- `createRelease({ id, name, tag, target }, actor, { dryRun })` runs `requireWriter(actor)`, refuses unknown keys, checks the id rule (`INVALID_INPUT`), refuses an id that matches an existing stem when case is ignored (`CONFLICT`, next step `pmkit release list`), trims and checks `name` (default: the id), checks `tag` and `target`, serializes, reads the text back with `readBack`, and, unless `dryRun`, creates the folder and writes the file with `writeFileAtomic`. It returns `{ before: null, after }`. A new release is always `planned`; `createRelease` takes no `released`.
- `markReleased(id, actor, { tag, dryRun })` runs `requireWriter(actor)` and `getRelease(id)`. A release that already has `released` is `CONFLICT` with the message `release <id> was released at <time>` and the next step `pmkit release get <id>`. The operation sets `released` to the current time in seconds with `Z` (the `stamp()` the tracker already uses). When `tag` is given, it is checked and replaces the stored tag. It keeps unknown keys and the description, writes like `createRelease`, and returns `{ before, after, unfinished, problems }`. `unfinished` is the issues of the release whose category is not terminal. `problems` lists issue files that did not parse, as `closeCycle` does, because such an issue may belong to the release. Marking a release with unfinished issues succeeds (open question 3).

Reads use `config.readDir ?? config.issuesDir`, as every other read does, so a tracker on an older format reads its migrated copy. Writes on an older format fail in `requireWriter` first.

`markReleased` does not touch git. A hosted tracker such as Linear or Jira has no local repository, so the tag check lives in the CLI (next section), not in the contract.

### CLI

Five entries in `COMMANDS`, in a `release` group:

| Command | Text output | JSON |
|---|---|---|
| `release list [--state planned\|released]` | a table with ID, Name, State, Tag, Target and Released, or `no releases` | the array from `listReleases` |
| `release get <id>` | `releaseRecord`: id, name, state, tag, target, released, then the description | the release |
| `release issues <id>` | `issueTable` | the array from `releaseIssues` |
| `release create <id> [--name n] [--tag t] [--target YYYY-MM-DD]` | `writeText` with `record: releaseRecord` | `{ before: null, after }` |
| `release mark-released <id> [--tag t]` | `writeText` with `record: releaseRecord`, then `unfinished issues:` and an `issueTable` | `{ before, after, unfinished, problems }` |

- `release create` and `release mark-released` are `write: true`, so they take `--dry-run` and `--as`. Both return `commit: <id>`, so with `auto_commit` on the commit messages are `pmkit: release create 1.2.0` and `pmkit: release mark-released 1.2.0`.
- `release mark-released` adds a warning when `unfinished` is not empty: `release 1.2.0 has 3 unfinished issues: PMK-4, PMK-9, PMK-12`. Each entry in `problems` adds a warning through `problemLine`, as `cycle close` does.
- **Tag check.** When the release has a tag after the change, `release mark-released` runs `git rev-parse --verify --quiet refs/tags/<tag>` in the repository root. When the tag is missing, it adds the warning `tag v1.2.0 is not in this repository; create and push it, or run git fetch --tags`. Outside a git repository, or when `git` is missing, it adds `cannot check tag v1.2.0: <reason>`. The release is marked in every case (open question 4). The check runs on dry runs too, so a confirmation shows the warning before the write. How the CLI runs `git` (the existing spawn helper, or a small one next to `gitUserEmail`) is the builder's call. `release create --tag` does not check, because the tag usually does not exist yet.
- `issues create` and `issues update` gain `--release <id>`. `issues update --release none` clears it. `issuePatch` handles it like `--milestone`.
- `releaseRecord` goes in `scripts/lib/format.mjs` next to `milestoneRecord`.

### Capability manifest

`SERVED_BY.releases` becomes `['release list', 'release get', 'release issues', 'release create', 'release mark-released']`. `buildCapabilities` then reports `releases` as `native` with no detail and no hint. The manifest goes from 10 native, 2 derived and 8 absent to 11 native, 2 derived and 7 absent.

- `scripts/capabilities.test.mjs` moves `releases` from the absent list to the native list and drops the assertion on its absent hint.
- The four `capabilities.txt` goldens change in the `releases` row and its JSON entry.
- ADR-0001 updates its counts and lists: 11 of 20 native with `releases` added, 7 absent with `releases` removed.

### Validation

`validateRepo` in `scripts/lib/validate.mjs`:

- Parses every `releases/*.md` file. Only `.md` stems count, as for milestones. A file with conflict markers is reported with the code `conflict`. A stem that breaks the id rule, and every other invalid file, is reported with the new code `release`.
- Checks the `release` of every issue, archived ones included, against the stems. A missing release is a `reference` problem with the message `release <value> does not exist`, the same shape as the milestone message, so `/pmkit:local:doctor` can group by name.
- `checked` gains a `releases` count. The text head becomes `checked: N issues, N epics, N sprints, N milestones, N releases, N comments`. The `validate.txt` goldens change with it.

`commands/local/doctor.md`:

- Step 4, `reference`: for a release, group the problems by name and propose one `release create <name> --dry-run --json` per name, or `issues update <id> --release none --dry-run --json` for each issue. A name that breaks the id rule gets the same treatment as a milestone name: ask for a valid id, create it with `--name "<old name>"`, then update each issue.
- Step 5's list of problems the CLI cannot fix gains `release`, next to `milestone`.

### Format version and existing trackers

The format stays 2, and there is no migration. ADR-0004 bumps the format only when existing files change shape. This change adds a folder, a new kind of file and an optional issue key. No existing file changes.

What a teammate on the previous plugin version sees on a tracker that uses releases:

- `releases/` is ignored by every read and by `validate`.
- An issue with `release:` parses with `release` in `extra`. The next write by the old CLI keeps the key, and `stringifyYaml` moves it among the unknown keys after the known ones. The new CLI reads it back in either position.
- The old `driftEvents` checks only its own `ISSUE_KEYS`, so it records no drift for `release`. The old `validate` does not report unknown issue keys.
- The old CLI cannot set or clear `release`, and `pmkit capabilities` there still reports `releases` as absent. Both are expected until the teammate upgrades.

What changes for an existing tracker on the new version: nothing until someone runs `release create`. No issue has `release`, so the always-on check never fires on existing data. An issue that already carries a hand-written `release:` key (unlikely, since nothing wrote one) reads as a field, gets a synthetic `update` event on its next write, and shows up in `validate` as a `reference` problem when its release has no file.

The query index needs no step. `parserVersion()` in `query-index.mjs` hashes `issue-file.mjs`, so the change to `ISSUE_KEYS` discards every existing index on the first read.

The release that ships this has no `Tracker format:` line and no `Setup:` line in its changelog section.

### What PMK-23 and PMK-69 read

- PMK-23 (`release-notes`) runs `capabilities --json`, and when `releases` is native, `release list --state released --json` to pick a release and `release issues <id> --json` for its issues. It keeps those whose `status.category` is `done`. `released` gives the cutoff time and `tag` the label. When `releases` is absent, it falls back to a sprint or a period, as its acceptance criteria say.
- PMK-69 (`release-readiness`) runs `release list --state planned --json`, then `release issues <id> --json`, and reports the issues whose category is not terminal. The `branch` of each issue leads to its pull request through `pr status --branch`. `tag` names the deploy target.

Neither needs another operation from this issue.

### Docs

- `docs/superpowers/specs/2026-10-23-pmkit-design.md`: a Release row in the Common model table, `release` in the Issue row and the sample issue file's key list, `releases/` in the Layout, a "Releases" subsection under "Local tracker" that points here, a Releases row in the Contract table, and the five commands in the CLI table.
- `CONTEXT.md`: a **Release** term. "A version of the product, kept as `releases/<version>.md`, that issues point to through `release`. It may name a git tag, and it is `planned` until `release mark-released` records when it shipped." _Avoid_: milestone (a milestone is a target, not a version), version (outside the file name), deploy. The **Issue** term adds "a release" to its field list.
- `README.md`: the five commands in the CLI table, and `--release` on `issues create` and `issues update`.
- `docs/adr/0001-local-tracker-is-the-reference-implementation.md`: the new counts.
- `commands/local/doctor.md`: as above.
- `CHANGELOG.md`: no change on this branch. The release adds a line such as "Adds releases: `releases/<version>.md`, the `--release` field and the `release list`, `get`, `issues`, `create` and `mark-released` commands; `capabilities` reports `releases` as native".

### Tests

- `scripts/releases.test.mjs`: the id rule, the tag rule, parsing with and without `name`, a bad `target`, a bad `released`, conflict markers, unknown keys kept through a serialize, the computed `state`, and the version order (`1.9.0` before `1.10.0`, `1.0.0-rc.1` before `1.0.0`, `v1.2.0` next to `1.2.0`).
- Tracker tests: create, list, get and list by state. A dry run writes nothing and makes no folder. `CONFLICT` for an id that differs only in case. Unknown keys refused. `--release` on create and update, with `INVALID_INPUT` for a missing release and no check for `none`. An update to another field of an issue whose release file is gone succeeds. `releaseIssues` returns the issues of one release, skips archived ones and throws `NOT_FOUND` for an unknown id. `markReleased` sets `released`, keeps unknown keys and the description, returns the unfinished issues, refuses a second mark with `CONFLICT`, and replaces the tag when `--tag` is given. The event log of an issue holds an `update` event for `release`, and a hand edit of `release` yields a synthetic event.
- CLI tests: the five commands in text and JSON. The warnings for unfinished issues, for a released release on `issues update --release`, for a missing tag, and for a repository without git. The existing test that checks every `pmkit ...` next step against `COMMANDS` covers the new next steps.
- `scripts/validate.test.mjs`: `release` problems, `reference` for a missing release, archived issues checked, and `checked.releases`.
- `scripts/contract-suite.mjs`: create, list, get, issues, mark released, `NOT_FOUND`, and a dry run that writes nothing.
- `scripts/capabilities.test.mjs`: as above.
- Goldens: `goldens.test.mjs` requires a case for every command, so the builder adds a release file and an issue with `release` to one fixture (`basic` is the likely choice) and regenerates the goldens that change.

## Decisions

| Decision | Reason |
|---|---|
| Membership is a `release` field on the issue (open question 1) | It follows `sprint` and `milestone`, gets events and drift for free, and merges without conflicts. |
| One release per issue (open question 2) | It matches `sprint` and `milestone`. A list would need list events (`link`/`unlink`) and a different filter for one rare case, backports. |
| The file stem is the release id and the version, with no `id` key | Milestones and sprints work the same way, and the id and the file name cannot disagree. |
| Reuse the milestone id rule, with a case-insensitive clash check on create | It accepts the common version shapes, keeps file names valid on every OS, and needs no second rule. |
| `state` is computed from `released`, not stored | One source of truth. A stored `state` could disagree with `released`. |
| `released` is a timestamp with a zone | Release notes need a precise cutoff, and the shape matches a sprint's `closed`. |
| `target` for the planned date | The epic already uses `target` for a planned end. |
| The `release` reference check is always on | Unlike milestones, no tracker has free-text release values to protect. |
| Adding an issue to a released release is allowed, with a warning | A missed issue is a normal fix after a release. |
| No event log for releases, and no new event op for issues | Releases have two writes and git history covers them. The issue's `update` event already covers the field. |
| `markReleased` returns the unfinished issues and does not refuse (open question 3) | It follows `closeCycle`. The command that calls it decides what to do with them, and the CLI warns. |
| The tag check is in the CLI, warns and never writes to git (open question 4) | The contract must work for hosted trackers. The plugin never writes to git on its own, and a tag may live only on the remote. |
| `releaseIssues` uses a new `release` filter key in `searchIssues` | One query path for every issue list. The key stays out of `issues list` flags for now. |
| Keep tracker format 2, with no migration | No existing file changes shape, and the previous plugin keeps the new key on its writes. |
| `release get` and `release create` are in scope | The acceptance criteria need a way to make a release, and `get` is the record the other commands print. Writing `.issues/` by hand is not allowed. |
| No slash command in this issue | The criteria ask for the CLI. PMK-23 and PMK-69 add the commands that use it. |
| No CHANGELOG edit on this branch | Earlier PMK specs leave the line to the release. |

## Acceptance criteria map

| Criterion | Part of the design |
|---|---|
| `releases/<version>.md` holds a release, optionally tied to a git tag | Release file with `name`, optional `tag`, `target` and `released`; `scripts/lib/local/releases.mjs`; `validate` checks the files |
| The CLI lists releases, lists the issues of a release and marks a release released | `release list`, `release issues <id>`, `release mark-released <id>` on `listReleases`, `releaseIssues`, `markReleased`, plus `release get`, `release create` and `--release` on issues |
| `capabilities` reports `releases` as native | `SERVED_BY.releases` lists the five commands, and the manifest becomes 11 native, 2 derived, 7 absent |

## Open questions

The design applies the recommendation of each question.

1. **How does an issue join a release?**
   - A. A `release` field on the issue, set with `issues update --release`. (Recommended: it reuses the field, event and validation paths of `sprint` and `milestone`, merges cleanly, and works before the tag exists.)
   - B. An `issues:` list in the release file. One place shows the scope, but two branches that add issues conflict, and no event records when an issue joined.
   - C. Derived from git: the issue IDs in the commit messages between the previous tag and this one. No manual step, but it only works once the tag exists and depends on commit message habits.
2. **Can an issue belong to more than one release?**
   - A. One release per issue, `release: 1.2.0`. (Recommended: it matches `sprint` and `milestone` and keeps `update` events.)
   - B. A list, `releases: [1.2.1, 1.3.0]`, as Jira's fix versions allow for backports. Changing from A to B later needs a format bump and a migration, so this is the moment to choose.
3. **What does `release mark-released` do when the release still has unfinished issues?**
   - A. Mark it, list the unfinished issues in the result and warn. (Recommended: it follows `cycle close`, and PMK-69 is the place to stop a release that is not ready.)
   - B. Refuse with `CONFLICT` unless `--force` is passed.
   - C. Refuse, and the user moves or removes the issues first.
4. **What does `release mark-released` do with the git tag?**
   - A. Record it only, never look at git.
   - B. Record it and warn when the tag is not in the local repository. (Recommended: the user learns about a missing tag, a tag that lives only on the remote does not block the mark, and the plugin writes nothing to git.)
   - C. Refuse when the tag is not in the local repository.
   - D. Create the tag at `HEAD` when it is missing, after confirmation.

## Follow-up candidates

1. `issues list --release <id|none>`, which the new filter key makes a one-flag change.
2. `release update` for `name`, `target` and `tag`, and a way to undo a mark.
3. A `release` field on epics, if PMK-69 needs to show epics by release.
4. `/pmkit:local:doctor` or a new command that offers a release per existing git tag.
5. `/pmkit:spec:import` creating releases when a spec names versions.

## Left to the builder

- Where the shared id rule lives and what it is called.
- The tag regular expression, within the rules listed above.
- How the CLI runs `git rev-parse` for the tag check.
- Which fixture gets the release file for the goldens.

## Self-review

- Placeholders: none. The builder's calls above do not change behavior.
- Consistency: the always-on `release` check is the same for writes, `validate` and `/pmkit:local:doctor`. The `reference` message is `release <value> does not exist` everywhere. The format stays 2 in every section. The manifest counts are 11, 2 and 7 in the capability section, the ADR change and the criteria map.
- Scope: one new module, one new issue key, five tracker operations, one filter key, five CLI commands, two new flags on issue commands, a `validate` change, one command file and the docs.
- Builder check, read as a fresh builder. Which folder the checks read (`issuesDir` for writes, `readDir ?? issuesDir` for reads). Whether a dry run of `mark-released` runs the tag check (yes). What happens to `release` under the old CLI (kept as an unknown key, no drift, no validate problem). Whether `release issues` includes sub-issues of a member issue (no, only issues whose own `release` matches). Whether archived issues count (`release issues` skips them, `validate` checks them). The answers are in the sections above.
