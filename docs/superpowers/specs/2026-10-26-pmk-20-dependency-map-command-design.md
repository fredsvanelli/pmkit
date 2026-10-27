# PMK-20 design: the dependency-map command

Issue PMK-20, epic EPC-3 (Phase 2 commands), milestone `phase-2-commands`. Status: approved. On 2026-10-26 the user answered the four open questions and took the recommended option of each, as recorded under "Answered questions". Calls marked **(builder's call)** were made while writing this spec, and none of them changes an acceptance criterion.

## Problem

A PM or an EM asks "what is blocking this epic?" and pmkit has no answer in one step. The pieces exist, but each command shows one hop:

- `issues get <id>` prints the issue's own `blocked_by`, `blocks` and `children`.
- `issues list --blocked` lists issues with an open blocker, one row each, with no chain.
- `/pmkit:issues:summary` lists the open blockers of one issue.
- `/pmkit:report:status` lists blocked issues of an epic for the period.

None of them follows a blocker's own blockers, looks past the epic's boundary, or says which chain sets the finish date. ADR-0002 says a command never computes, so the chain and the critical path need a CLI command first.

Sources: Unified model, Foundation catalog (`dependency-map`: "Chain of blockers and hierarchy, with critical path"; degradation "Hierarchy only, or related links"). Linear tab ("What is blocking project X?"). The design spec's build order lists `dependency-map` first among the phase 2 commands.

Acceptance criteria:

1. The CLI computes the blocker chain and the critical path of an issue or epic.
2. The command shows the chain and highlights the critical path.
3. Without dependencies it shows the hierarchy only, and says so.
4. Writes nothing.

## Goals

- One CLI read, `issues dependencies <id>`, that takes an issue ID or an epic ID and returns the hierarchy under it, the chain of open blockers that reaches it, and the critical path through that chain.
- One command file that turns that result into an answer to "what is blocking X?", with the critical path marked.
- A hierarchy-only result, with a stated reason, when no open blocker touches the target or when the tracker has no `dependencies` capability.
- No write of any kind: no tracker file, no event, no `pr sync`.

## Non-goals

- Downstream impact, meaning what the target blocks outside itself. Question 4 chose upstream only. A "waiting on this" list is a follow-up issue.
- Dates. The critical path is a length in estimate units or issues, not a forecast. `/pmkit:report:status` already compares progress with the target date.
- Remaining work on an issue in progress. An open issue counts its full estimate, because the tracker holds no remaining-work field.
- More than one critical path. When two chains tie, the result names one, by the tie rule below.
- A graph picture (Mermaid, DOT, HTML). `local-render` (PMK-25) owns rendered views.
- Fixing anything. The command may point at `/pmkit:issues:link` or `/pmkit:local:doctor`, but it never runs a write.
- A change to the tracker contract, to the Local tracker files or to the tracker format.

## Anti-goals

- The command must not hide a blocker. A blocker that is missing, unreadable, archived or outside the epic still shows in the chain, marked as such. Leaving it out would answer "nothing blocks this" when something does.
- The computation must not loop or fail on a `blocked_by` loop written by hand. `issues link` refuses loops, but a hand edit can make one, and `validate` reports it. The map breaks the loop, says where, and still answers.
- No hidden write. `pr sync` is a write, so this command never runs it, unlike `/pmkit:report:status`.

## Terms

The spec uses these terms. The builder adds the first two to `CONTEXT.md`.

- **Blocker chain**: the open issues that block the target, followed through their own blockers until none is left. Only edges to an open blocker count. A blocker in a terminal category (`done`, `canceled`) no longer blocks, as **Blocked** in `CONTEXT.md` already says.
- **Critical path**: the longest chain of open issues, linked by blocker edges, that ends at an open issue in the scope. Its length is the sum of the issues' weights (see "Weights"). It is the chain that sets the earliest finish of the target.
- **Scope**: the target and everything under it. For an epic, the non-archived issues whose parent chain reaches the epic, the same set `epic progress` counts. For an issue, the issue and its non-archived sub-issues at every depth.
- **Upstream**: open blockers of scope issues that are not in the scope themselves, and their blockers in turn.

## Approaches

1. **A pure module over existing reads (chosen).** A new `scripts/lib/dependencies.mjs` takes the issues and the target and returns the map. It reads no file, as `scripts/lib/metrics.mjs` reads none. The CLI feeds it from `getIssue` or `getDeliverable`, `searchIssues({ archived: true })` and `capabilities()`. Every tracker adapter that implements today's contract gets the command for free, and the contract suite does not change.
2. **A new contract operation, `dependencyMap(id)`.** Each adapter would implement it, and a hosted tracker could use a native relations query. It adds an operation that every adapter must carry and test, for a result the existing reads already give. A later adapter that needs speed can still add a faster path behind the same module.
3. **A command that computes from several CLI reads.** `/pmkit:issues:summary` style: `issues get` per blocker, then the agent works out the chain. ADR-0002 forbids it, the critical path would differ between agents, and it costs one call per hop.

Approach 1 follows ADR-0002 and the `metrics.mjs` precedent, and needs no contract change.

## Design

### The computation

`dependencyMap({ target, issues, dependencies })` in `scripts/lib/dependencies.mjs`.

- `target` is the issue (from `getIssue`) or the epic (from `getDeliverable`), with a `kind` of `issue` or `epic`.
- `issues` is every issue from `searchIssues({ archived: true })`. Archived issues are needed because an archived blocker that is not terminal still blocks, as `isBlocked` in `scripts/lib/local/query.mjs` already treats it.
- `dependencies` is `false` when the tracker's manifest gives the `dependencies` capability the path `absent`. The Local tracker always reports it `native`, so only unit tests and a later hosted adapter take the `false` branch.

Steps:

1. Build the scope. For an epic, walk each issue's parent chain with `walkParents` from `scripts/lib/local/epics.mjs` and keep the non-archived issues whose chain reaches the epic, as `deliverableProgress` does. For an issue, keep the issue and walk `parent` links down to collect its non-archived sub-issues. Also record the target's ancestors (its parent chain up to the epic), for display only.
2. Build the blocker graph, unless `dependencies` is `false`. Start from every open scope issue. For each `blockedBy` entry, add the edge "blocker blocks issue" when the blocker is open, missing or unreadable, and follow that blocker's own `blockedBy` in turn. Skip an edge to a blocker in a terminal category, and count it as resolved. A blocker that is not in the scope is upstream. Upstream blockers bring their own blockers, never their sub-issues.
3. Break loops. A depth-first walk marks an edge that closes a loop, drops it from the graph, and adds a problem `blocked_by loop: A → B → A; run /pmkit:local:doctor`. The rest of the graph stays as it is.
4. Pick the basis. The basis is `blockers` when the graph has at least one open edge. Otherwise it is `hierarchy`, with one of three reasons. `absent` means the tracker has no `dependencies` capability. `resolved` means blocker links touch the scope, but every blocker is terminal. `none` means no open issue in the scope has a blocker.
5. With the basis `blockers`, compute the critical path. Each open issue in the graph is a node with a weight (see "Weights"). The path is the heaviest chain of nodes, linked by blocker edges, that ends at an open scope issue. A scope issue with no blocker is a chain of one, so with weights by estimate a large lone issue can be the critical path. Ties go to the chain whose nodes come first in creation order, oldest first, comparing from the start of the chain **(builder's call)**. The walk is a longest-path pass over the graph in topological order, which is linear in nodes and edges.
6. With the basis `hierarchy`, there is no critical path. The result also lists the `related` links of the scope issues, because the catalog names related links as the fallback.

Missing and unreadable blockers. A `blockedBy` entry with no issue in `issues` is a node marked `missing`. An entry whose file `searchIssues` reported as a problem (a `CONFLICT` from merge markers, for example) is marked `unreadable`. Both count as open, as **Blocked** already says for a missing blocker. They have no estimate and no blockers of their own.

A sub-issue does not block its parent here. The hierarchy decides the scope, and only blocker edges decide the chain and the critical path (question 3, answer A).

### Weights

The weight of a node follows the rule `metrics velocity` already uses for its unit, so the two numbers agree:

- When at least one open node in the graph has a numeric estimate, each node weighs its estimate, and a node without a numeric estimate weighs 0. The unit is the tracker's estimate unit (`points` or `hours`).
- Otherwise each node weighs 1 and the unit is `issues`.
- A tracker with `estimate.unit: sizes` and string sizes (`S`, `M`) has no numeric estimates, so it falls to issue counts.

The result lists the nodes on the critical path that have no numeric estimate, so the command can say "ISS-X has no estimate and counts as 0". Question 1 chose this rule (answer A).

### CLI

One entry in `COMMANDS` in `scripts/pmkit.mjs`, in the `issues` group because it takes an issue or an epic, as `issues list --parent` does (question 2, answer A):

| Command | Text output | JSON |
|---|---|---|
| `issues dependencies <id>` | the map below | the object below |

It is a read. It has no `write: true`, so it takes neither `--dry-run` nor `--as`, and it has no `commit`. It resolves the ID by prefix: the tracker's `epic_prefix` goes to `getDeliverable`, anything else to `getIssue`. An unknown ID fails with the `NOT_FOUND` of the read it called. It reads the manifest with `capabilities()` for the `dependencies` path. Each entry of `problems` from `searchIssues`, and each loop problem, goes to `warnings`, so it prints on stderr and the JSON on stdout stays clean, as `issues list` does.

JSON shape:

```json
{
  "target": { "id": "EPC-2M9D", "kind": "epic", "title": "...", "status": { "name": "in_progress", "category": "in_progress" }, "ancestors": [] },
  "basis": "blockers",
  "reason": null,
  "weight": { "unit": "points" },
  "nodes": [
    { "id": "ISS-2X6D", "title": "...", "status": { "name": "in_progress", "category": "in_progress" }, "assignee": "ana", "estimate": 8,
      "parent": "EPC-2M9D", "scope": true, "open": true, "archived": false, "missing": false, "unreadable": false,
      "blockedBy": ["ISS-5N1R"], "critical": true }
  ],
  "tree": [{ "id": "ISS-2X6D", "children": [{ "id": "ISS-4M2S", "children": [] }] }],
  "criticalPath": { "ids": ["ISS-5N1R", "ISS-2X6D"], "length": 11, "unestimated": [] },
  "resolved": 1,
  "related": [],
  "problems": []
}
```

- `reason` is `null` with the basis `blockers`, and `none`, `resolved` or `absent` with the basis `hierarchy`.
- `nodes` holds every scope issue (open or terminal) and every upstream node, in creation order. `blockedBy` on a node lists only the open edges kept in the graph. `critical` is true on the nodes of the critical path.
- `tree` is the hierarchy under the target, children in creation order. For an issue target, the root is the issue itself.
- `criticalPath` is `null` with the basis `hierarchy`.
- `resolved` counts the edges dropped because the blocker is terminal.
- `related` holds `[a, b]` pairs from the `related` field of scope issues, each pair once. It is filled in both bases. The command shows it only with the basis `hierarchy`.

Text output for the `team` fixture, `issues dependencies EPC-2M9D`. The exact layout is the builder's call, and the golden records it. The text must keep these parts: the target line, the critical path line with its length and unit, the blocker chain with `*` on critical nodes, and the hierarchy tree with terminal issues folded into a count.

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

In that fixture ISS-8C4W is blocked by ISS-7K3Q, which is done, so the edge is resolved. ISS-3Q6T has conflict markers, so its warning prints on stderr.

Hierarchy-only text, for `issues dependencies EPC-4H7V` in the `no-sprints` fixture:

```
EPC-4H7V  Reliable webhooks  ...
no open issue in the scope of EPC-4H7V has a blocker, so this shows the hierarchy only

hierarchy:
  2 done or canceled
```

The second line changes with the reason: `every blocker of EPC-4H7V is done or canceled` for `resolved`, and `this tracker has no dependencies capability` for `absent`.

### Capability manifest

`SERVED_BY` in `scripts/lib/capabilities.mjs` adds `issues dependencies` to `dependencies` and to `multilevel_hierarchy`. Both are already `native`, so the manifest stays at 10 native, 2 derived and 8 absent, and ADR-0001 does not change.

### The command file

`commands/issues/dependencies.md`, so `/pmkit:issues:dependencies <id>` (question 2, answer A). It has the six sections `plugin.test.mjs` checks, and its first step reads the conventions.

- Parameters: `id` (required), an issue ID or an epic ID. Without one, ask for it, as `/pmkit:issues:summary` does.
- Step 1 runs `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues dependencies <id> --json`.
- Step 2, basis `blockers`. Lead with the answer in one line: how many open issues block the target, and which of them sit outside its scope. Then the critical path on its own line, in bold, as `ISS-A → ISS-B (11 points)`. Then a table of the blocker chain with the five conventional columns, plus "Blocked by" and "Critical path" (`yes` or empty). Rows follow the critical path first, from its start, then the other nodes in creation order. Name each node on the critical path that has no estimate and counts as 0.
- Step 3, basis `hierarchy`. Say in one line that this is the hierarchy only and why, using `reason`. Show the tree and, when `related` is not empty, the related links.
- Step 4. In both bases, show the hierarchy as an indented list under the target, with the ancestors of an issue target as one line above it. Mark missing, unreadable, archived and outside-scope nodes in words, not only with symbols.
- Step 5. Show each warning once. A loop warning offers `/pmkit:local:doctor`.
- Step 6. End with one next step: the first open node of the critical path, as the issue to unblock first, with `/pmkit:issues:summary <id>` to read it. With the basis `hierarchy`, suggest `/pmkit:issues:link` to record blockers.

Confirmation points: none. The command only reads, and it runs no `pr sync`.

Output: lead with the answer, then the critical path, the table and the tree. Every issue ID in full.

If something is missing: no ID; an unknown ID (`NOT_FOUND`, ask for a corrected one); an epic with no issues (say so, the tree is empty); a target whose scope is all done or canceled (say there is no open work); any CLI error by the conventions.

`skills/pmkit/SKILL.md` gets a row: "see what blocks an issue or an epic: the blocker chain, the hierarchy and the critical path". `README.md` gets the command and the CLI row. `/pmkit:help` reads the command folder, so it lists the command with no change.

### What "writes nothing" means

The CLI entry is a read. It writes no issue, epic, sprint or event file, and it has no `commit`. `searchIssues` may refresh `.issues/.cache/index.json`, as every `issues list` does. Git ignores that file, and `CONTEXT.md` says it is never a source of truth, so it does not count as a write **(builder's call)**. The command runs no write and no `pr sync`.

### Docs

- `docs/superpowers/specs/2026-10-23-pmkit-design.md`: the CLI table gets `issues dependencies <id>`, and the Commands table gets the new command with the call `issues dependencies`.
- `CONTEXT.md`: the terms **Blocker chain** and **Critical path**, as in "Terms" above, each with an _Avoid_ line (`dependency tree`, `blocking tree` for the first; `longest path`, `critical chain` for the second).
- `README.md` and `skills/pmkit/SKILL.md`: as above.
- `CHANGELOG.md`: no change on this branch, as PMK-3 set. The release adds a line with no `Tracker format:` line and no `Setup:` line.

## Tests per criterion

| Criterion | Tests |
|---|---|
| 1. The CLI computes the chain and the critical path | `scripts/dependencies.test.mjs` for the pure module: a transitive chain, an upstream blocker outside an epic, a resolved edge dropped and counted, a missing and an unreadable blocker kept as open, an archived open blocker kept, a hand-made loop broken with a problem, the weight rule (estimates, a 0 for an unestimated node, issue counts when no node has a number, string sizes), the tie rule, a lone heavy issue as the critical path, an issue target with sub-issues and ancestors. `scripts/cli.test.mjs`: text and JSON for `issues dependencies EPC-2M9D` and `ISS-2X6D` on the `team` fixture, `NOT_FOUND` for an unknown ID, and the conflict warning on stderr. `scripts/goldens.test.mjs`: a `CASES` entry `'issues dependencies': (a) => [[a.epic], [a.issue]]`, regenerated for the four fixtures. |
| 2. The command shows the chain and highlights the critical path | `scripts/__scenarios__/issues-dependencies.mjs`, entry 1: `team` fixture, `/pmkit:issues:dependencies EPC-2M9D`, one read step, `expect` checks the saved JSON has `criticalPath.ids` `ISS-5N1R, ISS-2X6D` and that the snapshot names both. `plugin.test.mjs`: the `COMMANDS` map gains `dependencies` under `issues`, and the skill table and README tests cover the new rows. |
| 3. Hierarchy only, and says so | Unit tests for the three reasons (`none`, `resolved`, `absent`). Scenario entry 2: `no-sprints` fixture, `/pmkit:issues:dependencies EPC-4H7V`, `expect` checks `basis: 'hierarchy'` and `reason: 'none'`. The `team` golden for `ISS-5N1R` also records a hierarchy-only result, since nothing blocks that issue. |
| 4. Writes nothing | The CLI test runs the command on a git copy of the `team` fixture and checks that `git status --porcelain` is empty and no `events.jsonl` changed. A CLI test checks that `--dry-run` and `--as` are refused as unknown flags. Both scenario entries run with `git: true` and assert no new events. The command file has no `pmkit.mjs` call to a write command. |

`capabilities.test.mjs` already checks that every `SERVED_BY` name exists in `COMMANDS`, so it covers the new entry.

## Decisions

| Decision | Reason |
|---|---|
| Compute in a pure module over `getIssue`, `getDeliverable`, `searchIssues` and `capabilities` | ADR-0002 puts computation in the CLI. `metrics.mjs` set the pure-module pattern. No contract change, so every adapter gets the command. |
| The hierarchy sets the scope, and blocker edges set the chain (question 3, answer A) | `CONTEXT.md` defines **Blocked** by `blocked_by` only. A parent's own estimate often overlaps its sub-issues' estimates, so counting both would inflate the path. |
| Follow only open blockers. Count resolved edges, do not show them | **Blocked** treats a terminal blocker as no blocker. The count tells the user the links exist. |
| Missing and unreadable blockers count as open, with no weight | **Blocked** already counts a missing blocker as blocking. Hiding them would break the first anti-goal. |
| An archived blocker that is not terminal stays in the chain, marked archived | `isBlocked` reads archived issues for the same reason. The scope itself skips archived issues, as `epic progress` does. |
| Upstream blockers bring their blockers, not their sub-issues | The chain answers "what must finish first". Pulling in sub-issues of an outside blocker would turn the map into the whole tracker. |
| Break a hand-made loop and warn, instead of failing | The second anti-goal. `validate` and `/pmkit:local:doctor` already own the fix. |
| A scope issue with no blocker is a chain of one | That is the standard critical path. A large lone issue can set the finish date. |
| Weights follow the `metrics velocity` unit rule (question 1, answer A) | The same tracker then reports one unit across velocity and the critical path. |
| Ties go to creation order | The conventions order every pick by creation, oldest first. |
| Related links appear only in the hierarchy-only output | The catalog names them as the fallback. With blockers, they add rows that do not change the answer. |
| No `pr sync` before the map | Acceptance criterion 4. A user who wants fresh PR state runs `/pmkit:issues:mine` or `/pmkit:report:status` first. |
| The query index refresh does not count as a write | It is gitignored and never a source of truth, and `issues list` already refreshes it. |
| `SERVED_BY` adds the command to `dependencies` and `multilevel_hierarchy` | It reads both. No path changes. |
| No `CHANGELOG.md` edit on this branch | PMK-3 set the pattern. |

## Risks

- A hosted tracker with thousands of issues makes `searchIssues({ archived: true })` slow. The Local tracker reads the query index. A later adapter can feed the module from a native relations query without changing the command.
- Partial estimates bend the critical path toward estimated issues. The output names each unestimated node on the path, so the user sees why.
- The `team` fixture's conflicted ISS-3Q6T has no readable parent, so the map cannot tell whether it belongs to EPC-2M9D. It prints a warning and stays out of the scope. A blocker that points at it shows as unreadable.

## Answered questions

The user answered these on 2026-10-26 and took the recommended option of each. The options stay for the record.

1. **What length does the critical path measure?** It decides which chain the command calls critical.
   - A. The `metrics velocity` rule: estimates when any open node has a numeric one, unestimated nodes weigh 0 and are named; issue counts otherwise.
   - B. Estimates only when every open node has a numeric one, issue counts otherwise.
   - C. Always the number of issues in the chain.
   - D. Both lengths in the result, and the command shows the estimate one first.

   Decision: A. It matches the unit velocity already reports, and naming the unestimated nodes keeps the 0 visible. B falls to counts on most real trackers, where some issues lack an estimate.

2. **What is the command called?** The name is user-facing and the CLI command follows it.
   - A. `/pmkit:issues:dependencies <id>`, CLI `issues dependencies <id>`.
   - B. `/pmkit:issues:blockers <id>`, CLI `issues blockers <id>`.
   - C. `/pmkit:report:dependencies <id>`, next to `/pmkit:report:status`.
   - D. `/pmkit:dependency-map <id>` at the top level, the catalog name.

   Decision: A. It takes an issue or an epic as `/pmkit:issues:summary` does, and "dependencies" covers both the chain and the hierarchy. B reads well for the Linear question but undersells the hierarchy. The top level holds only setup, help and upgrade.

3. **Does a parent issue wait for its open sub-issues in the critical path?**
   - A. No. The hierarchy sets the scope, and only blocker edges form chains.
   - B. Yes. Each open sub-issue is an edge into its parent, so a parent's path includes its slowest sub-issue chain.

   Decision: A. pmkit does not require sub-issues to finish before their parent, and a parent's estimate often already covers its sub-issues, so B would count the same work twice.

4. **Does the map also show what the target blocks?** "What is blocking X" looks upstream, but "who waits on X" is the other half of a dependency map.
   - A. Upstream only. `issues get` already shows the `blocks` field.
   - B. Upstream, plus the open issues outside the scope that the scope blocks directly, in a "waiting on this" list.
   - C. Upstream and the full downstream chain, with its own critical path.

   Decision: A for PMK-20. The acceptance criteria ask only for the blocker chain, and B adds a second list and a second set of tests. B, the "waiting on this" list, is a follow-up issue and out of scope here.

## Left to the builder

- The exact text layout of `issues dependencies`, within the parts listed under "CLI". The goldens record it.
- Whether the module walks parents with `walkParents` from `epics.mjs` or with its own helper, and where the topological sort lives.
- How the CLI tells `missing` from `unreadable`: from the IDs named in `searchIssues` problems, or another way the tracker already exposes.
- The wording of the command's answer line and of the table's extra column headers.

## Self-review

- Placeholders: none. Each **(builder's call)** above changes no criterion.
- Consistency: "open" means not `done` and not `canceled` in every section. The scope rule for an epic is the same as `epic progress`. The weight rule is the same as `metrics velocity`. The basis and its three reasons appear with the same names in the computation, the JSON, the text and the command.
- Scope: one pure module, one CLI read, one `SERVED_BY` change, one command file, the routing row, README, `CONTEXT.md` and the design spec. No contract, tracker file or format change.
- Builder check, done by reading the spec as the builder (no reviewer agent ran). Four points came up. Which issues form the scope of an issue target: the issue and its sub-issues, now under "Terms". Whether an archived blocker counts: yes, when it is open, now under "Decisions". What the map does with the conflicted fixture issue: a warning, under "Risks". Whether the query index refresh breaks criterion 4: no, under "What "writes nothing" means". Questions 1 and 3 decide which chain the command calls critical, so they went to the user, who chose A for both.
