# PMK-7: query index under `.issues/.cache/`

Design for issue PMK-7 of epic EPC-1 ("Local tracker: close the gaps of 0.1.0"). It adds the query index that ADR-0001 left for phase 2 and that the pmkit design spec places in `.issues/.cache/` ("Local tracker", "Layout"). It also gives `/pmkit:local:doctor` the rebuild step that the MVP skills spec lists as `local-doctor` step 6.

No human took part in this session. Claude answered the brainstorming questions from the issue, the code, `CONTEXT.md`, the ADRs and the earlier specs. Every decision below is Claude's call, and the reason sits next to it.

## Why

Every read of the Local tracker calls `readAll()` in `scripts/lib/local/tracker.mjs`. It lists `issues/`, then reads and parses every `issue.md`: it splits the frontmatter, runs the YAML parser, checks for conflict markers and splits the body into sections. `issues list`, `cycle issues`, `cycle close`, `epic progress`, `pr sync`, `metrics velocity`, `issues link --kind blocks` and even `issues get` (through `withComputed`, which fills `blocks` and `children`) all pay that cost on every run. This repository already has 110 issues, and the cost grows with each one.

The index keeps the parsed result of each `issue.md` next to the file signature it came from. A read stats every file, reuses the entries whose signature still matches, and parses only the files that changed.

## Goals

- `issues list` reads the index and reparses only the issue files that changed since the index was written.
- A search returns exactly what it returns without the index: the same issues, in the same order, with the same fields, and the same `problems`.
- `/pmkit:local:doctor` rebuilds the index through a new CLI command, `reindex`.
- The index never breaks a command. When it is missing, corrupt, from another pmkit version or cannot be written, the read falls back to parsing the files.

## Non-goals

- No faster `validate`. It stays the full check of every file and never reads the index.
- No index for epics, sprints, comments, events or documents. The text search reads only the title and the description, so comments and events are not search input.
- No change to how writes read an issue. A write always reads `issue.md` itself, because drift detection needs the file as it is.
- No new filters, sort orders or output fields.

## Anti-goals

- A search result that differs from the files. A stale entry is worse than a slow read.
- A cache file in a commit, in the `git status` of a tracker, or in the dirty check of `migrate`.
- An error, a warning on every run, or a non-zero exit caused by the index alone.
- A change to the tracker format, so a teammate on pmkit 0.2.0 keeps reading and writing the same repository.

## Approaches considered

1. **Stat signature per file, rebuilt on read (chosen).** The index stores, per issue folder, the parsed issue (or the parse problem) and the `size`, `mtimeMs`, `ctimeMs` and `ino` of `issue.md` taken before the read. A search stats each file and reparses the ones whose signature differs. Cost of a warm search: one `readdir`, one `stat` per issue and one JSON read, with no YAML parsing. It catches hand edits, `git pull`, `git checkout` and deleted or added folders, because each of them changes at least one of the four values.
2. **Content hash per file.** The index stores a hash of each `issue.md`. A search reads every file, hashes it and reparses only on a mismatch. It never misses a change, but it still reads every file on every search, so it saves the parsing and none of the I/O. The stat signature with the racy rule below gives the same answer for every case the issue names, at a lower cost.
3. **Index written by the CLI's writes, trusted on read.** Each write updates its entry, and reads trust the index until `reindex`. It is the fastest read, but hand edits, merges and `git pull` bypass the CLI. Results would then differ from the files, which breaks the second acceptance criterion and the anti-goal on stale results.

A variant of approach 1 stores only the fields the filters use and reads the matching files in full afterwards. It makes the index smaller, but `issues list --json` returns the whole issue, `body` included, and `withComputed` needs `blockedBy` and `parent` of every issue. It adds a second read path with its own race between the index check and the file read. Claude rejected it: the full parsed issue is simpler and keeps one path.

## Design

### Files

- `.issues/.cache/index.json`: the index. The tracker path is `tracker.path` from `.pmkit/config.yaml`, so "`.issues/`" below means that folder.
- `.issues/.cache/.gitignore`: one line, `*`. The index code writes it whenever it creates the folder or finds it missing. It ignores everything in the folder, itself included.
- `scripts/lib/local/query-index.mjs` (new): load, check, save and rebuild the index. `tracker.mjs` calls it from `readAll()`.

