# PMK-20 the dependency-map command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `issues dependencies <id>` returns the hierarchy under an issue or an epic, the chain of open blockers that reaches it and the critical path through that chain, and `/pmkit:issues:dependencies <id>` shows that map with the critical path marked. When no open blocker touches the target, both show the hierarchy only and say why. Neither writes anything.

**Architecture:** A pure module, `scripts/lib/dependencies.mjs`, takes the target, every issue and the `dependencies` capability, and returns the map. It reads no file, as `scripts/lib/metrics.mjs` reads none. A read entry in `COMMANDS` feeds it from `getIssue` or `getDeliverable`, `searchIssues({ archived: true })` and `capabilities()`, and `dependencyText` in `scripts/lib/format.mjs` prints it. A new command file turns the JSON into the answer. The tracker contract does not change.

**Tech Stack:** Node 18+ ES modules, no dependencies (ADR 0003), `node:test`. Run the suite with `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-20-dependency-map-command-design.md` (commit 70574f5, with the answers to its four questions). The spec is the authority. Where this plan and the spec differ, the spec wins, and the implementer reports the difference.

## Global Constraints

### Decided in the spec

- Question 1, answer A. Weights follow the `metrics velocity` unit rule: when at least one open node of the map has a numeric `estimate`, each node weighs its estimate, an unestimated node weighs 0, and the unit is the tracker's `estimate.unit`. Otherwise each node weighs 1 and the unit is `issues`. String sizes (`S`, `M`) are not numeric.
- Question 2, answer A. Command `/pmkit:issues:dependencies <id>`, file `commands/issues/dependencies.md`, CLI `issues dependencies <id>`.
- Question 3, answer A. A sub-issue never blocks its parent. The hierarchy sets the scope, and only `blocked_by` edges form chains.
- Question 4, answer A. Only what blocks the target. No "waiting on this" list.

### Terms used below

- Open: status category not in `TERMINAL` (`done`, `canceled`) from `scripts/lib/model.mjs`. A `null` category (a status the config does not know) counts as open.
- Creation order: the order of the `issues` array the module receives. `searchIssues` already returns issues oldest created first (`compareTimes`, then `compareIds`), so the module never re-sorts. A missing or unreadable node comes after every real issue, ordered by `compareIds`.
- Scope of an epic `E`: each issue with `archived` false whose `walkParents(issue.id, parentOf).chain` includes `E`. This is the rule of `deliverableProgress`.
- Scope of an issue `T`: `T` itself (always, even when archived or terminal) plus each non-archived issue other than `T` whose parent chain includes `T`.
- Ancestors of an issue `T`: `walkParents(T.id, parentOf).chain` without its first entry, nearest first, cut before the first repeated ID. An epic target has `[]`. For `ISS-2X6D` in `team` they are `['EPC-2M9D']`.

### The module

`scripts/lib/dependencies.mjs` exports one function:

```js
/**
 * @param {object} input
 * @param {object} input.target an issue from getIssue or an epic from getDeliverable, plus kind: 'issue' | 'epic'
 * @param {object[]} input.issues every issue, archived ones included, oldest created first (searchIssues({ archived: true }).issues)
 * @param {boolean} [input.dependencies=true] false when the manifest gives the dependencies capability the path absent
 * @param {string[]} [input.unreadable=[]] IDs of issue files that did not parse (the ids of searchIssues problems)
 * @param {string} [input.unit='points'] estimate.unit from the local config
 */
export function dependencyMap({ target, issues, dependencies = true, unreadable = [], unit = 'points' })
```

It returns this object, with keys in this order:

```js
{
  target: { id, kind, title, status, ancestors },          // status as { name, category }
  basis: 'blockers' | 'hierarchy',
  reason: null | 'none' | 'resolved' | 'absent',           // null exactly when basis is blockers
  weight: { unit },                                        // 'points', 'hours' or 'issues'
  nodes: [{ id, title, status, assignee, estimate, parent, scope, open, archived, missing, unreadable, blockedBy, critical }],
  tree: [{ id, children: [...] }],
  criticalPath: null | { ids, length, unestimated },
  resolved: 0,
  related: [[a, b]],
  problems: [{ id, code: 'cycle', message }],
}
```

- A node takes `title`, `status`, `assignee`, `estimate` and `parent` from its issue, with `null` for a field the issue does not have. A missing or unreadable node has `null` in all five, `scope: false`, `open: true` and `archived: false`.
- `nodes` holds every scope issue (open or terminal) and every upstream node, in creation order. `blockedBy` on a node lists only the edges kept in the graph, in the order of the issue's `blockedBy`, without duplicates. A terminal scope issue and a node of a map built with `dependencies: false` have `blockedBy: []`.
- `tree`: for an epic, the scope issues whose `parent` is the epic, each with its scope children, all in creation order. For an issue, one root, the target, with its scope children. An ID already placed in the tree is never placed again, so a parent loop stops.
- `related`: for each scope issue in creation order, for each ID in its `related` list in order, the pair `[issue.id, other]`, unless the same two IDs already formed a pair in either order. Filled in both bases.
- `resolved`: the number of `blocked_by` entries of followed nodes that point at a terminal issue.
- `problems`: only loop problems (Task 2). The CLI adds the `searchIssues` problems.

The graph (Task 1). Unless `dependencies` is false, start a queue with the open scope issues in creation order. For each real issue taken from the queue, walk its `blockedBy` in order. An entry whose issue is terminal adds 1 to `resolved` and nothing else. An entry whose issue is open (archived or not) becomes a kept edge, and that issue joins the queue the first time. An entry with no issue in `issues` becomes a kept edge to a node marked `unreadable` when its ID is in `unreadable`, and `missing` otherwise. A missing or unreadable node is never followed. Upstream nodes bring their blockers, never their sub-issues.

