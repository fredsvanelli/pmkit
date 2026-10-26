# PMK-2 capability manifest implementation plan

> For agentic workers: use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to run this plan task by task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The Local tracker manifest reports a capability as `native` or `derived` only when a CLI command serves it. Every other capability is `absent` with an `enableHint`, and a test fails when the two disagree.

**Architecture:** `scripts/lib/capabilities.mjs` gets a `SERVED_BY` table (capability id to command names). `buildCapabilities` reads it. A guard test checks the table against `COMMANDS` in `scripts/pmkit.mjs`, so adapters never import the CLI. Spec: `docs/superpowers/specs/2026-10-25-pmk-2-capability-manifest-design.md`.

**Tech stack:** Node ESM, `node:test`, no dependencies (ADR-0003).

## Global Constraints

- Issue ID `PMK-2` in every commit message, for example `feat: serve the manifest from a command table (PMK-2)`. Every commit ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Code, specs, plans and commits in English. No new dependency.
- Do not edit `.issues/`, do not push, do not switch branch.
- `CAPABILITIES` keeps its 20 ids and its order. The manifest keeps one entry per id, each with a `path`.
- Expected counts: 10 native (`cycles`, `estimation`, `multilevel_hierarchy`, `dependencies`, `native_triage`, `deliverables`, `status_update`, `capacity`, `documents`, `time_tracking`), 2 derived (`native_metrics`, `linked_code`), 8 absent (`strategic_goals`, `releases`, `saved_views`, `demand_signals`, `request_queue`, `agent_delegation`, `security_alerts`, `user_inbox`).
- Command names in `SERVED_BY` are spelled exactly as `COMMANDS[].name` (for example `issues log-time`, `cycle add`).
- Absent entry shape: `{ id, path: 'absent', enableHint: 'No pmkit command serves <id> in the Local tracker yet' }`, with no `detail`.
- `linked_code` with `git_host: none` keeps its hint `Set git_host in .pmkit/config.yaml`. `estimation` keeps `detail: { unit, scale }`.
- Test commands: `node --test scripts/capabilities.test.mjs` while working, `npm test` before each commit.
- Prose follows the Unslop rules: no em dashes, plain words.

## Verification of the capability to command map

The spec asked for a check of `estimation`, `native_triage` and `agent_delegation` against `COMMANDS`. Result, no change to the spec:

- `estimation`: `issues create` and `issues update` both list the `estimate` flag and parse it against the configured scale.
- `native_triage`: `issues move` calls `moveToCategory`, which accepts any value of `CATEGORIES`, and `triage` is the first one. The template config has a `triage` status.
- `agent_delegation`: `issues assign` goes through `requireMember`, which rejects `agent:<name>`. No command serves it, so it is `absent`.

## File map

- Modify `scripts/lib/capabilities.mjs`: add `SERVED_BY`, `unservedCapabilities`, change `buildCapabilities`.
- Modify `scripts/capabilities.test.mjs`: new guard tests, updated count and detail tests.
- Modify `docs/adr/0001-local-tracker-is-the-reference-implementation.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`, `commands/help.md`.

---

### Task 1: Served-by table, builder and guard test

Complexity: hard
Covers: AC1 (native or derived only with a serving command), AC2 (absent with `enableHint`), AC3 (test fails when an unserved capability is native or derived)

**Files:** `scripts/lib/capabilities.mjs`, `scripts/capabilities.test.mjs`

- [ ] **Step 1: Write the failing tests.** In `scripts/capabilities.test.mjs`, import `COMMANDS` from `./pmkit.mjs` and `SERVED_BY`, `unservedCapabilities` from `./lib/capabilities.mjs`. Add:
  - `SERVED_BY` has exactly the ids of `CAPABILITIES`.
  - Every command name in `SERVED_BY` is in `COMMANDS.map((c) => c.name)`.
  - For each entry of the real manifest, `native` or `derived` implies a non-empty `SERVED_BY[id]`; `absent` implies an empty list and a non-empty `enableHint` and no `detail`.
  - `unservedCapabilities(manifest, SERVED_BY)` returns `[]` for the real manifest. For a copy of the manifest where the `strategic_goals` entry has `path: 'native'`, it returns `['strategic_goals']`.
  - Counts: 10 native, 2 derived (`native_metrics`, `linked_code`), 8 absent, listed by id.
  - Replace the old derived-detail test: keep `native_metrics` and `linked_code`, drop `agent_delegation`, `security_alerts`, `user_inbox`, and assert the absent hint text for `releases`.
- [ ] **Step 2: Run `node --test scripts/capabilities.test.mjs`.** Expect failures (missing exports, old counts).
- [ ] **Step 3: Implement.** In `scripts/lib/capabilities.mjs`:
  - Export `SERVED_BY` with the table from the spec (12 served ids, 8 empty arrays), keyed in `CAPABILITIES` order.
  - Export `unservedCapabilities(manifest, servedBy)`: ids whose `path` is not `absent` and whose `servedBy[id]` is missing or empty.
  - In `buildCapabilities`, drop the three removed derived entries, and return the absent shape for an id with an empty list. Order of checks: absent, `estimation`, derived, native.
- [ ] **Step 4: Run `node --test scripts/capabilities.test.mjs`, then `npm test`.** Expect green. `scripts/cli.test.mjs` ("lists 20 capabilities") and the contract suite still pass because every id keeps a `path`.
- [ ] **Step 5: Commit** `feat: report unserved capabilities as absent (PMK-2)`.

### Task 2: Docs follow the manifest

Complexity: mechanical
Covers: AC4 (ADR-0001 lists the capabilities served today)

**Files:** `docs/adr/0001-local-tracker-is-the-reference-implementation.md`, `docs/superpowers/specs/2026-10-23-pmkit-design.md`, `commands/help.md`

- [ ] **Step 1: ADR-0001.** Replace the sentence "serves all 20 capabilities ..." with the list served today: 10 native and 2 derived, each by id, and the 8 reported `absent`. Say the manifest never lists a capability without a command. Rewrite the third consequence: the Local tracker now has gaps, so tests against it exercise the `absent` path.
- [ ] **Step 2: Design spec, section "Capability manifest" (line 77).** Replace "The Local tracker serves all 20 ..." with the 10 / 2 / 8 split and a pointer to `2026-10-25-pmk-2-capability-manifest-design.md`.
- [ ] **Step 3: `commands/help.md` step 6.** For an absent capability, show the `enableHint` first, then say which trackers support it.
- [ ] **Step 4: Check.** `grep -rn "all 20" docs/adr docs/superpowers/specs/2026-10-23-pmkit-design.md commands` finds nothing. Run `npm test` (the plugin and changelog tests read these files).
- [ ] **Step 5: Commit** `docs: list the capabilities the Local tracker serves (PMK-2)`.

## Acceptance criteria coverage

| Criterion | Task |
|---|---|
| Native or derived only with a serving command | 1 |
| Absent with `enableHint` | 1 |
| Test fails on an unserved native or derived capability | 1 |
| ADR-0001 lists the capabilities served today | 2 |