The index file is JSON, never `.md` or `.yaml`, so the conflict marker scan of `validate` (which reads `.md` and `.yaml` under the tracker folder) never reads it.

### Index shape

```json
{
  "schema": 1,
  "format": 2,
  "parser": "<sha1 of the source of issue-file.mjs and yaml.mjs>",
  "options": "<sha1 of JSON.stringify(local.statuses)>",
  "issues": {
    "ISS-7K3Q": { "sig": { "size": 812, "mtimeMs": 1761400000000, "ctimeMs": 1761400000000, "ino": 1234 }, "issue": { "...": "the parsed issue" } },
    "ISS-3Q6T": { "sig": { "...": "..." }, "problem": { "code": "CONFLICT", "message": "The issue file contains git conflict markers." } }
  }
}
```

- `schema` is the layout of `index.json`. It goes up when this shape changes.
- `format` is `FORMAT_VERSION`. A migration can change what a file means, so a different format discards the index.
- `parser` is a SHA-1 over the source text of `scripts/lib/local/issue-file.mjs` and `scripts/lib/yaml.mjs`, read once per process through `import.meta.url`. A pmkit upgrade, or an edit to the parser by someone running pmkit from source (this repository does), discards the index. A version number bumped by hand would be forgotten.
- `options` is a SHA-1 of the options `readIssue` passes to `parseIssueFile`, which today is `local.statuses`. A status that moves to another category changes `status.category` in every parsed issue, so the index is discarded.
- `issues` is keyed by the folder name that `listIssueIds` returns. An entry holds either `issue` (the object `parseIssueFile` returned) or `problem` (`code` and `message` of the `PmkitError` that `readIssue` threw). Problems are cached too, so a conflicted file yields the same `problems` entry without being reread.

A header that differs from the current one in any of the four keys counts as an empty index.

### Change detection

A file's signature is `{ size, mtimeMs, ctimeMs, ino }` from one `fs.statSync` of the path `readIssue` reads, `issuePaths(issuesDir, normalizeId(id)).file`. The index takes the signature **before** it reads the file. If the file changes between the stat and the read, the stored signature is the old one, so the next search sees a mismatch and reparses. Taking it after the read could pair a new signature with old content and keep a stale entry forever.

- **mtime.** Any write changes it, unless a tool restores it on purpose.
- **ctime.** No user tool can set it. `cp -p`, `rsync -a`, `touch -r` and `tar` restore mtime but not ctime, so a same-size edit with a restored mtime is still caught. `chmod` changes it too, so a file made unreadable is reparsed and fails the same way the plain scan fails.
- **size.** A cheap extra check.
- **ino.** `writeFileAtomic` and `git checkout` write a new file and rename it over the old one, so the inode changes even when the timestamps collide.

**Coarse timestamps (racy entries).** FAT keeps mtime in steps of 2 seconds and some network file systems in steps of 1 second. A file edited twice inside one step, with the same size and inode, keeps its signature. Git has the same problem and calls it "racy git". The index uses the same fix: when it loads, it stats `index.json` itself, and any entry whose `mtimeMs` or `ctimeMs` is within `RACY_MS = 2000` milliseconds of the index file's `mtimeMs`, or later, is treated as changed and reparsed. Both times come from the file system's clock, so a skew between the machine and a network drive does not matter. When a search found racy entries, it writes the index again even if nothing else changed, so the entries settle once the 2 seconds pass.

**Git checkouts.** Git writes changed files with the current time as mtime and does not preserve the original. A checkout, merge, rebase or pull that changes an issue gives it a new mtime, ctime and usually a new inode. Files git leaves alone keep their signature and stay in the index, which is correct because their content did not change.

**Issues created or deleted between runs.** The folder list comes from `listIssueIds` on every search, never from the index. A folder without an entry is parsed and added. An entry whose folder is gone is dropped. A folder whose `issue.md` is missing produces the same `NOT_FOUND` problem as today and gets no entry, because there is no file to sign.