The basis (Task 1). `dependencies` false gives `hierarchy` with `absent`. Otherwise at least one kept edge, after Task 2 drops the loop edges, gives `blockers` with `null`. Otherwise `resolved > 0` gives `hierarchy` with `resolved`, and anything else gives `hierarchy` with `none`.

### The loop break (Task 2)

A depth-first walk over the kept edges, starting from each open scope issue in creation order, then from each node not visited yet in `nodes` order. At node `X`, follow each kept blocker `B` in order. When `B` is on the current stack, drop the edge `X → B` from `X.blockedBy` and add the problem:

```js
{ id: X, code: 'cycle', message: `blocked_by loop: ${[...stack.slice(stack.indexOf(B)), B].join(' → ')}; run /pmkit:local:doctor` }
```

where `stack` ends with `X`. A self-loop (`X` blocked by `X`) gives `blocked_by loop: X → X; run /pmkit:local:doctor`. The basis is chosen after the drops.

### The critical path (Task 3)

Only with the basis `blockers`. `best(v)` is the heaviest chain that ends at `v`: `weight(v)` plus the best of `best(u)` over the kept blockers `u` of `v`, or `weight(v)` alone when `v` has none. Memoize it. The graph is acyclic after Task 2. The candidates are the open scope issues, each with its `best`. The path is the heaviest candidate chain.

Ties, at every comparison (choosing among blockers and among candidates): compare the two chains by the creation rank of their nodes, element by element from the start of the chain. The lower rank wins at the first difference. When one chain is a prefix of the other, the shorter wins.

`criticalPath` is `{ ids, length, unestimated }`. `ids` runs from the first blocker to the scope issue. `length` is the sum of the weights. `unestimated` lists, in path order, the IDs on the path with no numeric estimate when the unit is not `issues`, and is `[]` when it is. `critical` is true exactly on the path's nodes.

### The CLI entry (Task 4)

In `COMMANDS` in `scripts/pmkit.mjs`, right after `issues get`:

```js
{
  name: 'issues dependencies', summary: 'the blocker chain, the hierarchy and the critical path of an issue or an epic', usage: '<id>', args: ['id'], flags: [],
  run: (ctx) => { ... },
}
```

No `write`, so `--dry-run` and `--as` are unknown options and there is no `commit`. `run`:

1. `isId(normalizeId(id), ctx.config().local.epic_prefix)` picks `getDeliverable`, anything else `getIssue`. The target is `{ ...record, kind }`. An unknown ID throws the `NOT_FOUND` of that read.
2. `found = tracker.searchIssues({ archived: true })`.
3. `dependencies` is `tracker.capabilities().capabilities.find((c) => c.id === 'dependencies').path !== 'absent'`.
4. `map = dependencyMap({ target, issues: found.issues, dependencies, unreadable: found.problems.map((p) => p.id), unit: ctx.config().local.estimate.unit })`.
5. `problems = [...found.problems, ...map.problems]`. Return `{ data: { ...map, problems }, text: dependencyText(map), warnings: problems.map(problemLine) }`.

Import `isId` and `normalizeId` from `./lib/ids.mjs`, `dependencyMap` from `./lib/dependencies.mjs` and `dependencyText` from `./lib/format.mjs`.

### The text layout (Task 4)

`dependencyText(map)` in `scripts/lib/format.mjs`. Lines, in order:

1. `<target id>  <title>  <status name>`.
2. Issue target with ancestors: `parents: <ancestors from the top down, joined with ' > '>`, for example `parents: EPC-2M9D`.
3. Basis `blockers`: `critical path: <ids joined with ' → '> (<length> <unit>)`. The unit loses its final `s` when the length is 1 (`1 point`, `1 hour`, `1 issue`). Then, when `unestimated` is not empty, `no estimate, counted as 0: <ids joined with ', '>`. Then a blank line, `blocker chain:` and the chain rows, then a blank line.
4. Basis `hierarchy`: `<reason line>, so this shows the hierarchy only`, then a blank line. Reason lines: `none` gives `no blocker links touch <id>`, `resolved` gives `every blocker of <id> is done or canceled`, `absent` gives `this tracker has no dependencies capability`.
5. `hierarchy:` and the tree rows. An empty tree prints `  no issues`.
6. Basis `hierarchy` with `related` not empty: a blank line, `related links:`, then one line per pair, `  <a> and <b>`.
7. `resolved > 0`: `<n> resolved blocker not shown`, or `<n> resolved blockers not shown` when n is not 1.

A row is `'  '.repeat(depth) + (node.critical ? '* ' : '  ') + body`. The body of a real node is `<id>  <title>  <status name>  <assignee or ->  <estimate or ->`, then `  (<marks>)` when it has marks, joined with `, `: `outside <target id>` for a node with `scope` false, then `archived`. A missing node's body is `<id>  (missing)`, and an unreadable node's is `<id>  (unreadable)`.

Chain rows: the roots are the open scope nodes with at least one kept blocker that no open scope node lists in its `blockedBy`. The root whose ID ends the critical path comes first, then the others in creation order. Print a root at depth 0, then each of its blockers at depth + 1, in `blockedBy` order, recursively. A node printed a second time gets `  (shown above)` at the end of its row, and its blockers are not printed again.

Tree rows: each tree entry at its depth, in tree order. In each list of children (the top list included), open nodes print as rows, followed by their own children. Terminal nodes with no open descendant fold into one line, `'  '.repeat(depth) + '  ' + '<n> done or canceled'`, after the rows of that list. A terminal node with an open descendant prints as a row. An issue target's root always prints as a row. A tree row of a node with kept blockers ends with `  blocked by <ids joined with ', '>`.

