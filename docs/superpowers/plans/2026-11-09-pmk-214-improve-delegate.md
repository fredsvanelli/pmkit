# PMK-214 Improve delegate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native delegation on Linear, an atomic Local delegation, an agent member in the `team` fixture, a work command that runs a delegated issue as its agent, and a contract suite that accepts `run: 'native'`.

**Architecture:** `delegate` stays one contract operation. Local folds the assignment and the comment into one `change()`. Linear posts the comment, then sets `delegateId`, after every check. The delegation comment and `parseDelegation` learn a native first line.

**Tech Stack:** Node ESM, `node:test`, the fake Linear API in `scripts/fake-linear-api.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-09-pmk-214-improve-delegate-design.md`

## Global Constraints

- Every commit message carries `(PMK-214)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Agent ids match `AGENT_ID` (`/^agent:[a-z0-9-]+$/`). On Linear: `agent:<Linear user id>`.
- Native first line: `Delegated to <agent> by <actor>, to run in the tracker.` Local first line unchanged: `Delegated to <agent> by <actor>, to run locally.`
- Linear no-agent hint: `Install an agent in this Linear workspace to delegate issues to it`.
- `npm test` exits 0 in the foreground before the PR.

## Review Focus

- A Local delegation whose comment write fails: the issue stays unassigned and no event is logged (Task 2 test).
- A Linear delegation to a human or unknown id: refused with `INVALID_INPUT` before any mutation (Task 3 test).
- A Linear delegate update that fails after the comment: the error names the comment and the missing delegate (Task 3 test).
- `issues track-agents` on Linear: refuses instead of reporting "no agent issues" (Task 4 test).
- A re-delegation to the same agent: only a comment, no assignee or delegate write (Tasks 2 and 3 tests).

---

### Task 1: Native delegation comment

**Files:** Modify `scripts/lib/delegation.mjs`; Test `scripts/delegation.test.mjs`

**Interfaces:**
- Produces: `delegationComment({ issue, agent, by, instructions, run = 'local' })`; `parseDelegation(body)` → `{ agent, by, run: 'local' | 'native' } | null`; `localRunLine(issue, agent)` → `the agent runs locally: /pmkit:issues:work ${issue} --as ${agent}`; `nativeRunLine(issue, agent)` → `the tracker runs the agent: ${agent} works on ${issue} there`.

- [ ] Test: `delegationComment({ issue: 'ACME-1', agent: 'agent:u-4', by: 'user-1', instructions: 'Do it.', run: 'native' })` starts with `Delegated to agent:u-4 by user-1, to run in the tracker.`, contains `## Instructions` and `Do it.`, not `Run it locally`; `parseDelegation` of it gives `run: 'native'`. The local comment's step 2 contains `/pmkit:issues:work ISS-1 --as agent:claude`.
- [ ] Run `node --test scripts/delegation.test.mjs`: FAIL.
- [ ] Implement. RECORD_LINE alternation `(locally|in the tracker)`.
- [ ] Run: PASS. Commit with Task 2.

### Task 2: Atomic Local delegate and the team fixture

**Files:** Modify `scripts/lib/local/tracker.mjs` (`delegate`), `scripts/__fixtures__/team/.issues/config.yaml`, `scripts/cli-delegate.test.mjs`, `scripts/__scenarios__/issues-delegate.mjs`, `scripts/golden-cases.mjs` comment, goldens.

- [ ] Test (cli-delegate): with `.issues/issues/ISS-5N1R/comments` replaced by a plain file, `issues delegate ISS-5N1R agent:claude` fails, the issue has no `agent:claude` assignee and `events.jsonl` is byte-identical. Test: a real delegation logs `assign` and `comment` with the same `at`.
- [ ] Run: FAIL on the first test (today the assign lands).
- [ ] Implement: one `change(id, actor, { dryRun }, edit)` when the assignee changes, edit writes the comment file (not on dry run) and returns `[assignEvent, commentEvent]`; a `try/catch` around it removes the comment file when the change throws. When the assignee already is the agent, call `comment()` as today.
- [ ] Fixture: add `agent:claude: { name: Claude, availability: 1 }` under `members` of the `team` fixture. `setup({ agent: false })` in cli-delegate removes the line; the scenario drops its setup.
- [ ] `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs scripts/scenarios.test.mjs`, read the diff (team `issues-delegate` now shows the delegation; member lists gain Claude), run the whole suite.
- [ ] Commit `feat(delegate): atomic local delegation and an agent in the team fixture (PMK-214)`.