### Read path

`readAll()` keeps its contract: `{ issues, problems }`, in `listIssueIds` order. With the index on it does this:

1. List the issue folders with `listIssueIds`, as today.
2. Load `index.json`. Discard it when it is missing, does not parse, has a different header, or is not the expected shape. Discard a single entry whose `sig` lacks one of the four numbers.
3. Stat `index.json` for the racy rule.
4. For each folder: stat its `issue.md`. Reuse the entry when the signature matches and the entry is not racy. Otherwise run the existing `readIssue` logic, store the result with the signature taken in this step, and mark the index changed.
5. Write the index when it changed (new, changed, dropped or racy entries, or a new header). Skip the write when it did not, when the tracker's `index` option is `'read'`, or when the caller passed `save: false` (see "Dry runs").
6. Return the issues and problems in folder order.

The returned objects are copies: an entry from the index goes through `structuredClone` or a fresh `JSON.parse`, so a caller that mutates a result (as `change` does with `structuredClone(before)`) never mutates the in-memory index.

A JSON round trip must give the same object as the parser. `parseIssueFile` returns strings, numbers, booleans, plain objects, arrays and absent keys, all of which survive JSON. An `undefined` value would not, which is why the parser already deletes missing `created` and `updated` instead of leaving them `undefined`. The equivalence test below guards this.

**Who uses it.** Every caller of `readAll()` and `scanIssues()` gets the index: `searchIssues` (so `issues list`, `cycle issues`, `cycle close`, `pr sync`), `getIssue` through `withComputed`, `relate` for the blocker cycle check, `issuesBySprint` and `deliverableProgress`. The per-issue reads inside writes (`readIssue` from `change`, `knownIssue`, `parentOfIssue`, `requireParent`) keep reading the file.