The full expected output for `team`, `issues dependencies EPC-2M9D`:

```
EPC-2M9D  Reliable webhooks and billing export  in_progress
critical path: ISS-5N1R → ISS-2X6D (11 points)

blocker chain:
* ISS-2X6D  Billing export to CSV  in_progress  ana  8
  * ISS-5N1R  Paginate the events API  in_progress  fred  3  (outside EPC-2M9D)

hierarchy:
* ISS-2X6D  Billing export to CSV  in_progress  ana  8  blocked by ISS-5N1R
    ISS-4M2S  Fix CSV column order  todo  fred  1
  ISS-8C4W  Dead-letter queue for webhooks  in_review  ana  5
  2 done or canceled
1 resolved blocker not shown
```

The full expected output for `no-sprints`, `issues dependencies EPC-4H7V`:

```
EPC-4H7V  Reliable webhooks  in_progress
no blocker links touch EPC-4H7V, so this shows the hierarchy only

hierarchy:
  2 done or canceled
```

### Files

- Create: `scripts/lib/dependencies.mjs`, `scripts/dependencies.test.mjs`, `commands/issues/dependencies.md`, `scripts/__scenarios__/issues-dependencies.mjs`.
- Modify: `scripts/pmkit.mjs`, `scripts/lib/format.mjs`, `scripts/lib/capabilities.mjs`, `scripts/cli.test.mjs`, `scripts/capabilities.test.mjs`, `scripts/goldens.test.mjs`, `scripts/plugin.test.mjs`, `scripts/scenarios.test.mjs`, `skills/pmkit/SKILL.md`, `README.md`, `CONTEXT.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`.
- By regeneration only: `scripts/__goldens__/{basic,team,messy-merge,no-sprints}/issues-dependencies.txt` and `scripts/__scenarios__/issues-dependencies.{0,1}.after.txt`.
- Must not change: `scripts/lib/contract.mjs`, `scripts/contract-suite.mjs`, `scripts/lib/local/`, `scripts/__fixtures__/`, `schemas/`, `templates/`, every other command file, `commands/help.md` (it reads the command folder, so it lists the new command as is), `skills/pmkit/references/conventions.md`, and `CHANGELOG.md` (the spec keeps the PMK-3 pattern: the release adds the line, with no `Tracker format:` and no `Setup:` line).

### Goldens and scenario snapshots

Never edit a golden or a snapshot by hand. Regenerate only with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs` and `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then read every new file and `git diff` line by line. The only new files are the six named under "Files", and no existing golden or snapshot changes. If one does, run `git checkout -- <file>`, find the cause and fix the code.

Never run the CLI from inside `scripts/__fixtures__/`. A read there writes `.issues/.cache/` into the fixture, which git ignores, and 16 tests then fail. Use `makeRepo(<fixture>)` copies. If it happens, `rm -rf scripts/__fixtures__/*/.issues/.cache`.

### Tests and commits

- Baseline: 1093 tests pass at 70574f5. The final count must be higher.
- TDD: write the tests of a task first, run them, and see them fail for the reason the task states before writing the code.
- Every task runs its focused tests, then `npm test` in full, before its commit. Every commit leaves `npm test` green.
- Commit subject: `<type>: <subject> (PMK-20)`. The body is the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Straight quotes and no em dashes in prose. No new dependency. Do not run pmkit write commands on this repo's `.issues/`.

### Acceptance criteria

| Criterion | Covered by |
|---|---|
| 1. The CLI computes the blocker chain and the critical path of an issue or epic | Tasks 1, 2 and 3 (module tests), Task 4 (CLI tests on `EPC-2M9D` and `ISS-2X6D`, goldens) |
| 2. The command shows the chain and highlights the critical path | Task 4 (`*` rows and the `critical path:` line), Task 5 (command file, scenario entry 1) |
| 3. Without dependencies it shows the hierarchy only, and says so | Task 1 (the three reasons), Task 4 (reason lines in text, `ISS-8C4W` resolved), Task 5 (scenario entry 2) |
| 4. Writes nothing | Task 4 (git status stays clean, `--dry-run` and `--as` refused), Task 5 (both scenario entries run with `git: true`, no new events, clean status) |

## Review Focus

1. A parent loop under an issue target (`T.parent` is `P`, `P.parent` is `T`). The tree must stop, with `P` once under `T`. Pinned in Task 1.
2. A `blocked_by` loop written by hand on the `team` fixture. The CLI exits 0, prints parseable JSON, warns on stderr, and the critical path stays `ISS-5N1R → ISS-2X6D`. Pinned in Task 4.
3. A blocker shared by two scope issues. It is one node, it prints in full once and `(shown above)` the second time, and the path picks one chain. Pinned in Task 4.
4. An issue target that is itself `done`, with no open sub-issue. Basis `hierarchy`, reason `none`, and its root still prints as a row. Pinned in Tasks 1 and 4.
5. An epic with no issues. `tree` is `[]` and the text says `no issues` under `hierarchy:`. Pinned in Task 4.

---

### Task 1: the dependency map's scope, hierarchy, blocker graph and basis

**Files:**
- Create: `scripts/lib/dependencies.mjs`
- Test: `scripts/dependencies.test.mjs`

**Interfaces:**
- Consumes: `walkParents(from, parentOf)` from `scripts/lib/local/epics.mjs`, `TERMINAL` from `scripts/lib/model.mjs`, `compareIds` from `scripts/lib/ids.mjs`.
- Produces: `dependencyMap(input)` with the full result shape of "The module". In this task `criticalPath` is always `null`, `critical` is always false and `problems` is always `[]`.

