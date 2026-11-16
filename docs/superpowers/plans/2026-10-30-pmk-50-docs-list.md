# PMK-50 docs list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `pmkit docs list`, which lists the files under `.issues/docs/`, with a `listDocuments` tracker operation behind it.

**Architecture:** A pure file walk in `scripts/lib/local/documents.mjs` returns relative paths. The local tracker exposes it as `listDocuments()`, the contract lists it, and the CLI prints it. Linear keeps its generic `NOT_SUPPORTED` stub.

**Tech Stack:** Node.js built-ins (`node:fs`, `node:path`), `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-pmk-50-docs-list-design.md`

## Global Constraints

- No dependencies (ADR 0003).
- Paths in output use `/` on every platform.
- Goldens are generated with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, never edited by hand.

## Review Focus

- A docs folder that does not exist yet: `docs list` returns `[]`, not an error. Test in Task 1.
- A file nested in a subfolder: the path keeps its folder, such as `plans/launch.md`. Test in Task 1.
- Hidden entries such as `.gitkeep`: skipped. Test in Task 1.
- A symlink to a folder: not followed into the walk, so a link cannot loop. Test in Task 1.
- Output on an empty folder in text mode: prints `no documents`. Test in Task 2.

---

### Task 1: Local listing and the tracker operation

**Files:**
- Modify: `scripts/lib/local/documents.mjs` (add `listDocumentFiles`)
- Modify: `scripts/lib/local/tracker.mjs:20` (import) and `:1059-1071` (add `listDocuments`, add it to the returned object)
- Modify: `scripts/lib/contract.mjs:15` (add `listDocuments` after `createDocument`)
- Test: `scripts/documents.test.mjs` (append tests)

**Interfaces:**
- Consumes: `docsDir` (the `.issues/docs` absolute path, already in `tracker.mjs`).
- Produces: `listDocumentFiles(docsDir: string) -> { path: string }[]`, sorted by `path`. The tracker method is `listDocuments() -> { path: string }[]`, no arguments.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/documents.test.mjs`:

```js
test('listDocuments returns the regular files under the docs folder, sorted, with / separators', () => {
  const { tracker, docs } = setup()
  fs.mkdirSync(path.join(docs, 'plans'), { recursive: true })
  fs.writeFileSync(path.join(docs, 'zeta.md'), 'z')
  fs.writeFileSync(path.join(docs, 'plans', 'launch.md'), 'l')
  fs.writeFileSync(path.join(docs, 'alpha.txt'), 'a')
  assert.deepEqual(tracker.listDocuments(), [{ path: 'alpha.txt' }, { path: 'plans/launch.md' }, { path: 'zeta.md' }])
})

test('listDocuments skips hidden entries and does not follow a folder symlink', () => {
  const { tracker, docs, root } = setup()
  fs.writeFileSync(path.join(docs, '.gitkeep'), '')
  fs.mkdirSync(path.join(docs, '.hidden'))
  fs.writeFileSync(path.join(docs, '.hidden', 'x.md'), 'x')
  fs.writeFileSync(path.join(docs, 'a.md'), 'a')
  fs.symlinkSync(docs, path.join(docs, 'loop'))
  fs.symlinkSync(path.join(root, 'package.json'), path.join(docs, 'link.md'))
  assert.deepEqual(tracker.listDocuments(), [{ path: 'a.md' }])
})

test('listDocuments returns an empty list when the docs folder is missing or empty', () => {
  const { tracker, root } = setup()
  assert.deepEqual(tracker.listDocuments(), [])
  fs.rmSync(path.join(root, '.issues', 'docs'), { recursive: true, force: true })
  assert.deepEqual(tracker.listDocuments(), [])
})

test('listDocuments writes nothing', () => {
  const { tracker, root } = setup()
  const before = hashTree(root)
  tracker.listDocuments()
  assert.equal(hashTree(root), before)
})
```

Note on the symlink test: `fs.symlinkSync(docs, ...)` needs the target path. The `loop` link is a directory symlink; `link.md` is a file symlink to a file outside the docs folder. The rule to implement: a symlink entry is listed only if `fs.statSync` says it is a regular file. Decide: skip all symlinks (`lstat().isSymbolicLink()` is skipped). Then `link.md` is skipped too, which the test expects.

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test scripts/documents.test.mjs`
Expected: the three new tests FAIL with `tracker.listDocuments is not a function`.