### Task 3: Linear native delegation

**Files:** Modify `scripts/lib/linear/documents.mjs` (issue fragment `delegate { id }`), `issues.mjs` (`toIssue`), `writes.mjs` (`applyInput` handles `delegateId`), `issue-ops.mjs` (new `delegate` using `history.comment`), `tracker.mjs` (wire, drop from `STUB_CAPABILITY`), `discovery.mjs` (`agents[].id` = `agent:<id>`), `manifest.mjs`; `scripts/fake-linear-api.mjs` (`delegateId` in `UPDATE_FIELDS`, record, node, refuse a non-app user); tests in `scripts/lib/linear/tracker.test.mjs`, `manifest.test.mjs`, `discovery.test.mjs`.

**Interfaces:** `delegate(id, agent, instructions, actor, { dryRun })` → `{ before, after, comment, run: 'native' }`; `after.delegate === agent`.

- [ ] Tests over the fake: delegate `ACME-1` to `agent:user-4` → `run: 'native'`, `after.delegate`, mutations in order `PmkitCommentCreate`, `PmkitIssueUpdate` with `delegateId: 'user-4'`; dry run sends none; `user-2` and `agent:user-2` (a human) and `agent:nobody` → `INVALID_INPUT` with no mutation; same agent again → one comment mutation only; a failing update → `UPSTREAM` whose message names the comment id and `details.missing` is `['delegate']`; a workspace without app users → `NOT_SUPPORTED` with the hint. Manifest: `native` with `run: 'native'`, `unsupported: ['issues track-agents']`, and `absent` with the hint when no app user.
- [ ] Run: FAIL. Implement. Run: PASS.
- [ ] Commit `feat(linear): delegate natively through Linear's delegate field (PMK-214)`.

### Task 4: Contract suite, track-agents refusal

**Files:** `scripts/contract-suite.mjs`, `scripts/lib/linear/contract.test.mjs`, `scripts/pmkit.mjs` (`runTrackAgents`), `scripts/cli-track-agents.test.mjs` or a Linear test.

- [ ] Contract: `assert.ok(['local', 'native'].includes(first.run))`; the holder is `assignee` for local and `delegate` for native; `parseDelegation` gives `run: first.run`. Linear run adds `'agents'` with `agent: 'agent:user-4'`.
- [ ] `runTrackAgents` refuses with `NOT_SUPPORTED` when the entry's `detail.unsupported` lists `issues track-agents`; test it.
- [ ] Commit `test(contract): accept native delegation in the agents family (PMK-214)`.

### Task 5: Commands and docs

**Files:** `commands/issues/work.md` (optional `--as <agent>`: steps 3, 5, and "every pmkit write carries `--as`"; without `--as`, an agent assignee or a `delegate` is a readiness problem), `commands/issues/delegate.md` (steps 1, 2, 7, "If something is missing"), `skills/pmkit/SKILL.md` if it mentions Linear delegation, `README.md` if so, `docs/adr/0005-...md`, `CHANGELOG.md` (`## Unreleased`, top).

- [ ] Edit, then run the scenarios (`node --test scripts/scenarios.test.mjs`) and `scripts/plugin.test.mjs`.
- [ ] Commit `docs(delegate): work --as and native delegation on Linear (PMK-214)`.

### Task 6: Verify and deliver

- [ ] `npm test` in the foreground, exit 0.
- [ ] Check criteria 1-5 with `issues update PMK-214 --check <n>` (dry run, then real), commit `.issues/`.