- [ ] **Step 1: Write the failing tests** in `scripts/dependencies.test.mjs`. Helpers: `const st = (category) => ({ name: category, category })`, `const issue = (id, fields = {}) => ({ id, title: id, status: st('todo'), blockedBy: [], related: [], archived: false, ...fields })` and `const epic = { id: 'EPC-1', kind: 'epic', title: 'Epic', status: st('in_progress') }`. The array order is the creation order.
  - `an epic's scope is the non-archived issues whose parent chain reaches it, nested in creation order`: `A` (parent `EPC-1`), `B` (parent `A`), `C` (parent `EPC-1`, archived), `D` (no parent), `E` (parent `EPC-1`, `done`). `nodes` IDs are `['A', 'B', 'E']`, each with `scope: true`. `tree` deep-equals `[{ id: 'A', children: [{ id: 'B', children: [] }] }, { id: 'E', children: [] }]`. `target` deep-equals `{ id: 'EPC-1', kind: 'epic', title: 'Epic', status: st('in_progress'), ancestors: [] }`.
  - `an issue target's scope is the issue and its sub-issues, with its ancestors nearest first`: `P` (parent `EPC-1`), `T` (parent `P`), `S` (parent `T`), `S2` (parent `S`), `X` (parent `T`, archived). Target `{ ...T, kind: 'issue' }`. `nodes` IDs are `['T', 'S', 'S2']`. `tree` is `[{ id: 'T', children: [{ id: 'S', children: [{ id: 'S2', children: [] }] }] }]`. `target.ancestors` is `['P', 'EPC-1']`.
  - `an open blocker outside the scope is upstream and brings its own blockers, not its sub-issues`: `A` (parent `EPC-1`, blockedBy `['U']`), `U` (blockedBy `['V']`), `V`, `W` (parent `U`). `nodes` IDs are `['A', 'U', 'V']`. `U` has `scope: false` and `blockedBy: ['V']`. `basis` is `'blockers'` and `reason` is `null`.
  - `an edge to a done or canceled blocker is dropped and counted`: `A` (parent `EPC-1`, blockedBy `['D', 'K', 'O']`), `D` (`done`), `K` (`canceled`), `O`. `A.blockedBy` is `['O']`, `resolved` is 2, and `D` and `K` are not nodes.
  - `a missing and an unreadable blocker are open nodes that are not followed`: `A` (parent `EPC-1`, blockedBy `['M', 'R']`), `unreadable: ['R']`. The `M` node deep-equals `{ id: 'M', title: null, status: null, assignee: null, estimate: null, parent: null, scope: false, open: true, archived: false, missing: true, unreadable: false, blockedBy: [], critical: false }`. `R` has `missing: false, unreadable: true`. `M` and `R` come last in `nodes`.
  - `an archived blocker that is not done stays, marked archived`: `A` (parent `EPC-1`, blockedBy `['Z']`), `Z` (archived, `in_progress`). `Z` has `archived: true, scope: false`, and `A.blockedBy` is `['Z']`.
  - `the blockers of a done scope issue are not followed`: `A` (parent `EPC-1`, `done`, blockedBy `['O']`), `O`. `nodes` IDs are `['A']`, `resolved` is 0, `basis` is `'hierarchy'` and `reason` is `'none'`.
  - `the basis says why it is the hierarchy only`: with no blocker link, `reason` is `'none'`. With only a `done` blocker, `'resolved'`. With an open blocker and `dependencies: false`, `'absent'`, `resolved` is 0 and every node has `blockedBy: []`. In all three, `criticalPath` is `null`.
  - `related pairs come from scope issues, each pair once`: `A` (parent `EPC-1`, related `['B', 'Q']`), `B` (parent `EPC-1`, related `['A']`), `Q` (no parent). `related` deep-equals `[['A', 'B'], ['A', 'Q']]`.
  - `the weight unit follows the velocity rule`: one open scope node with `estimate: 3` and one without gives `{ unit: 'points' }`. The same with `unit: 'hours'` gives `{ unit: 'hours' }`. No numeric estimate gives `{ unit: 'issues' }`. An estimate of `'M'` with `unit: 'sizes'` gives `{ unit: 'issues' }`. A `done` scope issue with `estimate: 5` and open ones without gives `{ unit: 'issues' }`.
  - `a parent loop under an issue target stops the tree` (Review Focus 1): `T` (parent `P`), `P` (parent `T`). Target `T`. `tree` is `[{ id: 'T', children: [{ id: 'P', children: [] }] }]`, and the call returns.
  - `a done issue target with no open sub-issue is the hierarchy only` (Review Focus 4): `T` (`done`, blockedBy `['O']`), `O`. `basis` `'hierarchy'`, `reason` `'none'`, `tree` `[{ id: 'T', children: [] }]`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/dependencies.test.mjs`
Expected: FAIL, every test, with `Cannot find module` for `./lib/dependencies.mjs`.

- [ ] **Step 3: Implement `dependencyMap`** in `scripts/lib/dependencies.mjs`, as "The module" says, with the scope, ancestors, tree, related, graph, basis and weight unit rules. Keep the graph as a `Map` from ID to node, so Tasks 2 and 3 work on the same structure. Add a header comment like the one of `metrics.mjs`: pure, no file access.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/dependencies.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, no golden or snapshot differs.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/dependencies.mjs scripts/dependencies.test.mjs
git commit -m "feat: add the dependency map's scope, hierarchy and blocker graph (PMK-20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: break hand-made blocked_by loops

**Files:**
- Modify: `scripts/lib/dependencies.mjs`
- Test: `scripts/dependencies.test.mjs`

**Interfaces:**
- Consumes: the node map of Task 1.
- Produces: `problems` filled with `{ id, code: 'cycle', message }`, and `blockedBy` without the dropped edges. The basis reads the graph after the drops.

- [ ] **Step 1: Write the failing tests.** `S` has `parent: 'EPC-1'`, and `A` and `B` have no parent.
  - `a blocked_by loop is broken at the edge that closes it`: `S` (parent `EPC-1`, blockedBy `['A']`), `A` (blockedBy `['B']`), `B` (blockedBy `['A']`). `problems` deep-equals `[{ id: 'B', code: 'cycle', message: 'blocked_by loop: A → B → A; run /pmkit:local:doctor' }]`. `S.blockedBy` is `['A']`, `A.blockedBy` is `['B']`, `B.blockedBy` is `[]`, and `basis` is `'blockers'`.
  - `the loop walk starts from the scope, whatever the creation order`: the same three issues ordered `B`, `A`, `S`. Same `problems` and the same `blockedBy` lists.
  - `a self-loop is dropped, and with no other edge the basis is none`: `S` (parent `EPC-1`, blockedBy `['S']`). `problems` is `[{ id: 'S', code: 'cycle', message: 'blocked_by loop: S → S; run /pmkit:local:doctor' }]`, `S.blockedBy` is `[]`, `basis` `'hierarchy'`, `reason` `'none'`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/dependencies.test.mjs`