The tracker may keep the loaded index in memory for its lifetime, so a command that calls `readAll()` several times parses `index.json` once. It still stats every file on every call **(builder's call whether to do this)**.

### Failures and concurrency

The index can only make a read faster. Every failure falls back to the plain scan:

- **Corrupt or partial `index.json`.** `writeFileAtomic` writes a temp file in `.cache/` and renames it, so a reader sees the old file or the new one, never half of one. A file that is corrupt anyway (a crash on a file system without atomic rename, a hand edit) fails `JSON.parse` or the shape check and counts as an empty index, which the next search rewrites.
- **Leftover temp files** (`index.json.tmp-<pid>-<n>`) from a killed process are ignored by searches and removed by `reindex`.
- **Two processes.** Each one loads, updates and writes the whole index with an atomic rename. The last writer wins. Each writer's entries pair content with the signature taken before reading it, so a slower writer that stores an older entry only causes one extra reparse on the next search. No lock.
- **Read-only disk, no permission, full disk, `.cache` is a file.** Creating the folder, writing `.gitignore` or writing `index.json` throws. The index code catches it and returns the scan result. No warning, because it would repeat on every read of a read-only checkout.
- **Older tracker format.** When `config.readDir` is set, the loader reads a migrated copy in a temp folder. The index is off for that tracker instance: an index in the temp copy dies with the process, and an index in the real folder would hold the migrated shape. Reads work as today until `/pmkit:upgrade`.
- **A bug in the index code.** `readAll()` runs the index path inside a `try`. Any error from it, `PmkitError` or not, makes `readAll()` run the plain scan and return that result. A parse problem is not an error of the index path: `readIssue` errors become `problems` entries, exactly as in the scan.

`planMigration` copies the tracker folder with `fs.cpSync`. It gets a filter that skips `.cache`, so the migration copy, its snapshot hashes and its list of changes never include the index.

### Writes and auto-commit

CLI writes never read or write the index. After a write, the changed `issue.md` has a new inode and new timestamps, so the next search reparses that one file. Updating the entry on write would save one parse per write and add a second writer to the index, with its own concurrency case. Claude kept the index maintained by reads only.

The cache never reaches a commit:

- `.issues/.cache/.gitignore` with `*` makes git ignore the folder whatever the tracker's own `.gitignore` says. `commitTracker` runs `git add -- <tracker path>`, which skips ignored files, so today's auto-commit does not stage the index.
- PMK-6, on another branch, changes auto-commit to add only the files a write registered. A write never touches the index, so the index is never a registered file. The two changes do not interact.
- `migrate` refuses when `git status --porcelain -- <tracker path>` is not empty. An ignored cache does not show there, so a search before `migrate` does not block it.

### `.gitignore`

`init` already writes `.issues/.gitignore` with `.cache/` from `templates/issues.gitignore`, and every tracker made by pmkit 0.1.0 or 0.2.0 has it. The file inside `.cache/` covers the trackers that lack it: one written by hand, one whose `.gitignore` was deleted, or the `team` test fixture. The index code never edits `.issues/.gitignore`, because a read must not change a tracked file. `init` and its template stay as they are.

### `reindex` and `/pmkit:local:doctor`

New CLI command `reindex`, listed in `COMMANDS` and in the README CLI table:

- It is not a write in the CLI's sense: no actor, no `--as`, no `--dry-run`, no auto-commit, no event. It changes only ignored files.
- It removes `index.json` and any leftover temp files in `.cache/`, runs a full parse of every issue folder, and writes a fresh index.
- Output: `{ written: true, path: ".issues/.cache/index.json", issues: <count>, problems: <count> }`. Text: `indexed <n> issues (<m> could not be read) in .issues/.cache/index.json`.
- When it cannot write (read-only disk, older format), it still exits 0 and returns `{ written: false, reason: "<message>" }` with a warning line. The doctor reports the reason. Searches keep working by scanning.

`commands/local/doctor.md`:

- Replace the "Cache" bullet of step 5, which says the cache does not exist, with a new step 6: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" reindex --json` and report how many issues it indexed, or the reason it could not write. It asks no question, because it changes no tracked file.
- The last `validate` run becomes step 7. The jumps in step 3 that say "go to step 6" now land on the rebuild step, which runs whatever state the config is in. A config that does not load makes `reindex` fail like any other command, and the doctor reports that.
- Add the rebuild result to the health report in "Output".

`validate` does not use the index and does not write it. It is the doctor's full check of every file, and it reads the event logs, epics, sprints and conflict markers in files the index never covers.

### Dry runs

A dry run writes nothing, and the cache counts. `CONTEXT.md` says a dry run "writes nothing, not even the event log", and `skills/pmkit/references/conventions.md` says nothing changes on disk. Two rules keep that true:

- **CLI.** When a command runs with `--dry-run`, `ctx.tracker()` builds the tracker with `index: 'read'`. Any read inside that command, such as `getIssue` in `pr open --dry-run`, may use the index but never creates `.cache/` or writes `index.json`.
- **Library.** `readAll()` takes `{ save }`. The two operations that take `dryRun` and reach `readAll()` pass `save: !dryRun`: `relate` (through `scanIssues` and `withComputed`) and `closeCycle` (through an internal search helper that `searchIssues` wraps, so the contract signature `searchIssues(filter)` does not change). The other write operations read single files through `readIssue` and never reach `readAll()`.

`hashTree` in `scripts/test-helpers.mjs` stays as it is, so the existing "nothing written" tests also prove that a dry run leaves `.cache/` alone.

### Library option

`createLocalTracker(root, { index = true })`. `true` reads and writes the index. `'read'` uses an existing index and never creates or writes anything. `false` never touches `.cache/`. The CLI passes `true`, or `'read'` on a dry run. The `false` value exists for the equivalence tests and for any caller that needs the plain scan. The library reads no environment variable for it, in line with how `PMKIT_NOW` and `PMKIT_SEED` stay in the CLI.

### Format, capabilities, contract and docs

- `FORMAT_VERSION` stays 2 and there is no migration. The cache is derived data that any pmkit version may delete or ignore. pmkit 0.2.0 never looks at `.cache/`, and when it edits an issue the new signature makes the next search with this version reparse it.
- The capability manifest does not change. The index is how the Local tracker serves `searchIssues`, not a feature a command can depend on, and the list of 20 capabilities is fixed.
- The contract does not change. `reindex` is a Local-only CLI command, like `validate` and `migrate`.
- ADR-0001: the consequence "The Local tracker has no index, so every search reads every issue file" becomes a line that says searches read the query index in `.issues/.cache/` and reparse only the changed files (PMK-7).
- `CONTEXT.md`: add a **Query index** entry: the cache of parsed issue files in `.issues/.cache/index.json`, rebuilt on read from file signatures, never committed, never a source of truth. _Avoid_: database, search engine.
- `README.md`: a `reindex` row in the CLI table.
- `CHANGELOG.md`: an entry in the next release section, with no `Tracker format:` line and no `Setup:` line.

## Testing

Tests use `node:test` and the fixtures in `scripts/__fixtures__/`, as the rest of the suite does.

**Equivalence (acceptance criterion 2).** A new `scripts/query-index.test.mjs` builds two trackers on the same copied fixture, one with `index: false` and one with `index: true`, and asserts `deepEqual` on `searchIssues(filter)` for a list of filters that covers every key of `FILTER_KEYS` (each sort, `text`, `blocked`, `archived`, `limit`, `assignee: 'me'`, `sprint: 'current'`). It runs that comparison on the `team` and `broken` fixtures, and on `basic` after the test creates a few issues (the fixture has none), in these states:

- cold index (no `.cache/`);
- warm index: build the index with one search, then set the mtime of `index.json` an hour forward with `fs.utimesSync`, so no entry is racy. Setting the issue files' mtimes back would not work: `makeRepo` copies the fixture at test time and `utimesSync` itself sets ctime to now, so every entry would stay racy and the test would never reach the signature check. Each later state edits a file and then moves `index.json` forward again, so the state tests the signature and not the racy rule;
- after a hand edit of one issue's title;
- after a same-size edit whose mtime is restored with `utimesSync` (ctime catches it);
- after deleting an issue folder, and after adding one by hand;
- after adding conflict markers to one file;
- after a status moves to another category in `config.yaml`;
- with `index.json` truncated, with invalid JSON, with a different `parser` or `format`, and with an entry missing its `sig`.

**Warm path reads nothing.** `readAll()` reports how many files it parsed and how many entries it reused, through an internal counter the test can reach (for example a `stats` object returned by the `query-index.mjs` helper). On a warm, settled index with no changes, a search parses 0 files. After one edit it parses 1.

**Racy entries.** A file whose mtime or ctime is within 2 seconds of the index file's mtime is reparsed, and the index is rewritten so it settles. The test builds the index without moving its mtime and checks that the next search reparses the fresh files.

**Dry runs.** `issues link --kind blocks --dry-run`, `cycle close --dry-run` and `pr open --dry-run` (with the git host faked as in `cli-pr.test.mjs`) leave no `.cache/` in a tracker that had none, and leave an existing `index.json` byte for byte the same. The library calls `link(..., { dryRun: true })` and `closeCycle(..., { dryRun: true })` do the same.

**Failures.** With `.cache` created as a plain file, and with the tracker folder made read-only (skipped when the tests run as root), searches return the same result as `index: false` and throw nothing. A tracker on an older format creates no `.cache/` in the real folder.

**Git.** In a git repository whose tracker has no `.issues/.gitignore`, after `issues list` runs, `git status --porcelain` is empty, and an auto-commit write (`auto_commit: true`) commits no file under `.cache/`.

**CLI.** `reindex --json` on a fixture returns `written: true` with the issue and problem counts, and `issues list --json` gives the same output before and after it. `reindex` on a read-only tracker returns `written: false` and exits 0.

**Existing tests.** The Local contract suite in `scripts/contract.test.mjs` runs once more with `index: false`, so both paths pass the contract. A test that hashes a tree after a non-dry-run read may now see `.cache/`. The builder fixes that test (by building its tracker with `index: false` or hashing only the tracked files), not `hashTree`.

## Decisions

| Decision | Reason |
|---|---|
| Detect changes with `size`, `mtimeMs`, `ctimeMs` and `ino` from one stat, taken before the read | One stat per file and no file read for unchanged issues. ctime catches tools that restore mtime, ino catches atomic renames and checkouts. Stat before read means a race can only cost a reparse. |
| Treat entries within 2 seconds of the index file's mtime as changed, and rewrite the index when any were found | Handles 1 to 2 second timestamp resolution the way git does, using the file system's own clock. |
| No content hash | It would read every file on every search and save only the parsing. |
| The index is maintained on read only; writes do not touch it | Hand edits and `git pull` bypass the CLI anyway, so reads must check signatures. A second writer to the index adds a concurrency case to save one parse. |
| Store the full parsed issue, and parse problems, per folder | `issues list --json` returns the whole issue and `withComputed` needs every issue's links. Caching problems keeps the `problems` list identical. |
| Comments and events stay out of the index | The text search reads only title and description. No filter reads comments or events. |
| Discard the whole index when `schema`, `FORMAT_VERSION`, the parser source hash or the status map changes | Each of them changes what a parse returns. A full rebuild costs one scan and keeps results identical. |
| `.issues/.cache/.gitignore` containing `*`, written by the index code; `init` and `.issues/.gitignore` unchanged | Works in trackers that lack the tracker-level `.gitignore`, without a read editing a tracked file. `init` already writes `.cache/` into `.issues/.gitignore`. |
| Every index failure falls back to the plain scan, silently on reads | The index is a speed-up. A warning on every read of a read-only checkout would be noise. |
| No lock between processes; atomic rename, last writer wins | Entries are self-checking through their signatures, so an older write costs a reparse, never a wrong result. |
| Index off when the tracker reads a migrated temp copy; `planMigration` skips `.cache` | The copy dies with the process and holds a different shape. |
| New CLI command `reindex`, not a write, exit 0 with `written: false` when it cannot write | The MVP spec names the operation `reindex`. It changes only ignored files, so it needs no actor, preview or auto-commit. |
| `/pmkit:local:doctor` runs `reindex` as a new step 6, with no confirmation | It changes no tracked file. |
| `validate` neither reads nor writes the index | It is the full check of every file and covers files the index does not hold. |
| `FORMAT_VERSION`, the capability manifest and the contract stay as they are | The cache is derived, ignored by git and optional. Older pmkit versions keep working on the same repository. |
| A dry run never creates or writes the cache: the CLI builds the tracker with `index: 'read'`, and `relate` and `closeCycle` pass `save: !dryRun` to `readAll()` | `CONTEXT.md` and the conventions promise that a dry run changes nothing on disk. The library rule covers callers other than the CLI. |
| Library option `index` (`true`, `'read'` or `false`; default `true`), no environment variable | The equivalence tests need both paths and dry runs need a read-only one. The library reads no environment variables. |
| Warm-state tests move the mtime of `index.json` forward instead of moving the issue files back; no `racyMs` option | `utimesSync` sets ctime to now, so moving files back leaves every entry racy. Moving the index forward needs no API change. |
| `hashTree` unchanged, and the contract suite also runs with `index: false` | The "nothing written" tests then also prove that dry runs leave the cache alone. Both read paths must pass the contract. |

## Acceptance criteria

| Criterion | Where the design covers it |
|---|---|
| `issues list` reads the index and rebuilds the entries whose files changed | "Read path" steps 1 to 6, "Change detection", "Who uses it" (`searchIssues` calls `readAll`). Tests: "Warm path reads nothing", the edit, delete and add states of "Equivalence". |
| Results are the same with and without the index | "Index shape" (header discards), "Change detection" (stat before read, racy rule), "Failures and concurrency" (fallback to the scan), the JSON round-trip note in "Read path". Tests: "Equivalence" across fixtures, filters and states, and the contract suite with `index: false`. |
| `/pmkit:local:doctor` rebuilds the index | "`reindex` and `/pmkit:local:doctor`": the `reindex` command and doctor step 6. Tests: "CLI". |

## Left to the builder

- Whether the tracker keeps the loaded index in memory between `readAll()` calls of one command.
- How `readAll()` exposes the parse and reuse counts to tests, as long as the public `searchIssues` result does not change.
- The exact text output of `reindex` and the wording of the doctor step.
- The release number and heading of the changelog entry.
