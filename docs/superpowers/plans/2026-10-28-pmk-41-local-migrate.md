# PMK-41 local-migrate implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pmkit local-migrate export|import|status|undo|switch` moves a Local tracker to one Linear team and back, keeps parents, blockers and links through an ID map, and shows the full preview before any write.

**Architecture:** One pure engine under `scripts/lib/migrate/` (snapshot, plan, preview, ID map, run loop) and, per side, a reader that returns a snapshot, a pure field mapper and a writer that creates one record at a time with an ID the engine chose. The CLI glue lives in `scripts/lib/migrate/cli.mjs`, and `scripts/pmkit.mjs` only registers the five commands.

**Tech Stack:** Node.js ESM, `node:test`, `node:crypto`, the existing Linear client and fake, the Local tracker modules. No dependency.

**Spec:** `docs/superpowers/specs/2026-10-28-pmk-41-local-migrate-design.md`. Read it before any task. This plan cites its section names in quotes.

## Global constraints

- `package.json` gains no dependency (ADR-0003).
- `npm test` opens no socket. Every Linear test passes `fakeLinearFetch` through `linearDescriptor({ fetch })` or `createLinearClient({ fetch })`.
- No change to the Local tracker format, to `EVENT_KEYS`, to any existing golden file or to any existing scenario snapshot.
- The Linear key never appears in output, an error, the map file or a command line (ADR-0005). Tests use `FAKE_KEY` and assert it is absent from every output they read.
- Examples and fixtures use `acme` and `ACME`. Live commands use `$PMKIT_LIVE_WORKSPACE`. Run the private-name check (`/home/fred/projects/pmkit-worktrees/check-private-names.sh`) before every commit. Only the accepted hits under `.issues/` may show.
- Every commit subject ends with `(PMK-41)`, and the message ends with exactly this line: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit with `git commit -m "<subject> (PMK-41)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.
- Code comments, messages and docs follow `~/.claude/skills/unslop/SKILL.md`.
- The map file is `.pmkit/migrations/<YYYY-MM-DD>-<direction>-<system>.yaml`, with `-2`, `-3` before `.yaml` for a second map of the same day. `version: 1`.
- The reserve is 100 requests and 10,000 complexity points. The engine stops before a write when `requests.remaining <= 100` or `complexity.remaining <= 10000`.
- The attribution line is `Comment by <name> on <YYYY-MM-DD> in <old id>`, then one blank line, then the body.
- Fixed messages, copied from the spec:
  - `import needs a Local tracker with no issues and no epics`, next step `Move the old records out with git rm -r .issues/issues .issues/epics .issues/sprints, commit, and run the import again` (`CONFLICT`).
  - `the plan changed since the preview`, next step `Run the dry run again and confirm the new preview` (`CONFLICT`).
  - `stopped before Linear's request limit: <done> of <total> records are done`, next step `Run the same command again after <resetAt> to resume` (`RATE_LIMITED`).
  - `.pmkit/migrations/<file> is not valid: <why>`, next step `Fix the file; do not delete it while the migration is unfinished` (`INVALID_INPUT`).
  - Failure next step: `Fix the cause and run pmkit local-migrate export again to resume` (`import` for an import map).
  - `the migration in <file> is not finished` or `the migration in <file> has <n> failed records`, next step `Run pmkit local-migrate status` (`CONFLICT`).
  - `switch --to linear needs a finished export map` and `switch --to local needs a finished import map` (`INVALID_INPUT`).

## Decisions this plan adds

The spec leaves these open or does not reach them. Each one changes no acceptance criterion.

1. **The orchestration is in `scripts/lib/migrate/cli.mjs`**, not in `pmkit.mjs`, which is already 1,834 lines. `pmkit.mjs` keeps the command table entries, the `systems` check and the JSON error field.
2. **The field mapping is a pure module per target**: `scripts/lib/linear/migrate-fields.mjs` (export) and `scripts/lib/local/migrate-fields.mjs` (import). `plan.mjs` stays generic: order, actions, counts, budget, digest.
3. **No UUID is in the plan.** A record refers to another record by `{ kind, key }`, and the run loop puts in the UUID or ID from the map. So the digest of a dry run equals the digest of the run that follows it.
4. **`snapshotDigest` leaves out `read`**, so two reads of an unchanged source give the same digest.
5. **Random Local IDs on import come from a source seeded by the snapshot digest**, so the dry run and the run plan the same IDs.
6. **Local label names on import follow the Local label rule** `^[a-z0-9][a-z0-9_-]*$`: lower-case, and every run of other characters becomes one `-`, with leading and trailing `-` removed. A name left empty is a plan problem. A Linear label that `mappings.types` names becomes the issue's `type`, not a label. The preview lists each renamed label under "will not carry over" as `labels renamed`.
7. **Sent status updates and labels are checked with the reads that exist** (`PROJECT_UPDATES_QUERY` per project and a discovery refresh), so the only new by-ID documents are `ISSUES_BY_IDS`, `COMMENTS_BY_IDS` and `PROJECTS_BY_IDS`.
8. **Import never commits**, whatever `auto_commit` says. The output tells the user to commit `.issues/` and the map. Export writes no Local file.
9. **Resuming an import accepts its own writes.** The clean-tree check and the empty-tracker check skip what the unfinished import map lists, as long as `HEAD` still equals the commit the map recorded.
10. **`--as` on export** accepts the key owner's Linear user id or the Local member whose email equals the key owner's email. Any other value gets the `requireViewer` error of PMK-35.

## Review focus

The failure modes most likely to hurt a user that no other task's tests cover. Each line names the task that adds its test.

1. A rerun of a partial import finds `.issues/` dirty and non-empty from its own writes. It must resume, not refuse (Task 14, `import resumes over its own uncommitted files`).
2. A crash after the map says `sent` and before the mutation goes out. The rerun must find nothing by UUID and send the create once, with the same UUID (Task 5, `a sent entry that Linear lacks is sent again with the same UUID`).
3. A rerun after a finished export, when the new issues have parents or blockers among the issues already exported. The refs must resolve from the finished map (Task 3, `refs to records of a finished map resolve as known`, and Task 13, `a second export sends only the new issues and links them to the old ones`).
4. Linear answers without rate-limit headers, so `rateLimit()` is null. The run must go on, and the preview must say the budget is unknown (Task 4, `the budget line says unknown without headers`, and Task 5, `no headers means no reserve stop`).
5. Emails and label names outside the Local rules (`ana.souza+pm@example.com`, `Needs Review`, two users whose emails share the part before `@`). They must give valid, distinct IDs and names (Task 11, `member ids follow the rule`, `labels follow the Local label rule`).

## Files

| File | Task |
|---|---|
| `scripts/lib/migrate/snapshot.mjs`, `snapshot.test.mjs` | 1 |
| `scripts/lib/migrate/id-map.mjs`, `id-map.test.mjs` | 2 |
| `scripts/lib/migrate/plan.mjs`, `plan.test.mjs` | 3 |
| `scripts/lib/migrate/preview.mjs`, `preview.test.mjs` | 4 |
| `scripts/lib/migrate/run.mjs`, `run.test.mjs` | 5 |
| `scripts/lib/local/migrate-reader.mjs`, `scripts/lib/local/migrate-reader.test.mjs`, `scripts/migrate-fixture.mjs` | 6 |
| `scripts/lib/linear/documents.mjs`, `scripts/lib/linear/projects.mjs`, `scripts/fake-linear-api.mjs`, `scripts/fake-linear-api.test.mjs` | 7 |
| `scripts/lib/linear/migrate-fields.mjs`, `migrate-fields.test.mjs` | 8 |
| `scripts/lib/linear/migrate-writer.mjs`, `migrate-writer.test.mjs`, `scripts/lib/linear/tracker.mjs` | 9 |
| `scripts/lib/linear/migrate-reader.mjs`, `migrate-reader.test.mjs` | 10 |
| `scripts/lib/local/migrate-fields.mjs`, `migrate-fields.test.mjs` | 11 |
| `scripts/lib/local/migrate-writer.mjs`, `migrate-writer.test.mjs` | 12 |
| `scripts/lib/migrate/cli.mjs`, `scripts/pmkit.mjs`, `scripts/lib/args.mjs`, `scripts/cli-migrate.test.mjs` | 13 to 17 |
| `commands/local/migrate.md`, `skills/pmkit/SKILL.md`, `README.md`, `scripts/plugin.test.mjs` | 18 |
| `scripts/golden-cases.mjs`, `scripts/__goldens__/*/local-migrate-*.txt`, `scripts/cli-hosted.test.mjs`, `scripts/__scenarios__/local-migrate.mjs` and its snapshots, `scripts/__scenarios__/_inputs/import-map.yaml` | 19 |
| `CONTEXT.md`, `CHANGELOG.md`, `scripts/lib/linear/API-VERIFICATION.md` | 20 |
| `scripts/lib/linear/migrate-live.mjs` | 21 (after PMK-39 merges) |