Expected: the three new tests FAIL on `problems` (`[]` today) and on the kept `blockedBy`. The Task 1 tests PASS.

- [ ] **Step 3: Implement the loop break** as "The loop break" says, between the graph build and the basis.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/dependencies.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/dependencies.mjs scripts/dependencies.test.mjs
git commit -m "feat: break hand-made blocked_by loops in the dependency map (PMK-20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: the critical path

**Files:**
- Modify: `scripts/lib/dependencies.mjs`
- Test: `scripts/dependencies.test.mjs`

**Interfaces:**
- Consumes: the acyclic node map of Task 2 and the weight unit of Task 1.
- Produces: `criticalPath: { ids, length, unestimated }` with the basis `blockers`, and `critical: true` on its nodes.

- [ ] **Step 1: Write the failing tests.** In these tests every issue whose ID starts with `S` has `parent: 'EPC-1'`, and the others have no parent.
  - `the critical path is the heaviest chain that ends at an open scope issue`: `S1` (parent `EPC-1`, estimate 8, blockedBy `['U']`), `U` (estimate 3), `S2` (parent `EPC-1`, estimate 5). `criticalPath` deep-equals `{ ids: ['U', 'S1'], length: 11, unestimated: [] }`. `critical` is true on `U` and `S1` only.
  - `a lone heavy scope issue can be the critical path`: `S1` (estimate 2, blockedBy `['U']`), `U` (estimate 1), `S2` (estimate 5). `criticalPath` is `{ ids: ['S2'], length: 5, unestimated: [] }`.
  - `an unestimated node weighs 0 and is named`: `S1` (estimate 5, blockedBy `['U', 'M']`), `U` (no estimate), `M` missing, `S2` (estimate 3). `criticalPath` deep-equals `{ ids: ['U', 'S1'], length: 5, unestimated: ['U'] }`. `U` and `M` both weigh 0, and the tie goes to `U`, because a missing node ranks after every real issue.
  - `with no numeric estimate each issue weighs 1`: `S1` (blockedBy `['A']`), `A` (blockedBy `['B']`), `B`, `S2`, none estimated. `weight` is `{ unit: 'issues' }` and `criticalPath` is `{ ids: ['B', 'A', 'S1'], length: 3, unestimated: [] }`.
  - `ties go to the chain whose nodes come first in creation order`: order `X`, `Y`, `S`, with `S` (parent `EPC-1`, estimate 2, blockedBy `['Y', 'X']`), `X` (estimate 3), `Y` (estimate 3). `criticalPath.ids` is `['X', 'S']`. Second case, order `S1`, `S2`, `S3`, `U`: `S1` and `S2` (estimate 3, scope), `S3` (estimate 1, scope, blockedBy `['U']`), `U` (estimate 1). `criticalPath.ids` is `['S1']`.
  - `the hierarchy basis has no critical path`: the `reason: 'resolved'` input of Task 1 has `criticalPath: null` and no node with `critical: true`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/dependencies.test.mjs`
Expected: the new tests FAIL with `criticalPath` `null`. The last one PASSES already and stays as a guard.

- [ ] **Step 3: Implement the longest-path pass** as "The critical path" says. Creation rank is the node's index in `nodes`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/dependencies.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/dependencies.mjs scripts/dependencies.test.mjs
git commit -m "feat: compute the critical path of the dependency map (PMK-20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: the `issues dependencies` CLI command

**Files:**
- Modify: `scripts/pmkit.mjs` (imports, `COMMANDS` after `issues get`), `scripts/lib/format.mjs` (`dependencyText`), `scripts/lib/capabilities.mjs` (`SERVED_BY`), `scripts/goldens.test.mjs` (`CASES`)
- Test: `scripts/cli.test.mjs`, `scripts/capabilities.test.mjs`
- Regenerate: `scripts/__goldens__/{basic,team,messy-merge,no-sprints}/issues-dependencies.txt`

**Interfaces:**
- Consumes: `dependencyMap` (Tasks 1 to 3).
- Produces: `dependencyText(map) -> string` in `scripts/lib/format.mjs`, and the CLI command `issues dependencies <id>`, whose JSON is the map plus the merged `problems`. Task 5 calls it as `issues dependencies <id> --json`.

- [ ] **Step 1: Write the failing tests** in `scripts/cli.test.mjs`, after `epic create, issues parent and epic progress`. Use `makeRepo` copies, never the fixture folders.
  - `issues dependencies on an epic prints the critical path, the blocker chain and the hierarchy`: on `team`, `run(root, ['issues', 'dependencies', 'EPC-2M9D'])` exits 0, `stdout` equals the `EPC-2M9D` text of "The text layout" plus `\n`, and `stderr` matches `/^warning: ISS-3Q6T: CONFLICT /m`. The JSON has `basis: 'blockers'`, `reason: null`, `weight: { unit: 'points' }`, `criticalPath: { ids: ['ISS-5N1R', 'ISS-2X6D'], length: 11, unestimated: [] }`, `resolved: 1`, `related: [['ISS-2X6D', 'ISS-0G5E']]`, `target.ancestors: []`, node IDs `['ISS-7K3Q', 'ISS-4P8A', 'ISS-2X6D', 'ISS-5N1R', 'ISS-8C4W', 'ISS-4M2S']`, and `problems` deep-equal `[{ id: 'ISS-3Q6T', code: 'CONFLICT', message: 'The issue file contains git conflict markers.' }]`.
  - `issues dependencies on an issue shows its parents and its sub-issues`: on `team`, `ISS-2X6D`. JSON `target` has `kind: 'issue'` and `ancestors: ['EPC-2M9D']`, `tree` deep-equals `[{ id: 'ISS-2X6D', children: [{ id: 'ISS-4M2S', children: [] }] }]`, `criticalPath.ids` is `['ISS-5N1R', 'ISS-2X6D']`. The text starts with `ISS-2X6D  Billing export to CSV  in_progress\nparents: EPC-2M9D\ncritical path: ISS-5N1R → ISS-2X6D (11 points)\n`, and contains `(outside ISS-2X6D)`.
  - `issues dependencies with no blocker shows the hierarchy only and says why`: on `no-sprints`, `EPC-4H7V`. `stdout` equals the `EPC-4H7V` text of "The text layout" plus `\n`. JSON `basis: 'hierarchy'`, `reason: 'none'`, `criticalPath: null`.
  - `issues dependencies says when every blocker is done`: on `team`, `ISS-8C4W`. JSON `reason: 'resolved'`, `resolved: 1`. The text's first three lines are `ISS-8C4W  Dead-letter queue for webhooks  in_review`, `parents: EPC-2M9D` and `every blocker of ISS-8C4W is done or canceled, so this shows the hierarchy only`, and its last line is `1 resolved blocker not shown`.
  - `issues dependencies on an unknown id is NOT_FOUND`: on `team`, `ISS-ZZZZ` and `EPC-ZZZZ` with `--json` exit 2 with `error.code` `NOT_FOUND`.
  - `issues dependencies writes nothing and takes no write flag`: on `team`, `git init`, configure the user, `git add -A` and commit, as `the index never reaches git status or an auto-commit` does. Run `issues dependencies` on `EPC-2M9D` and `ISS-2X6D`, as text and `--json`. `git status --porcelain` is `''`. `--dry-run` and `--as fred` each exit 2 with `stderr` matching `/unknown option --dry-run/` and `/unknown option --as/`.
  - `issues dependencies breaks a hand-made loop and still answers` (Review Focus 2): on `team`, insert `blocked_by: [ISS-2X6D]\n` before the `created:` line of `.issues/issues/ISS-5N1R/issue.md`. `--json` exits 0 and parses, `criticalPath.ids` is `['ISS-5N1R', 'ISS-2X6D']`, and the text run's `stderr` matches `/^warning: ISS-5N1R: cycle blocked_by loop: ISS-2X6D → ISS-5N1R → ISS-2X6D; run \/pmkit:local:doctor$/m`.
  - `issues dependencies prints a shared blocker once and a missing one as missing` (Review Focus 3): on `team`, replace the line `blocked_by: [ISS-7K3Q]` of `.issues/issues/ISS-8C4W/issue.md` with `blocked_by: [ISS-7K3Q, ISS-5N1R, ISS-ZZZZ]`. The critical path stays `ISS-5N1R → ISS-2X6D` (11 against 8), so the `ISS-2X6D` root prints first. The text contains the line `  * ISS-5N1R  Paginate the events API  in_progress  fred  3  (outside EPC-2M9D)  (shown above)` exactly once and the line `    ISS-ZZZZ  (missing)`. JSON has one `ISS-5N1R` node and an `ISS-ZZZZ` node with `missing: true`, and `resolved` is still 1.
  - `issues dependencies on an empty epic and on a done issue` (Review Focus 4 and 5): on `basic`, `epic create --title E`, then `issues dependencies <new id>`. JSON `tree` is `[]`, and the text ends with `hierarchy:\n  no issues\n`. On `team`, `ISS-7K3Q` (done, no sub-issue): JSON `reason: 'none'`, and the text contains `  ISS-7K3Q  Retry failed webhook deliveries  done  fred  3`.
  - In `--help lists every command and exits 2`, add `'issues dependencies'` to the list.
  - In `scripts/capabilities.test.mjs`, a test `issues dependencies serves dependencies and multilevel_hierarchy`: `SERVED_BY.dependencies` and `SERVED_BY.multilevel_hierarchy` both include `'issues dependencies'`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/cli.test.mjs scripts/capabilities.test.mjs`