- [ ] **Step 3: Implement `listDocumentFiles(docsDir)` in `scripts/lib/local/documents.mjs`**

Walk with `fs.readdirSync(dir, { withFileTypes: true })`, recursively. Skip any name starting with `.`. Skip any entry where `isSymbolicLink()` is true. Recurse into directories. Keep regular files (`isFile()`). Build each path as `[...prefix, name].join('/')`. Return `{ path }` objects sorted by `path` with plain `<` and `>` comparison. A missing `docsDir` returns `[]` (check `fs.existsSync` first).

- [ ] **Step 4: Wire it into the tracker and the contract**

In `scripts/lib/local/tracker.mjs`, add `listDocumentFiles` to the import on line 20, add `const listDocuments = () => listDocumentFiles(docsDir)` next to `readDocument`, and add `listDocuments` to the returned object on the line that lists `readDocument, createDocument`.

In `scripts/lib/contract.mjs`, change line 15 to `'readDocument', 'createDocument', 'listDocuments',`.

- [ ] **Step 5: Run the tests and see them pass**

Run: `node --test scripts/documents.test.mjs`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/local/documents.mjs scripts/lib/local/tracker.mjs scripts/lib/contract.mjs scripts/documents.test.mjs
git commit -m "feat(docs): list the documents under the docs folder (PMK-50)"
```

---

### Task 2: The `docs list` command, capability, golden and README

**Files:**
- Modify: `scripts/pmkit.mjs` (new command after `docs read`, around line 790)
- Modify: `scripts/lib/capabilities.mjs:27` (`documents: ['docs list', 'docs read', 'docs create']`)
- Modify: `scripts/golden-cases.mjs` (add `'docs list': () => [[]],` next to `'docs read'`)
- Generated: `scripts/__goldens__/*/docs-list.txt` and any changed `*/capabilities.txt` (none expected)
- Modify: `README.md:96` (add a row for `docs list`)

**Interfaces:**
- Consumes: `tracker.listDocuments()` from Task 1, returning `{ path }[]`.
- Produces: the CLI command `docs list`. JSON data is the array as returned. Text is one path per line, or `no documents`.

- [ ] **Step 1: Write the failing check**

Run: `node scripts/pmkit.mjs docs list --json` in a repository fixture.
Expected: FAIL with an unknown command error, because the command does not exist yet. The golden test in Step 4 also fails with `command "docs list" has no entry in CASES`.

- [ ] **Step 2: Add the command in `scripts/pmkit.mjs`**

Insert after the `docs read` entry:

```js
  {
    name: 'docs list', summary: 'lists the documents under the docs folder', usage: '', args: [], flags: [],
    run: async (ctx) => {
      const docs = await (await ctx.tracker()).listDocuments()
      const text = docs.length === 0 ? 'no documents' : docs.map((doc) => doc.path).join('\n')
      return { data: docs, text }
    },
  },
```

- [ ] **Step 3: Update the capability and the case table**

In `scripts/lib/capabilities.mjs`, change the `documents` line of `SERVED_BY` to `documents: ['docs list', 'docs read', 'docs create'],`.

In `scripts/golden-cases.mjs`, add `'docs list': () => [[]],` before `'docs read'`.

- [ ] **Step 4: Regenerate the goldens and check the diff**

Run: `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`
Then: `git diff --stat scripts/__goldens__/` and read the new `docs-list.txt` files. Expected: new `docs-list.txt` per fixture, and no change to `capabilities.txt` (the goldens do not print `servedBy`). Stop and investigate if any other golden changes.

- [ ] **Step 5: Add the README row**

After the `docs read` row in `README.md`, add:

```
| `docs list` | lists the documents under the docs folder |
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/pmkit.mjs scripts/lib/capabilities.mjs scripts/golden-cases.mjs scripts/__goldens__ README.md
git commit -m "feat(docs): add the docs list command (PMK-50)"
```

---

### Task 3: Verify and hand off

- [ ] **Step 1: Check the command by hand in a scratch fixture**

Run `node scripts/pmkit.mjs docs list` and `node scripts/pmkit.mjs docs list --json` in a repository that has `.issues/`, with a document created by `docs create`. Expected: the path appears in the text output, and the JSON array holds `{ "path": ... }`.

- [ ] **Step 2: Run `npm test` once more**

Expected: PASS. Use this output as the evidence for `superpowers:verification-before-completion`.