## Acceptance criteria map

| Criterion | Tasks |
|---|---|
| 1. Exports `.issues/` to Linear and imports from Linear into `.issues/` | 6 and 8 to 10 (export side), 10 to 12 (import side), 13 and 14 (the commands), 17 (round trip over the fake), 21 (live) |
| 2. Maps IDs and keeps parents, blockers and links | 1 (one link shape), 2 (the map), 3 (parents first, refs), 5 (write ahead, resume), 8 and 11 (`parentId`, `projectId`, `blocked_by`, round-trip IDs), 12, 17 |
| 3. Shows the full preview before writing | 3 (losses, problems, digest), 4 (the text and JSON preview), 13 to 15 (`--dry-run` writes nothing, `--expect`), 18 (the command always runs the dry run first and asks) |

---

### Task 1: Snapshot helpers

**Files:**
- Create: `scripts/lib/migrate/snapshot.mjs`
- Test: `scripts/lib/migrate/snapshot.test.mjs`

**Interfaces:**
- Produces:
  - `stableStringify(value) -> string`: JSON with object keys sorted at every depth.
  - `snapshotDigest(snapshot) -> 'sha256:<64 hex>'`: SHA-256 of `stableStringify` of the snapshot without `read`.
  - `localLinks(issues) -> Link[]`, where `Link = { kind: 'blocks'|'related'|'duplicate', from, to }`. Input issues carry `blockedBy`, `related` and `duplicateOf` (the model shape).
  - `linkKey(link) -> string`, such as `blocks PMK-35 PMK-38`.
  - `attributionLine({ name, created, issue }) -> string`.
  - `stripAttribution(body) -> { body, name, date, issue } | null`.
  - `validateSnapshot(snapshot) -> string[]`: problems in the shape of "The snapshot" (missing arrays, a record without `id`, a link end that is not a string).
  - `EXPORT_KINDS = ['label', 'epic', 'issue', 'link', 'comment', 'thread', 'update', 'archive']`, `IMPORT_KINDS = ['member', 'label', 'sprint', 'epic', 'update', 'issue', 'comment']`.

- [ ] **Step 1: Write the failing tests**

```js
test('localLinks turns blocked_by, related and duplicate_of into one link each', () => {
  const issues = [
    { id: 'ISS-2', blockedBy: ['ISS-1'], related: ['ISS-1'], duplicateOf: [] },
    { id: 'ISS-1', blockedBy: [], related: ['ISS-2'], duplicateOf: [] },
    { id: 'ISS-3', blockedBy: [], related: [], duplicateOf: ['ISS-1'] },
  ]
  assert.deepEqual(localLinks(issues), [
    { kind: 'blocks', from: 'ISS-1', to: 'ISS-2' },
    { kind: 'duplicate', from: 'ISS-3', to: 'ISS-1' },
    { kind: 'related', from: 'ISS-1', to: 'ISS-2' },
  ])
})
test('linkKey names the kind and both ends', () => assert.equal(linkKey({ kind: 'blocks', from: 'PMK-35', to: 'PMK-38' }), 'blocks PMK-35 PMK-38'))
test('snapshotDigest ignores read and key order', () => {
  const a = { system: 'local', read: '2026-10-28T20:00:00Z', issues: [{ id: 'X', title: 't' }] }
  const b = { issues: [{ title: 't', id: 'X' }], read: '2026-10-29T08:00:00Z', system: 'local' }
  assert.equal(snapshotDigest(a), snapshotDigest(b))
  assert.match(snapshotDigest(a), /^sha256:[0-9a-f]{64}$/)
  assert.notEqual(snapshotDigest(a), snapshotDigest({ ...a, issues: [{ id: 'X', title: 'u' }] }))
})
test('attributionLine and stripAttribution round-trip', () => {
  const line = attributionLine({ name: 'Ana Souza', created: '2026-10-28T18:11:19Z', issue: 'ISS-5N1R' })
  assert.equal(line, 'Comment by Ana Souza on 2026-10-28 in ISS-5N1R')
  assert.deepEqual(stripAttribution(`${line}\n\nLooks good.`), { body: 'Looks good.', name: 'Ana Souza', date: '2026-10-28', issue: 'ISS-5N1R' })
})
test('stripAttribution needs the exact shape and the blank line', () => {
  assert.equal(stripAttribution('Comment by Ana on 2026-10-28 in ISS-1\nno blank line'), null)
  assert.equal(stripAttribution('comment by Ana on 2026-10-28 in ISS-1\n\nbody'), null)
  assert.equal(stripAttribution('Looks good.'), null)
})
test('validateSnapshot names a record without an id', () => {
  assert.deepEqual(validateSnapshot({ system: 'local', people: [], labels: [], epics: [], sprints: [], issues: [{ title: 'x' }], links: [], comments: [] }), ['issues[0] has no id'])
})
```