Expected: the new tests FAIL with `unknown command "issues dependencies"` (exit 2), and the `--help` and `SERVED_BY` tests FAIL on the missing name.

- [ ] **Step 3: Implement**
  - `dependencyText(map)` in `scripts/lib/format.mjs`, as "The text layout" says.
  - The `COMMANDS` entry and the imports in `scripts/pmkit.mjs`, as "The CLI entry" says.
  - `SERVED_BY` in `scripts/lib/capabilities.mjs`: `multilevel_hierarchy: ['issues parent', 'epic list', 'issues dependencies']` and `dependencies: ['issues link', 'issues dependencies']`. The manifest keeps 10 native, 2 derived and 8 absent.
  - `CASES` in `scripts/goldens.test.mjs`, after `'issues get'`: `'issues dependencies': (a) => [[a.epic], [a.issue]],`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/cli.test.mjs scripts/capabilities.test.mjs`
Expected: PASS.

- [ ] **Step 5: Generate the goldens and read them**

Run: `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, then `git status --short scripts/__goldens__`.
Expected: four new files, `scripts/__goldens__/{basic,team,messy-merge,no-sprints}/issues-dependencies.txt`, and no modified file. Read each one:
- `basic`: `EPC-0000` and `ISS-0000` exit 2 with `NOT_FOUND`.
- `team`: `EPC-2M9D` prints the text of "The text layout" and the ISS-3Q6T warning. `ISS-5N1R` is the hierarchy only, with `reason: "none"` and `no blocker links touch ISS-5N1R`.
- `messy-merge`: `EPC-1` is the hierarchy only, with the `ISS-2` and `ISS-7` rows, `1 done or canceled`, and two CONFLICT warnings for ISS-4 and ISS-5. `ISS-1` (done) is the hierarchy only, with its row and `parents: EPC-1`.
- `no-sprints`: `EPC-4H7V` prints the text of "The text layout". `ISS-9B2X` is the hierarchy only.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/pmkit.mjs scripts/lib/format.mjs scripts/lib/capabilities.mjs scripts/goldens.test.mjs scripts/cli.test.mjs scripts/capabilities.test.mjs scripts/__goldens__
git commit -m "feat: add the issues dependencies CLI command (PMK-20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: the `/pmkit:issues:dependencies` command

**Files:**
- Create: `commands/issues/dependencies.md`, `scripts/__scenarios__/issues-dependencies.mjs`
- Modify: `skills/pmkit/SKILL.md`, `README.md`
- Test: `scripts/plugin.test.mjs`, `scripts/scenarios.test.mjs`
- Regenerate: `scripts/__scenarios__/issues-dependencies.0.after.txt`, `scripts/__scenarios__/issues-dependencies.1.after.txt`

**Interfaces:**
- Consumes: `issues dependencies <id> --json` (Task 4).
- Produces: the command file and its routing rows.

- [ ] **Step 1: Write the failing tests**
  - `scripts/plugin.test.mjs`: in `COMMANDS`, the `issues` list gains `'dependencies'` after `'create'`.
  - `scripts/scenarios.test.mjs`: `there are 24 command files` becomes `there are 25 command files`, with `25` in the assertion.
  - `scripts/__scenarios__/issues-dependencies.mjs`, a default export of two entries:

```js
// /pmkit:issues:dependencies for an epic with a blocker outside it (team, EPC-2M9D)
// and for an epic with no blocker links (no-sprints, EPC-4H7V). The command only reads.
import assert from 'node:assert/strict'

export default [
  {
    command: 'issues/dependencies',
    fixture: 'team',
    git: true,
    prompt: '/pmkit:issues:dependencies EPC-2M9D',
    answers: [],
    steps: [{ step: '1', read: ['issues', 'dependencies', 'EPC-2M9D'], save: 'map' }],
    skip: {},
    notHit: {},
    expect(repo, saved) {
      assert.equal(saved.map.basis, 'blockers')
      assert.deepEqual(saved.map.criticalPath.ids, ['ISS-5N1R', 'ISS-2X6D'])
      assert.deepEqual(saved.map.nodes.filter((node) => node.critical).map((node) => node.id), ['ISS-2X6D', 'ISS-5N1R'])
      for (const id of ['ISS-2X6D', 'ISS-5N1R', 'ISS-8C4W', 'ISS-4M2S']) assert.deepEqual(repo.newEvents(id), [])
      assert.equal(repo.git('status', '--porcelain'), '')
    },
  },
  {
    command: 'issues/dependencies',
    fixture: 'no-sprints',
    git: true,
    prompt: '/pmkit:issues:dependencies EPC-4H7V',
    answers: [],
    steps: [{ step: '1', read: ['issues', 'dependencies', 'EPC-4H7V'], save: 'map' }],
    skip: {},
    notHit: {},
    expect(repo, saved) {
      assert.equal(saved.map.basis, 'hierarchy')
      assert.equal(saved.map.reason, 'none')
      assert.equal(saved.map.criticalPath, null)
      assert.equal(repo.git('status', '--porcelain'), '')
    },
  },
]
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/plugin.test.mjs scripts/scenarios.test.mjs`
Expected: FAIL. `the 15 commands in commands/issues exist` misses `dependencies`, the skill table and README test misses `issues:dependencies`, `there are 25 command files` finds 24, and rule 1 reports that `issues-dependencies.mjs` names no command file.

- [ ] **Step 3: Write `commands/issues/dependencies.md`** with this text:

````markdown
---
description: Show what blocks an issue or an epic, with the blocker chain, the hierarchy and the critical path
argument-hint: "<id>"
disable-model-invocation: true
---

# Show what blocks an issue or an epic

Arguments: `$ARGUMENTS`

## Parameters