- [ ] **Step 2: Run** `node --test scripts/lib/migrate/snapshot.test.mjs`. Expected: FAIL, the module does not exist.
- [ ] **Step 3: Implement** the exports above. `stripAttribution` matches `^Comment by (.+) on (\d{4}-\d{2}-\d{2}) in (\S+)\n\n` at the start of the body. `localLinks` sorts by `linkKey`. A related pair keeps the lower ID first (`compareIds` from `scripts/lib/ids.mjs`).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(migrate): add the snapshot helpers (PMK-41)`.

### Task 2: The ID map file

**Files:**
- Create: `scripts/lib/migrate/id-map.mjs`
- Test: `scripts/lib/migrate/id-map.test.mjs`

**Interfaces:**
- Consumes: `writeFileAtomic` from `scripts/lib/local/store.mjs`, `parseYaml` and `stringifyYaml` from `scripts/lib/yaml.mjs`.
- Produces:
  - `MIGRATIONS_DIR = '.pmkit/migrations'`.
  - `mapFileName(root, { date, direction, system }) -> string`: the root-relative path, with `-2` and up when the name is taken.
  - `newMap({ direction, started, source, target, mappings, people }) -> MapData` with `version: 1`, `finished: null`, `records: {}`.
  - `readMap(root, file) -> MapData`. Throws the `INVALID_INPUT` error of Global constraints for unreadable YAML, a missing key, or `version` other than 1.
  - `createMapStore(root, file, map) -> { file, map, entry(kind, key), set(kind, key, entry), finish(at) }`. `set` and `finish` write the whole file through `writeFileAtomic`, every time.
  - `listMaps(root) -> [{ file, map }]`, newest first: by date, then by suffix number. An unreadable file throws the `readMap` error.
  - `chooseMap(root, { direction, target, file }) -> { resume: { file, map } | null, finished: [{ file, map }] }`. With `file`, that map is `resume` when it is unfinished. Otherwise `resume` is the newest unfinished map with the same direction and target, and `finished` holds every finished map with the same target.
  - `sameTarget(a, b) -> boolean`: same `system`, and the same `workspace` and `team` (Linear) or the same `path` (Local).
  - `mapCounts(map) -> { kinds: { [kind]: { done, sent, failed, removed } }, failed: [{ kind, key, error }], total, done }`.
  - `MapEntry = { state: 'sent'|'done'|'failed'|'removed', uuid?, id?, at?, created?, error?: { code, message } }`.

- [ ] **Step 1: Write the failing tests**
  - `mapFileName adds -2 for a second map of the day`: with `2026-10-28-export-linear.yaml` present, expect `.pmkit/migrations/2026-10-28-export-linear-2.yaml`.
  - `set writes the file after every state change`: create a store, `set('issue', 'ISS-1', { state: 'sent', uuid: 'u1' })`, read the file back with `readMap` and see `sent`. `set` again with `done` and `id: 'ACME-1'`, read back, see `done`.
  - `readMap refuses a bad file and leaves it`: write `version: 2` and, in a second case, `records: [`. Expect `INVALID_INPUT`, the message `.pmkit/migrations/<file> is not valid: version must be 1` (and `: not valid YAML` for the second), the next step of Global constraints, and the file bytes unchanged.
  - `chooseMap resumes the newest unfinished map of the same target`: three maps, one finished export to `acme/ACME`, one unfinished export to `acme/ACME`, one unfinished export to `acme/OTHER`. Expect `resume` is the second, `finished` is the first.
  - `chooseMap with a finished newest map returns no resume`: expect `resume: null` and the finished map in `finished`.
  - `mapCounts counts each state per kind`.
- [ ] **Step 2: Run** `node --test scripts/lib/migrate/id-map.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the exports. `stringifyYaml` writes `records` as nested maps. The keys of `records.link` hold spaces and the keys of `records.comment` hold `/`, so the writer quotes keys that are not plain words. Check that `parseYaml` reads them back, and quote with double quotes if it does not.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(migrate): add the ID map file (PMK-41)`.

### Task 3: The plan engine

**Files:**
- Create: `scripts/lib/migrate/plan.mjs`
- Test: `scripts/lib/migrate/plan.test.mjs`

**Interfaces:**
- Consumes: `stableStringify` (Task 1), `MapData` and `MapEntry` (Task 2).
- Produces:
  - `RESERVE = { requests: 100, complexity: 10000 }`.
  - `Mapped = { records: { [kind]: PlanRecord[] }, losses: Loss[], problems: Problem[], people: PersonMatch[], readRequests: number }`, the output of a field mapper (Tasks 8 and 11). `PlanRecord = { key, source, target, fields, refs, dropped }`. `refs` maps a field name to `{ kind, key }` or to an array of them. `Loss = { what, count, ids, why }`. `Problem = { kind, key, code, message }`, `code` one of `no_state`, `no_type_label`, `parent_loop`, `line_break`, `bad_label`, `sprint_clash`.
  - `orderParentsFirst(issues) -> issues`: each parent issue before its children, otherwise by `created`, then by `id`.
  - `parentLoops(issues) -> string[][]`: each loop as its list of IDs, smallest ID first.
  - `planMigration({ direction, source, target, snapshot, mapped, map, known }) -> Plan`. `map` is the map being resumed or null. `known` is `{ [kind]: { [key]: { uuid, id } } }`, from the finished maps.
  - `Plan = { direction, source, target, steps, records, people, losses, problems, resume, digest, requests }`. `steps` is `[{ step, kind, records, requests }]` in the order of "Order of writes" (export: 0 reads, 1 label, 2 epic, 3 issue, 4 link, 5 comment, 6 thread, 7 update, 8 archive; import: 0 reads, 1 member, 2 label, 3 sprint, 4 epic, 5 update, 6 issue, 7 comment). Each record gains `action: 'create' | 'skip'` and, for a skip, `target` set to the ID from `map` or `known`. `resume` is `{ map: file | null, done, sent, failed }`.
  - `planBudget(plan, rate) -> { requests, remaining, reserve, resetAt, fits, stopsAfter }`. `rate` is `client.rateLimit()` or null. With null, `remaining`, `resetAt` and `fits` are null.
  - `planDigest(plan) -> 'sha256:<hex>'`: over `direction`, `source`, `target` and, per record, `kind`, `key`, `action`, `fields` and `refs`. Never over `budget` or `resume`.

- [ ] **Step 1: Write the failing tests** over hand-built `snapshot` and `mapped` objects (no reader).
  - `issues go parents first, then by creation time`: `ISS-3` created first with parent `ISS-2`, `ISS-2` with parent `ISS-1`. Expect the order `ISS-1, ISS-2, ISS-3`.
  - `a parent loop is a problem and blocks the plan`: `ISS-1` parent `ISS-2`, `ISS-2` parent `ISS-1`. Expect one problem `{ kind: 'issue', key: 'ISS-1', code: 'parent_loop', message: 'parent loop ISS-1 > ISS-2 > ISS-1' }`.
  - `comments go roots before replies, oldest first`, and `archive is the last step`.
  - `a record done in the map is a skip with its target`: map entry `{ state: 'done', id: 'ACME-4' }` on `ISS-1` gives `{ action: 'skip', target: 'ACME-4' }`, and `resume.done` is 1.
  - `refs to records of a finished map resolve as known` (Review focus 3): `known.issue['ISS-1'] = { uuid: 'u1', id: 'ACME-1' }`, a new `ISS-9` with `refs.parentId = { kind: 'issue', key: 'ISS-1' }`, and no `ISS-1` record in `mapped`. Expect no problem and `ISS-9` as the only create.
  - `the request count follows the spec formula`: 165 issues, 10 epics, 2 labels, 148 links, 88 comments, 3 threads, 0 updates, 0 archives, `readRequests: 10`. Expect `requests` 426 and the step rows of "The preview".
  - `sent entries add one check read per 100 per kind`: 150 issues `sent` in the map add 2.
  - `planBudget says where the run stops`: rate `{ requests: { remaining: 300, resetAt: '2026-10-28T21:06:00Z' } }` and 426 requests give `fits: false` and `stopsAfter: 200`. Rate with 2,488 left gives `fits: true`.
  - `the digest changes when a record changes and not when the budget does`.
  - `losses and problems from the mapper pass through unchanged`.
- [ ] **Step 2: Run** `node --test scripts/lib/migrate/plan.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the exports. `stopsAfter` is `remaining - reserve - steps[0].requests`, and never below 0. A sent or failed entry stays a `create`, so the run checks it before it sends (Task 5). An import has write steps with `requests: 0`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(migrate): plan the order, the requests and the digest (PMK-41)`.

### Task 4: The preview

**Files:**
- Create: `scripts/lib/migrate/preview.mjs`
- Test: `scripts/lib/migrate/preview.test.mjs`

**Interfaces:**
- Consumes: `Plan` (Task 3), the output of `planBudget`.
- Produces:
  - `previewText(plan, budget, { dryRun, header }) -> string`, the text of "The preview". `header` is `{ source: string, target: string, sourceCounts: string, targetCounts: string }`, which the CLI builds.
  - `previewJson(plan, budget) -> object`, the JSON shape of "The preview": `{ direction, source, target, steps, records, people, losses, problems, budget, resume, digest }`. Each record is `{ source, action, target, fields, dropped }`.

- [ ] **Step 1: Write the failing tests**
  - `the text preview has every section in order`: build a plan with one record per kind, then assert the line order `export .issues/ (commit 87cc467) to Linear team ACME in workspace acme`, `source: ...`, `target: ...`, the step table, `budget: ...`, `people`, `epics`, `issues`, `links`, `will not carry over`, `digest: sha256:...`, and `dry run: nothing was written` last when `dryRun` is true.
  - `the step table matches the spec example`: the 426-request plan of Task 3 gives the lines of the table in "The preview", column for column. The links row reads `links (86 blocks, 62 related, 0 duplicate)`.
  - `a record line per record`: `ISS-1   Add the config loader     new issue, Done, parent EPC-1, sprint 2026-10-12 has no cycle`.
  - `a resume adds the done, sent and to-send column`, and a skip line reads `done ACME-12`.
  - `the budget line says where the run stops` when `fits` is false: `the run stops after about 200 writes; run it again after 21:06Z to finish`.
  - `the budget line says unknown without headers` (Review focus 4): `budget: 426 requests; Linear has not said how many are left this hour`.
  - `problems come before the step table and say the run will refuse`.
  - `previewJson has the spec keys`: `Object.keys(previewJson(plan, budget))` equals the list above.
- [ ] **Step 2: Run** `node --test scripts/lib/migrate/preview.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** with `table` from `scripts/lib/format.mjs` for the step table and the record lists. An import has no budget line.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(migrate): print the full preview (PMK-41)`.

### Task 5: The run loop

**Files:**
- Create: `scripts/lib/migrate/run.mjs`
- Test: `scripts/lib/migrate/run.test.mjs`

**Interfaces:**
- Consumes: `Plan` (Task 3), the store of `createMapStore` (Task 2).
- Produces:
  - `Writer = { system, chooseId(kind, record) -> string, exists(kind, entries) -> Promise<Map<key, { id }>>, create(kind, record, chosenId, fields) -> Promise<{ id }>, remove(kind, entry) -> Promise<void>, budget() -> rate | null, isUnconfirmed(error) -> boolean }`. `entries` is `[{ key, uuid, record }]`. Tasks 9 and 12 build one each.
  - `checkExpect(plan, expect) -> void`: throws the `CONFLICT` of Global constraints when `expect` is set and differs from `plan.digest`.
  - `reconcile(store, writer) -> Promise<{ found, missing }>`: before the first write, looks up every `sent` and `failed` entry with `writer.exists`, per kind. A found entry becomes `done` with its ID and `at`. A missing one keeps its UUID.
  - `resolveFields(record, store, known) -> object`: `fields` with each ref replaced by the UUID (export) or the ID (import) from the store or `known`.
  - `runPlan({ plan, store, writer, known, now }) -> Promise<{ done, total }>`.

- [ ] **Step 1: Write the failing tests** over `fakeWriter({ failAt, unconfirmedAt, existing, rates })`, defined in the test file. It records each call.
  - `a failure at record k stops with k-1 done and one failed`: three issues, `failAt: 2`. Expect two calls, the map holds `done`, `failed` with `{ code: 'UPSTREAM', message }`, and no entry for the third. The error is the writer's, its `written` holds `{ done: 1, total: 3 }`, and its next step is the failure next step of Global constraints.
  - `a rerun resumes and sends each record once`: rerun the same plan with the same store and no failure. Expect each record created exactly once over both runs.
  - `a sent entry that Linear lacks is sent again with the same UUID` (Review focus 2): map entry `{ state: 'sent', uuid: 'u1' }`, `existing` empty. Expect one `create` with `chosenId: 'u1'`.
  - `a sent entry that exists becomes done with no create`: `existing` has `u1` as `ACME-7`. Expect no create and `{ state: 'done', id: 'ACME-7' }`.
  - `an unconfirmed create found by UUID counts as done`: `unconfirmedAt: 1` and the record exists afterwards. Expect `done` and the run goes on.
  - `an unconfirmed create not found is failed`.
  - `the map says sent before the create goes out`: the fake writer reads the map file inside `create` and sees `sent` with the chosen UUID.
  - `the reserve stops the run before a write`: `rates` gives `requests.remaining` 101, then 100. Expect one create, then `RATE_LIMITED` with `stopped before Linear's request limit: 1 of 3 records are done` and the next step with the `resetAt`. Complexity 10,000 stops the same way.
  - `no headers means no reserve stop` (Review focus 4): `budget()` returns null. Expect all creates.
  - `checkExpect refuses a changed plan before any write`.
  - `finish sets finished when every record is done`.
  - `refs resolve to the UUID of the parent created earlier in the run`.
- [ ] **Step 2: Run** `node --test scripts/lib/migrate/run.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the loop of "Running and resuming": for each `create` record in step order, check the budget, `store.set(kind, key, { state: 'sent', uuid })`, call `writer.create`, then `store.set` with `done`, the returned ID and `now()`. On an error, ask `writer.isUnconfirmed(error)`; when true, one `writer.exists` for that record decides. Never wait and never retry a create.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(migrate): run a plan with write-ahead and resume (PMK-41)`.

### Task 6: The Local reader and the migration fixture

**Files:**
- Create: `scripts/lib/local/migrate-reader.mjs`, `scripts/migrate-fixture.mjs`
- Test: `scripts/lib/local/migrate-reader.test.mjs`

**Interfaces:**
- Consumes: `createLocalTracker`, `readEvents`, `parseUpdateFile`, `localLinks` (Task 1).
- Produces:
  - `readLocalSnapshot({ root, config, tracker, commit, now }) -> Snapshot`, with `system: 'local'`, `scope: { path }`, `commit`, and `outOfScope: { releases, timeLogs, documents, milestones }` as counts for the losses. People are `{ id, name, email, app: false }`. Each epic has `created` (its `create` event) and `updates` with `id: '<epic>/<file stem>'`. Each comment has `id: '<issue>/<comment id>'`. `completed` is the newest move to a `done` or `canceled` status in `events.jsonl`, or null.
  - In `scripts/migrate-fixture.mjs`: `buildMigrationFixture(root, { now }) -> { ids }`. It writes, through `createLocalTracker` on a copy of the `basic` fixture: an epic, a parent chain of three issues under it, a blocker pair, a related pair, a duplicate, a comment thread of a root and a reply, a resolved thread, an archived issue, a `done` issue with an estimate of 3, a member `ada` with `ada@example.com`, and a planned sprint. Then it runs `git init`, adds and commits, with `-c user.name=pmkit -c user.email=pmkit@example.com`. `ids` names each record by role (`epic`, `root`, `child`, `grandchild`, `blocker`, `blocked`, `relatedA`, `relatedB`, `duplicate`, `original`, `threaded`, `resolved`, `archived`, `done`).

- [ ] **Step 1: Write the failing tests**
  - `the snapshot holds every record of the fixture`: counts of issues (archived one included), epics, sprints, links (one per kind and pair), and comments.
  - `links come from the frontmatter, once each`: the blocker pair gives `{ kind: 'blocks', from: blocker, to: blocked }`.
  - `completed is the time of the move to done`.
  - `the reader writes nothing`: `hashTree(root)` before equals after.
  - `outOfScope counts time logs`: one `log-time` in the fixture gives `timeLogs: 1`.
- [ ] **Step 2: Run** `node --test scripts/lib/local/migrate-reader.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** with the tracker's reads listed in "The snapshot". Check how `searchIssues` returns archived issues (`checkFilter` in `scripts/lib/issue-filter.mjs`), and read both sets if one filter does not return all of them.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(local): read the tracker as a migration snapshot (PMK-41)`.

### Task 7: The new Linear documents and the fake

**Files:**
- Modify: `scripts/lib/linear/documents.mjs`, `scripts/lib/linear/projects.mjs`, `scripts/fake-linear-api.mjs`
- Test: `scripts/fake-linear-api.test.mjs`, `scripts/lib/linear/documents.test.mjs`

**Interfaces:**
- Produces documents, each with a `Pmkit` operation name:
  - `ISSUES_BY_IDS` (`PmkitIssuesByIds($ids: [ID!])`): `issues(filter: { id: { in: $ids } }, includeArchived: true, first: 100)` with `id identifier updatedAt archivedAt trashed relations(first: 50) { nodes { id } }`.
  - `COMMENTS_BY_IDS` (`PmkitCommentsByIds`): `comments(filter: { id: { in: $ids } }, first: 100) { nodes { id resolvedAt } }`.
  - `LABEL_CREATE` (`PmkitLabelCreate`), `LABEL_DELETE` (`PmkitLabelDelete`), `ISSUE_DELETE` (`PmkitIssueDelete($id: String!)`, with no `permanentlyDelete` variable).
  - In `projects.mjs`: `PROJECTS_BY_IDS` (`PmkitProjectsByIds`), `PROJECT_STATUSES` (`PmkitProjectStatuses`: `projectStatuses { nodes { id name type position } }`), `PROJECT_DELETE` (`PmkitProjectDelete`).
- The fake gains: those routes; `createdAt` and `completedAt` in `CREATE_FIELDS` (a given `createdAt` replaces the clock stamp); `createdAt` in the comment create fields; `id: { in }` in the issue, comment and project filters; deletes that set `trashed: true` on an issue and hide it from searches, as `toIssue` expects; `issueLabelCreate` that adds a team label; and `projectStatuses` with one status per type (`backlog`, `planned`, `started`, `paused`, `completed`, `canceled`).

- [ ] **Step 1: Write the failing tests**
  - In `documents.test.mjs`: `the new documents name their operation`, using `operationName` on each, and `ISSUE_DELETE sends no permanentlyDelete`.
  - In `fake-linear-api.test.mjs`: `issueCreate keeps a given createdAt and completedAt`, `issues by ids returns only the listed ids, archived included`, `issueDelete trashes the issue and searches skip it`, `labelCreate adds a team label that discovery lists`, `projectStatuses lists one status per type`, `an unknown input field still fails validation`.
- [ ] **Step 2: Run** `node --test scripts/fake-linear-api.test.mjs scripts/lib/linear/documents.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the documents and the fake routes. Keep the existing validation: a field outside the lists answers `GRAPHQL_VALIDATION_FAILED`.
- [ ] **Step 4: Run** the same command and `npm test`. Expected: PASS, and every existing test still passes.
- [ ] **Step 5: Commit** `feat(linear): add the documents a migration needs, and teach the fake (PMK-41)`.

### Task 8: The export field mapping

**Files:**
- Create: `scripts/lib/linear/migrate-fields.mjs`
- Test: `scripts/lib/linear/migrate-fields.test.mjs`

**Interfaces:**
- Consumes: `resolveMappings` and `teamStates` (PMK-34, PMK-35), `buildDescription` and `PRIORITY_TO_LINEAR` from `issues.mjs`, `estimateScale` from `discovery.mjs`, `toSprint`, `HEALTH_TO_LINEAR`, `attributionLine` and `linkKey` (Task 1).
- Produces:
  - `PROJECT_TYPE_OF_CATEGORY = { triage: 'backlog', backlog: 'backlog', todo: 'planned', in_progress: 'started', in_review: 'started', done: 'completed', canceled: 'canceled' }`.
  - `exportTarget({ raw, view, pmkit, teamKey, projectStatuses, cycles }) -> Target`: the team, its states in position order, the team and workspace labels by lower-cased name, the users by lower-cased email (apps left out), the estimate scale, the cycles as `toSprint` values with their IDs, and the resolved mappings.
  - `mapExport(snapshot, target) -> Mapped` (Task 3 shape), with `readRequests: 10`.

- [ ] **Step 1: Write the failing tests** over `fakeRaw()` from `scripts/fake-linear-nodes.mjs` and a hand-built snapshot.
  - `an issue maps every field of "Order of writes" step 3`: `fields` has `teamId`, `title`, `description` (from `buildDescription`), `stateId`, `labelIds`, `priority`, `estimate`, `assigneeId`, `dueDate`, `createdAt`, `completedAt` (only for `done`) and `cycleId`. `refs` has `parentId` for an issue parent and `projectId` for an epic parent.
  - `an issue under an issue under an epic gets both parentId and projectId`.
  - `the status uses the state of the same name and category, else the mapping`: `in_review` gives `In Review`, and a Local `qa` status in `in_progress` gives the `targetState` of `in_progress`.
  - `a category with no state and no mapping is a problem`: code `no_state`.
  - `a type with no label mapping is a problem`: code `no_type_label`.
  - `a label the team lacks becomes a label record and a ref`: `needs-criteria` gives a `label` record and `refs.labelIds`.
  - `the assignee matches by email, ignoring case`, and `a member with no Linear user is unassigned and listed in losses`.
  - `an estimate outside the scale is dropped`: `dropped` holds `estimate`, and the losses row counts it.
  - `a sprint matches a cycle by start and end, else no cycle and a loss`.
  - `a comment body starts with the attribution line`: `Comment by Ana Souza on 2026-10-28 in ISS-5N1R\n\nLooks good.`, `createdAt` set, and `refs.parentId` for a reply.
  - `an epic maps to a project with the status of its category`: `in_review` gives the `started` status ID.
  - `every export row of "What does not round-trip" appears in losses when its case is present`: one test with a snapshot that has a case of each row, and a check that `losses.map((l) => l.what)` holds every row name.
  - `links with a missing end are dropped and listed`.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/migrate-fields.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the two exports, following "Field by field (export)".
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(linear): map a Local snapshot to Linear creates (PMK-41)`.

### Task 9: The Linear writer

**Files:**
- Create: `scripts/lib/linear/migrate-writer.mjs`
- Modify: `scripts/lib/linear/tracker.mjs` (add `migration: { client, discovery }` next to `triage` in the returned object)
- Test: `scripts/lib/linear/migrate-writer.test.mjs`

**Interfaces:**
- Consumes: the documents of Task 7, `ISSUE_CREATE`, `RELATION_CREATE`, `COMMENT_CREATE`, `COMMENT_RESOLVE`, `ISSUE_ARCHIVE`, `PROJECT_CREATE`, `PROJECT_UPDATE_CREATE`, `PROJECT_UPDATES_QUERY`, `isUnconfirmed` from `issue-ops.mjs`, `Writer` (Task 5).
- Produces: `createLinearWriter({ client, discovery, uuid }) -> Writer` with `system: 'linear'`. `chooseId` returns `uuid()`. `create` sends one mutation per kind, with `id: chosenId` in the input and the fields unchanged. It returns the issue `identifier`, the canonical `epicId` of a project, or the UUID for the other kinds. `thread` sends `COMMENT_RESOLVE` on the root comment's UUID, and `archive` sends `ISSUE_ARCHIVE` on the issue's UUID. `remove` sends `ISSUE_DELETE`, `PROJECT_DELETE` or `LABEL_DELETE`. `budget` returns `client.rateLimit()`.
- `exists(kind, entries)` per kind: issues and archives through `ISSUES_BY_IDS` (100 per request), comments and threads through `COMMENTS_BY_IDS`, projects through `PROJECTS_BY_IDS`, links through the `relations` of the `from` issue in `ISSUES_BY_IDS`, updates through `PROJECT_UPDATES_QUERY` of their project, labels through `discovery({ refresh: true })`. An archive counts only when `archivedAt` is set, and a thread only when `resolvedAt` is set.

- [ ] **Step 1: Write the failing tests** over `fakeLinearFetch({ ...fakeWorkspace(), ...issues.routes, ...projects.routes })` and `createLinearClient({ env: { LINEAR_API_KEY: FAKE_KEY }, tracker, fetch })`.
  - `each create sends the chosen id and every field`: for each kind, read `fetch.calls` and compare `variables.input`.
  - `exists finds issues by UUID, 100 per read`: 150 sent issues send 2 `PmkitIssuesByIds` reads.
  - `exists finds a link through the relations of its from issue`.
  - `isUnconfirmed is true for an HTTP 502 on a create`: use `issues.unconfirm('PmkitIssueCreate', { applied: true })`.
  - `remove sends issueDelete without permanentlyDelete`.
  - `budget returns the client's rate after a response with headers`.
  - `the tracker exposes its client for a migration`: `createLinearTracker(...).migration.client` is the client the tracker uses. The contract view still has no `migration` key.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/migrate-writer.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the writer and the `migration` handle.
- [ ] **Step 4: Run** the same command and `node --test scripts/lib/linear/tracker.test.mjs scripts/contract.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(linear): write migration records with chosen ids (PMK-41)`.

### Task 10: The Linear reader

**Files:**
- Create: `scripts/lib/linear/migrate-reader.mjs`
- Test: `scripts/lib/linear/migrate-reader.test.mjs`

**Interfaces:**
- Consumes: `ISSUE_EVENTS_QUERY`, `PROJECTS_QUERY` with the `listDeliverables` team filter, `PROJECT_UPDATES_QUERY`, `CYCLES_QUERY`, `toIssue`, `toEpic`, `toStatusUpdate`, `toSprint`, `toComment`, `toEvents`, `makeContext`, and the nested-page completion that `metricEvents` uses (`completeNested` in `issue-ops.mjs`).
- Produces: `readLinearSnapshot({ client, discovery, teamKey, now }) -> Promise<{ snapshot, readRequests }>`, with `system: 'linear'` and `scope: { workspace, team }`. People are the discovery users as `{ id, name, email, app }`. Issues hold `events` from `toEvents` and the raw `identifier`, `uuid` and `branch`. Links come from `relations` (the `blocks`, `related` and `duplicate` types), each once. Comments keep `parent` and `resolved`. Issues of other teams that a parent or link names are left out, and each one counts in a loss.

- [ ] **Step 1: Write the failing tests**
  - `the reader pages 100 issues at a time with archived ones`: 150 seeded issues give 2 `PmkitIssueEvents` calls with `includeArchived: true` and `first: 100`, and no page cap cuts them (`maxPages` set).
  - `nested history past its first page is completed`: seed 60 history entries on one issue with `nestedPage: 50`. Expect one extra history page request and all 60 entries in `events`.
  - `projects, their updates and the cycles are read`.
  - `a relation to another team's issue is left out and counted`.
  - `the reader sends no mutation`: every call in `fetch.calls` passes `!isMutation(call.body.query)`.
  - `readRequests counts the requests sent`.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/migrate-reader.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the reader.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(linear): read a team as a migration snapshot (PMK-41)`.

### Task 11: The import field mapping

**Files:**
- Create: `scripts/lib/local/migrate-fields.mjs`
- Test: `scripts/lib/local/migrate-fields.test.mjs`

**Interfaces:**
- Consumes: `MEMBER_ID` from `config.mjs`, `newId` and `nextNumberedId` from `ids.mjs`, `stripAttribution` and `snapshotDigest` (Task 1), `MapData` (Task 2).
- Produces:
  - `memberIdFor(user, taken) -> string`, by the rule in "People".
  - `localLabelName(name) -> string | null`, by Decision 6.
  - `seededRandom(digest) -> (n) => integer`: integer `i` of the sequence is `parseInt(sha256(`${digest}:${i}`).slice(0, 8), 16) % n`.
  - `importTarget({ local, mappings, exportMaps }) -> Target`: statuses by name and by category (the first status of each category in file order), types by their Linear label, priorities, labels, the estimate scale, members by lower-cased email and by name, `id_prefix`, `epic_prefix`, `id_style`, and the round-trip IDs from the finished export maps of the same team (`{ 'ACME-12': 'PMK-38', 'P-ACM-3': 'EPC-5' }`), kept only when they match the current prefix.
  - `mapImport(snapshot, target, { readRequests }) -> Mapped`. `readRequests` comes from `readLinearSnapshot` (Task 10). Record keys are Linear IDs: the issue identifier, the epic ID, the cycle number, the comment and update UUIDs, the user ID and the label name. `target` is the new Local ID (a member ID, a label name, a sprint ID, an epic or issue ID, a comment or update file stem).

- [ ] **Step 1: Write the failing tests**
  - `member ids follow the rule` (Review focus 5): `ana.souza+pm@example.com` gives `ana-souza-pm`; a second `ana.souza+pm@other.example` gives `ana-souza-pm-2`; an app user named `GitHub Bot` gives `agent:github-bot` and no email; an email of `@@x` gives `user`.
  - `a matched user keeps the member id`: email match ignores case.
  - `each user an imported record names becomes a member record, and others do not`.
  - `labels follow the Local label rule` (Review focus 5): `Needs Review` gives `needs-review` and a `labels renamed` loss, `Bug` mapped as a type gives the `bug` type and no label, and `!!!` is a `bad_label` problem.
  - `status maps by name, then by category`.
  - `an estimate outside the Local scale is dropped`.
  - `round-trip ids come back from a finished export map`: the map holds `ISS-5N1R` with `id: ACME-12`, so the Linear `ACME-12` plans as `ISS-5N1R`. A map ID with another prefix gets a new ID.
  - `random ids are the same for the same snapshot`: two `mapImport` calls over one snapshot with `id_style: random` give the same targets.
  - `numbered ids follow the creation order`.
  - `a comment with an attribution line gets its author back`: name `Ana Souza` equal to member `ana`'s name gives author `ana` and the body without the two lines. A name that matches no member keeps the Linear user's member.
  - `a parent issue and a project parent map to Local parent ids`, and `a milestone is dropped with a loss`.
  - `two cycles with the same start date are a sprint_clash problem`.
  - `every import row of "What does not round-trip" appears in losses when its case is present`.
- [ ] **Step 2: Run** `node --test scripts/lib/local/migrate-fields.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the exports.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(local): map a Linear snapshot to Local files (PMK-41)`.

### Task 12: The Local writer

**Files:**
- Create: `scripts/lib/local/migrate-writer.mjs`
- Test: `scripts/lib/local/migrate-writer.test.mjs`

**Interfaces:**
- Consumes: `writeFileAtomic`, `issuePaths`, `serializeIssue`, `toFrontmatter`, `serializeEpic`, `epicFrontmatter`, `serializeUpdate`, `serializeSprint`, `appendEvents`, `readEvents`, `driftEvents`, `joinFrontmatter`, `addMapEntry` and `setScalar` from `yaml-edit.mjs`, `Writer` (Task 5).
- Produces: `createLocalWriter({ root, config, actor, now }) -> Writer` with `system: 'local'`. `chooseId` returns `record.target`. `budget` returns null. `isUnconfirmed` returns false. `remove` throws `NOT_SUPPORTED`. `create` per kind:
  - `member`: `addMapEntry(text, ['members'], id, { name, email, availability: 1 })` on `.issues/config.yaml`, with no `email` for an `agent:` member.
  - `label`: the `labels` list of `.issues/config.yaml` gains the name, by the same edit `init --label` makes.
  - `sprint`: `sprints/<id>.yaml` through `serializeSprint`.
  - `epic`: `epics/<id>/epic.md` and a `create` event at the project's `createdAt` by the mapped member.
  - `update`: `epics/<id>/updates/<date>-<author>.md`, with `-2` on a clash, at the update's own time.
  - `issue`: `issue.md`, then the mapped events, then the `driftEvents` of the result, dated `now()` and by `actor`.
  - `comment`: `comments/<created>-<author>.md` with `author`, `created`, `reply_to` and, for a resolved root, `resolved` and `resolved_by`.
- `exists(kind, entries)`: the file or folder is there, or the config holds the key.

- [ ] **Step 1: Write the failing tests** on a temp copy of `basic`, then read back with `createLocalTracker`.
  - `an imported issue reads back with its fields`: `getIssue` gives the status, type, labels, parent, `blocked_by`, sprint and `created` that the record set.
  - `history replays with no drift`: after `create('issue')`, `driftEvents(frontmatter, readEvents(...).events, ...)` is empty.
  - `drift is settled with synthetic events by the actor`: events that end in another status than the frontmatter give one synthetic `move` by `actor` at `now()`.
  - `comments keep their date, author, reply and resolution`: `listComments` gives them back.
  - `a new member and a new label land in .issues/config.yaml`, and `validateLocalConfig` finds no problem.
  - `epics and updates keep their dates`.
  - `exists finds what create wrote`.
- [ ] **Step 2: Run** `node --test scripts/lib/local/migrate-writer.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the writer. Write each file with `writeFileAtomic`, and append events with `appendEvents`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(local): write imported records with their dates and authors (PMK-41)`.

### Task 13: `local-migrate export`

**Files:**
- Create: `scripts/lib/migrate/cli.mjs`, `scripts/cli-migrate.test.mjs`
- Modify: `scripts/pmkit.mjs`, `scripts/lib/args.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1 to 9, `parseMappingFlags`, `proposeMappings`, `adapterFor`, `loadPmkitConfig`, `loadLocalConfig`, `formatError`.
- Produces:
  - In `args.mjs`, `GROUPS` gains `local-migrate`.
  - In `pmkit.mjs`, five `COMMANDS` entries named `local-migrate export`, `local-migrate import`, `local-migrate status`, `local-migrate undo` and `local-migrate switch`, each with `systems: ['local', 'linear']`, a `summary`, a `usage` copied from the "Commands" table and its `flags`. Export and import also have `write: true` and `dryRun: true`. The runner refuses a command whose `systems` lacks `tracker.system` with `NOT_SUPPORTED`, ``\`<name>\` works only with the Local or Linear tracker, and tracker.system is "<system>"``, at the place of the `command.local` check. A JSON error copies `details.problems` when it is an array, beside `mappings`.
  - In `cli.mjs`: `resolveSides(ctx, { direction }) -> { local: { root, path, config }, linear: { workspace, team, mappings }, choice }`, by the rules under "Sides". `linearHandle(ctx, linear) -> Promise<{ client, discovery, view, raw }>` creates the tracker through `adapterFor('linear', ctx.adapters).create` with a config that names the workspace, the team and the mappings, and returns its `migration` handle. `runExport(ctx) -> { data, text }`.

- [ ] **Step 1: Write the failing tests** in `scripts/cli-migrate.test.mjs`, with the `cli()` helper of `cli-linear.test.mjs`, a repository from `buildMigrationFixture`, and a fake with `cyclesEnabled: true`, `issueEstimationType: 'fibonacci'` and a cycle on the fixture sprint's dates.
  - `export refuses outside git`: `NOT_CONFIGURED` with the `migrate` message.
  - `export refuses uncommitted tracker changes`: `CONFLICT`.
  - `export refuses an older format`: the `formatError` of ADR-0004.
  - `export refuses another actor`: `--as ana` gives the `requireViewer` error.
  - `export asks for open mappings`: without `--type-label`, `NOT_CONFIGURED` with the questions in `error.mappings`.
  - `export refuses another tracker`: `tracker.system: jira` with a jira descriptor gives the `systems` refusal.
  - `export --dry-run prints the full preview and writes nothing`: the text has every section of Task 4, `hashTree(root)` is unchanged, `.pmkit/migrations` does not exist, and no call is a mutation.
  - `export --dry-run --json has the preview keys and the digest`.
  - `problems refuse the run with all of them in the JSON error`: a hand-edited parent loop gives `INVALID_INPUT`, the first problem in the message and both in `error.problems`, and no mutation.
  - `export --expect with a changed plan refuses before any write`: dry run, then edit an issue title and commit, then run with the old digest. Expect `CONFLICT` and no mutation.
  - `export writes the map and every record`: run with the digest. Expect exit 0, the map at `.pmkit/migrations/2026-10-28-export-linear.yaml` with `finished` set, one `done` entry per record, the fake holding each issue with its parent, project, cycle, estimate, `createdAt` and `completedAt`, each link, and each comment starting with its attribution line.
  - `a failed export resumes and creates nothing twice`: `unconfirm('PmkitRelationCreate', { applied: false })` on the second link. Expect exit 2 and a `failed` entry. Run again. Expect exit 0 and each issue, link and comment once in the fake.
  - `a second export sends only the new issues and links them to the old ones` (Review focus 3): after a finished export, create an issue blocked by an exported one and commit. Expect a new map `-2`, one `PmkitIssueCreate` and one `PmkitRelationCreate` whose `issueId` is the UUID from the first map.
  - `export stops at the reserve`: the fake answers `x-ratelimit-requests-remaining: 105`. Expect `RATE_LIMITED`, and the map saved with the records done so far.
  - `no output holds the key`: every `stdout` and `stderr` of this file passes `assert.doesNotMatch(text, new RegExp(FAKE_KEY))`.
- [ ] **Step 2: Run** `node --test scripts/cli-migrate.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `runExport`. The order: the git check, the Local side and its format, the clean-tree check, the Linear side, the client (a missing key fails here with `AUTH`), the reads of step 0, the Local snapshot, `chooseMap`, `reconcile` (on a copy of the map when `--dry-run`), `mapExport`, `planMigration`, then the dry run output, or `checkExpect`, the problem refusal, the store and `runPlan`. The run output is the preview with the `done` column, then `next: commit .pmkit/migrations/<file>`.
- [ ] **Step 4: Run** the same command and `node --test scripts/cli.test.mjs scripts/cli-linear.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add local-migrate export (PMK-41)`.

### Task 14: `local-migrate import`

**Files:**
- Modify: `scripts/lib/migrate/cli.mjs`, `scripts/cli-migrate.test.mjs`

**Interfaces:**
- Consumes: Tasks 10 to 12, `resolveSides` and `linearHandle` (Task 13).
- Produces: `runImport(ctx) -> { data, text }`. The actor of the Local writes is the member the key owner maps to after the people step. `runImport` builds its writer with `ctx.adapters.local.migrateWriter ?? createLocalWriter`, so a test registry can wrap the real writer.

- [ ] **Step 1: Write the failing tests**, seeding the fake with issues, a project with an update, a cycle, relations of each kind, a comment thread with a resolved root, a history move, and a user with no member.
  - `import refuses a tracker that holds issues`: the `CONFLICT` and next step of Global constraints.
  - `import --dry-run lists new members and writes nothing`: the people section has `new member user-1`, and the tree is unchanged.
  - `import writes every record and validates`: after the run, `pmkit validate --json` reports no problem, `issues list --json` has every issue, and `blocked_by`, `related` and `duplicate_of` hold the mapped IDs.
  - `imported history gives flow metrics`: `metrics cycle-time --json` has the seeded issue.
  - `import never commits`: `git status --porcelain` lists `.issues/` and the map, and `git log` has one commit.
  - `import resumes over its own uncommitted files` (Review focus 1): pass `adapters: { ...ADAPTERS, linear, local: { ...ADAPTERS.local, migrateWriter: (deps) => failOnCall(createLocalWriter(deps), 'comment', 3) } }`, where `failOnCall` is a test helper that throws `UPSTREAM` on the third `create('comment')`. Expect exit 2. Rerun with the plain registry. Expect exit 0 and each comment file once.
  - `a resume refuses when HEAD moved`: commit something in between. Expect `CONFLICT` with the clean-tree message.
  - `import on a Linear repository uses --path`: `tracker.system: linear` with the scope set, and `--path .issues`.
- [ ] **Step 2: Run** `node --test scripts/cli-migrate.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `runImport` with the same order as export. On a resume (Decision 9) the clean-tree check passes when `HEAD` equals the map's `target.commit` and every changed path is under the tracker folder. The empty check passes when every issue and epic folder is a `sent` or `done` target of the map.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add local-migrate import (PMK-41)`.

### Task 15: `local-migrate status` and `local-migrate undo`

**Files:**
- Modify: `scripts/lib/migrate/cli.mjs`, `scripts/cli-migrate.test.mjs`

**Interfaces:**
- Consumes: `listMaps`, `readMap`, `mapCounts`, `createMapStore` (Task 2), `createLinearWriter` (Task 9), `ISSUES_BY_IDS`.
- Produces:
  - `runStatus(ctx) -> { data, text }`, data `{ file, direction, source, target, started, finished, kinds, failed, next }`. It sends no request. With no map it throws `NOT_FOUND`, `no migration map in .pmkit/migrations`, next step `Run pmkit local-migrate export --dry-run or pmkit local-migrate import --dry-run`.
  - `runUndo(ctx) -> { data, text }`. On an export map: reads every `done` issue by UUID, plans the removals (issues, then projects, then labels with `created: true`), lists each with `changed since the migration` when `updatedAt` is later than the entry's `at`, prints the full preview and the digest, and with `--expect` sends `ISSUE_DELETE`, `PROJECT_DELETE` and `LABEL_DELETE`, one at a time, setting `state: removed` after each. It uses the reserve stop of Task 5. On an import map: data `{ commands: ['git restore --source=HEAD -- .issues .pmkit/migrations', 'git clean -fd -- .issues'] }`, and nothing is written.
- `status` is a read. `undo` has `write: true` and `dryRun: true`.

- [ ] **Step 1: Write the failing tests**
  - `status prints the counts and the next step of an unfinished map`, and `status sends no request` (`fetch.calls` is empty).
  - `status without a map is NOT_FOUND`.
  - `undo --dry-run lists every record it deletes and marks the changed ones`: after an export, update one issue in the fake. Expect that issue marked, the request count `10 + I + E + L`, and no mutation.
  - `undo deletes what the export created`: with `--expect`, every exported issue is trashed in the fake, the project deleted, the created label deleted, a label the team had before kept, and each entry `removed`.
  - `undo resumes after an interruption`: fail the second `PmkitIssueDelete`. Rerun. Expect each delete once.
  - `undo on an import map prints the git commands and writes nothing`.
- [ ] **Step 2: Run** `node --test scripts/cli-migrate.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** both commands.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add local-migrate status and undo (PMK-41)`.

### Task 16: `local-migrate switch`

**Files:**
- Modify: `scripts/lib/migrate/cli.mjs`, `scripts/cli-migrate.test.mjs`

**Interfaces:**
- Consumes: `setScalar` and `setMap` from `yaml-edit.mjs`, `lineDiff` from `scripts/lib/diff.mjs`, `chooseMap` and `mapCounts` (Task 2).
- Produces: `runSwitch(ctx) -> { data, text }`, data `{ file, from, to, changes, written }`, with `write: true`, `dryRun: true` and `flags: ['to', 'file']`. It follows "Switching the tracker": the refusals of Global constraints, `--to linear` writes `tracker.system`, `tracker.scope.workspace`, `tracker.scope.team` and `mappings.status`, `mappings.fields` and `mappings.types` from the map; `--to local` writes `tracker.system: local` and `tracker.path`. It sends no request and never commits.

- [ ] **Step 1: Write the failing tests**
  - `switch --to linear --dry-run prints the diff and writes nothing`.
  - `switch --to linear writes the system, the scope and the mappings`: after it, `loadPmkitConfig` reads `system: linear` with the map's scope and mappings, and `.issues/` is unchanged.
  - `switch refuses an unfinished map` and `switch refuses a map with failed records`, with the messages of Global constraints.
  - `switch --to local needs an import map`.
  - `switch to the system the file already names writes nothing and says so`.
  - `switch --to local writes the system and the path and keeps scope and mappings`.
- [ ] **Step 2: Run** `node --test scripts/cli-migrate.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `runSwitch`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add local-migrate switch (PMK-41)`.

### Task 17: The round trip over the fake

**Files:**
- Modify: `scripts/cli-migrate.test.mjs`

**Interfaces:**
- Consumes: `buildMigrationFixture` (Task 6), the CLI commands (Tasks 13 and 14).

- [ ] **Step 1: Write the test** `export then import gives back the ids, parents, blockers and links`. Export the fixture to the fake. Copy the export map into a second repository built from `basic` with git, and commit it. Import from the same fake into it. Assert: every issue and epic ID equals the original (round-trip IDs); each parent, `blocked_by`, `related` and `duplicate_of` equals the original; comment bodies and authors equal the originals (attribution); the resolved thread is resolved; the archived issue is archived; the sprint has the same dates. Then compare every other field and assert that each difference is a row of the losses tables: history replaced by Linear's, branch names, the milestone, and the estimate when the scale differs.
- [ ] **Step 2: Run** `node --test scripts/cli-migrate.test.mjs`. Expected: PASS. If it fails, fix the task whose module is wrong, and add a unit test there first.
- [ ] **Step 3: Commit** `test(migrate): round-trip a tracker through the fake (PMK-41)`.

### Task 18: The command file and its routing

**Files:**
- Create: `commands/local/migrate.md`
- Modify: `skills/pmkit/SKILL.md`, `README.md`, `scripts/plugin.test.mjs`

**Interfaces:**
- Consumes: the five CLI commands.
- Produces: `/pmkit:local:migrate`, a command file with the frontmatter and the six sections that `plugin.test.mjs` checks. Its steps: read the conventions; take the direction (export or import) and the Linear side from the request, else ask with `AskUserQuestion`; run `local-migrate status --json` and offer to resume an unfinished map; run `local-migrate <direction> --dry-run --json`; when it stops with `NOT_CONFIGURED` and mapping questions, ask them and rerun with the flags; show the summary table, the losses and the problems, then the record tables; when there are problems, stop and list them; ask with `AskUserQuestion` whatever `write_policy.confirm` says (a bulk change); run the same command with `--expect <digest> --json`; on `RATE_LIMITED` or a failure, report the counts and the next step; when the map is finished, tell the user to commit the map (and `.issues/` after an import), then offer `local-migrate switch --to <system> --dry-run --json`, ask, and run `local-migrate switch --to <system> --json`. An undo has its own branch: `local-migrate undo --dry-run --json`, ask, `local-migrate undo --expect <digest> --json`.

- [ ] **Step 1: Write the failing tests** in `plugin.test.mjs`: add `migrate` to `local` in `COMMANDS`, and add `migrate.md previews before every write`: in each step that holds a `local-migrate export`, `import`, `undo` or `switch` write call without `--dry-run`, an earlier step holds the same command with `--dry-run`, and a step between them names `AskUserQuestion`. Every write call of export, import and undo carries `--expect`.
- [ ] **Step 2: Run** `node --test scripts/plugin.test.mjs`. Expected: FAIL on the missing file.
- [ ] **Step 3: Write** the command file, the `SKILL.md` row ("move the tracker to Linear, import a Linear team into .issues/, undo or finish a migration" to `/pmkit:local:migrate`), and the README line.
- [ ] **Step 4: Run** `node --test scripts/plugin.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `docs: add /pmkit:local:migrate (PMK-41)`.

### Task 19: Goldens, the hosted mirror, the help and the scenario

**Files:**
- Modify: `scripts/golden-cases.mjs`, `scripts/cli-hosted.test.mjs`
- Create: `scripts/__goldens__/*/local-migrate-*.txt` (generated), `scripts/__scenarios__/local-migrate.mjs` and its snapshots (generated), `scripts/__scenarios__/_inputs/import-map.yaml`

- [ ] **Step 1: Add the golden cases.** In `CASES`: `'local-migrate export': () => [['--workspace', 'acme', '--team', 'ACME']]`, `'local-migrate import': () => [['--workspace', 'acme', '--team', 'ACME']]`, `'local-migrate status': () => [[]]`, `'local-migrate undo': () => [[]]`, `'local-migrate switch': () => [['--to', 'linear']]`. The golden fixtures are not git repositories, so export and import record the `NOT_CONFIGURED` refusal, and the other three record `NOT_FOUND`.
- [ ] **Step 2: Keep the commands out of the mirror.** In `cli-hosted.test.mjs`, `MIRRORED` also leaves out commands with `systems`, and a new test asserts the `systems` commands are exactly the five `local-migrate` commands. The assertion on `local` commands stays `['render', 'migrate', 'reindex']`.
- [ ] **Step 3: Run** `node --test scripts/goldens.test.mjs scripts/cli-hosted.test.mjs`. Expected: the new cases FAIL for missing goldens.
- [ ] **Step 4: Regenerate** with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`. Read `git status` and `git diff --stat scripts/__goldens__`: only new `local-migrate-*.txt` files appear, and no existing golden changed.
- [ ] **Step 5: Check the help.** Run `node --test scripts/cli.test.mjs`. The test `--help lists every command and exits 2` passes with the five new commands, because `USAGE` comes from `COMMANDS`.
- [ ] **Step 6: Write the scenario** `scripts/__scenarios__/local-migrate.mjs` on the `team` fixture with `git: true`, as an array:
  - Entry 0: the `status` step is a read with `expectError: 'NOT_FOUND'`. `expect` asserts the error code and an unchanged tree.
  - Entry 1: `setup` copies `_inputs/import-map.yaml` (a finished import map with `target: { system: local, path: .issues }`) to `.pmkit/migrations/2026-10-28-import-linear.yaml`. The undo branch's dry run (`dryRun: ['local-migrate', 'undo']`) saves the result, and `expect` asserts the two git commands.
  - `skip` lists each export, import, switch and undo-write call of the command file with `needs the Linear API, which a child process cannot fake; scripts/cli-migrate.test.mjs covers it`. `notHit` lists each confirmation point with the reason that the scenario stops before it.
- [ ] **Step 7: Run** `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, read the new snapshots, then run `node --test scripts/scenarios.test.mjs` without the variable. Expected: PASS, and `git diff --stat scripts/__scenarios__` shows only the new files.
- [ ] **Step 8: Run** `npm test`. Expected: PASS.
- [ ] **Step 9: Commit** `test: add goldens and a scenario for local-migrate (PMK-41)`.

### Task 20: Glossary, changelog and API facts

**Files:**
- Modify: `CONTEXT.md`, `CHANGELOG.md`, `scripts/lib/linear/API-VERIFICATION.md`

- [ ] **Step 1:** In `CONTEXT.md`, add **Export** (copying the Local tracker's records to a hosted tracker with `pmkit local-migrate export`), **Import** (copying a hosted team's records into an empty Local tracker) and **ID map** (the file under `.pmkit/migrations/` that pairs each old ID with its new one and lets a rerun resume). The _Avoid_ line of **Migration** gains: "moving records between trackers, which is an export or an import".
- [ ] **Step 2:** In `CHANGELOG.md` under `## Unreleased`, one entry for `/pmkit:local:migrate` and the five commands, with the losses in one sentence. The tracker format line says the format is unchanged.
- [ ] **Step 3:** In `API-VERIFICATION.md`, one row per fact of "Facts checked against the Linear API", with `schema` in "Verified by" and the caveat that live behavior waits for Task 21.
- [ ] **Step 4: Run** `node --test scripts/plugin.test.mjs scripts/adr-linear-auth.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `docs: describe export, import and the ID map (PMK-41)`.

### Task 21: The live test (after PMK-39 merges; stage 3 does not run this task)

This task waits for PMK-39 to merge into `main` and for this branch to be rebased on it. It writes to Linear, so it runs only when the user starts it.

**Files:**
- Create: `scripts/lib/linear/migrate-live.mjs`
- Modify: `scripts/lib/linear/API-VERIFICATION.md`

**Interfaces:**
- Consumes, from PMK-39's merged helper (`scripts/lib/linear/sandbox.mjs` in its spec): the function that finds or creates the fixed test team and returns `{ id, key }`, the function that trashes what a run created, its write guard and its write opt-in variable. Step 1 writes their real names into this task before any code.

- [ ] **Step 1: Read** PMK-39's merged spec and `sandbox.mjs`. Write down the two function names, the opt-in variable and the mutations its write guard allows. If the guard refuses `issueLabelCreate`, `projectUpdateCreate`, `commentResolve`, `issueArchive` or `issueLabelDelete`, stop and ask the user before any guard change.
- [ ] **Step 2: Write** the gate test: with `PMKIT_LIVE`, `PMKIT_LIVE_WORKSPACE` or the opt-in unset, every test skips with one reason and no client is built. Run `node scripts/lib/linear/migrate-live.mjs` with no variables. Expected: every test skipped.
- [ ] **Step 3: Write** the live steps of "Live test" in the spec: find or create the test team; check that the export's team ID equals the helper's ID before the first write; export a five-issue fixture with `--dry-run`, then for real, and read back parents, blockers, links, the project, the dates and the attribution lines; interrupt a second export after two mutations and rerun it; import into a new temporary repository; undo; and, in an `after` hook that runs on failure too, trash what the run created through the helper. Every error passes `assertNoKey`.
- [ ] **Step 4: Run**, when the user says so:

```
set -a; . ./.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WRITE=1 PMKIT_LIVE_WORKSPACE=$PMKIT_LIVE_WORKSPACE node scripts/lib/linear/migrate-live.mjs
```

Use PMK-39's opt-in variable in place of `PMKIT_LIVE_WRITE` if it named another. Expected: every test passes, and the team holds no issue from the run.
- [ ] **Step 5: Record** in `API-VERIFICATION.md` the live result of `createdAt` and `completedAt` on creates, a second create with an existing UUID, what `issueDelete` takes with it, and the rate-limit headers. If Linear refused the dates, drop them in Task 8's mapping and add the loss row, with a test first.
- [ ] **Step 6:** Run the private-name check, then commit `test(linear): run the migration against the test team (PMK-41)`.