- `id` (required): an issue ID or an epic ID, for example `ISS-2X6D` or `EPC-2M9D`.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues dependencies <id> --json`. Every later step reads this result. Do not compute anything the result does not hold.
2. When `basis` is `blockers`, lead with one line: how many open issues in `nodes` have `scope` false or appear in a `blockedBy` list, and which of them have `scope` false. Then show the critical path in bold on its own line, as `ISS-5N1R → ISS-2X6D (11 points)`, from `criticalPath.ids`, `criticalPath.length` and `weight.unit`. Then show the blocker chain as an issue table with the five standard columns, plus "Blocked by" (the node's `blockedBy`) and "Critical path" (`yes` when `critical` is true, empty otherwise). The rows are the nodes of the critical path from its start, then the other open nodes that block or are blocked, in the order of `nodes`. For each ID in `criticalPath.unestimated`, say that it has no estimate and counts as 0.
3. When `basis` is `hierarchy`, say in one line that this is the hierarchy only and why, from `reason`: `none` means no blocker link touches the target, `resolved` means every blocker is done or canceled, and `absent` means the tracker has no dependencies capability. When `related` is not empty, list each pair as a related link after the hierarchy.
4. In both bases, show the hierarchy from `tree` as an indented list under the target, one issue per line with its ID, title and status. For an issue target, show `target.ancestors` as one line above it, from the top down. Fold the done and canceled issues of each level into a count. Mark in words each node that is missing, unreadable, archived, or outside the target (`scope` false).
5. Show each entry of `problems` once as a warning. For a problem with code `cycle`, offer `/pmkit:local:doctor` to fix the loop.
6. End with one next step. With the basis `blockers`, name the first open node of the critical path as the issue to unblock first, and offer `/pmkit:issues:summary <id>` to read it. With the basis `hierarchy`, offer `/pmkit:issues:link` to record blockers.

## Confirmation points

None. The command only reads, and it runs no `pr sync`.

## Output

Lead with the answer, then the critical path, the table and the hierarchy. Write every issue ID in full.

## If something is missing

- No ID: ask for it.
- An unknown ID (`NOT_FOUND`): say so and ask for a corrected ID.
- An epic with no issues: say so. The hierarchy is empty.
- A target whose scope is all done or canceled: say there is no open work under it.
- An error from the CLI: apply the rules for reading errors in the conventions.
````

- [ ] **Step 4: Add the routing rows**
  - `skills/pmkit/SKILL.md`, after the `/pmkit:issues:create` row: `| show what blocks an issue or an epic, with the blocker chain, the hierarchy and the critical path | \`/pmkit:issues:dependencies\` | \`${CLAUDE_PLUGIN_ROOT}/commands/issues/dependencies.md\` |`
  - `README.md`, "Commands" list, after `/pmkit:issues:create`: ``- `/pmkit:issues:dependencies`: Show what blocks an issue or an epic, with the blocker chain, the hierarchy and the critical path.``
  - `README.md`, CLI table, after the `issues get <id>` row: ``| `issues dependencies <id>` | shows the blocker chain, the hierarchy and the critical path of an issue or an epic; only reads |``

- [ ] **Step 5: Generate the snapshots and read them**

Run: `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then `git status --short scripts/__scenarios__`.
Expected: two new files, `issues-dependencies.0.after.txt` and `issues-dependencies.1.after.txt`, each with one line `$ pmkit issues dependencies <epic> --json  [step 1, read]`, `exit 0`, and no file changes. No other snapshot changes.

- [ ] **Step 6: Run the focused tests, then the whole suite**

Run: `node --test scripts/plugin.test.mjs scripts/scenarios.test.mjs`, then `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add commands/issues/dependencies.md scripts/__scenarios__/issues-dependencies.mjs scripts/__scenarios__/issues-dependencies.0.after.txt scripts/__scenarios__/issues-dependencies.1.after.txt scripts/plugin.test.mjs scripts/scenarios.test.mjs skills/pmkit/SKILL.md README.md
git commit -m "feat: add /pmkit:issues:dependencies (PMK-20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: the terms and the design spec

**Files:**
- Modify: `CONTEXT.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`
- Test: `scripts/plugin.test.mjs`

**Interfaces:**
- Consumes: the names of Tasks 4 and 5.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing test.** In `scripts/plugin.test.mjs`, `TERMS` gains `'Blocker chain'` and `'Critical path'` after `'Blocked'`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/plugin.test.mjs`
Expected: `CONTEXT.md defines every term of the model` FAILS with `['Blocker chain', 'Critical path']`.

- [ ] **Step 3: Write the docs**
  - `CONTEXT.md`, right after the **Blocked** entry and its _Avoid_ line:

```markdown
**Blocker chain**:
The open issues that block an issue or the issues under an epic, followed through their own blockers until none is left. A blocker in a terminal category no longer blocks, so the chain stops there. A missing blocker stays in the chain. `/pmkit:issues:dependencies` shows it.
_Avoid_: dependency tree, blocking tree

**Critical path**:
The heaviest chain of open issues, linked by blocker edges, that ends at an open issue of the target. Its length adds the estimates, as velocity does, or counts the issues when no open issue in the map has a numeric estimate. It is the chain that sets the earliest finish of the target.
_Avoid_: longest path, critical chain
```

  - `docs/superpowers/specs/2026-10-23-pmkit-design.md`, CLI table, after the `issues get <id> [--comments] [--history]` row: ``| `issues dependencies <id>` | the blocker chain, the hierarchy and the critical path of an issue or an epic; only reads |``
  - Same file, Commands table, after the `/pmkit:issues:summary <id>` row: ``| `/pmkit:issues:dependencies <id>` | `commands/issues/dependencies.md` | `issues dependencies` |``
  - Same file, the sentence "The MVP ships 24 command files." becomes "The MVP shipped 24 command files, and phase 2 adds `/pmkit:issues:dependencies`."

- [ ] **Step 4: Run to verify it passes**

Run: `node --test scripts/plugin.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, more than 1093 tests, and `git status --short` shows only the two docs and the test.

- [ ] **Step 6: Commit**

```bash
git add CONTEXT.md docs/superpowers/specs/2026-10-23-pmkit-design.md scripts/plugin.test.mjs
git commit -m "docs: define blocker chain and critical path, and list issues dependencies (PMK-20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
