# PMK-57 delegate-to-agent implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `delegate` contract operation, the `issues delegate` CLI command and the `/pmkit:issues:delegate` slash command, so an issue can be handed to an `agent:<name>` member with instructions for local execution.

**Architecture:** `scripts/lib/delegation.mjs` builds and parses the delegation comment. The Local tracker's `delegate` calls its own `assign` and `comment`. Linear refuses through `STUB_CAPABILITY`. The CLI command wraps the operation, and the slash command adds the confirmation and the local run.

**Tech Stack:** Node.js ESM, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-pmk-57-delegate-to-agent-design.md`

## Global constraints

- Every commit message carries `(PMK-57)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Agent ids match `^agent:[a-z0-9-]+$`.
- The comment's first line is exactly `Delegated to <agent> by <actor>, to run locally.`
- Local manifest entry: `{ id: 'agent_delegation', path: 'derived', detail: { source: 'assignee', run: 'local' } }`.
- Linear entry: `path: 'absent'`, `detail: { workspace: 'conditional', agents, unsupported: ['delegate'] }`, `enableHint: 'The Linear adapter does not delegate to agents yet; Linear offers it on this workspace'`.
- Changes to `capabilities.mjs`, the goldens, README, CHANGELOG and `skills/pmkit/SKILL.md` stay to one line or one entry each. Do not touch `scripts/lib/local/store.mjs`.

## Review focus

- An agent id that is a person (`fred`): refused with `INVALID_INPUT`, nothing written. Test in Task 2.
- An `agent:` id that is not a member: refused, nothing written. Test in Task 2.
- Delegating twice to the same agent: no assignee change, a second comment. Test in Task 2.
- An empty or whitespace instructions file: the default line is used, no empty section. Test in Task 1.
- Linear: no mutation sent. Test in Task 3.

---

### Task 1: the delegation comment

**Files:**
- Create: `scripts/lib/delegation.mjs`
- Test: `scripts/delegation.test.mjs`

**Interfaces:**
- Produces: `AGENT_ID` (RegExp `^agent:[a-z0-9-]+$`), `delegationComment({ issue, agent, by, instructions }) -> string`, `parseDelegation(body) -> { agent, by, run } | null`, `localRunLine(issue, agent) -> string`.

- [ ] **Step 1: Write the failing tests** `delegationComment starts with the record line and holds the instructions and the local steps`: first line `Delegated to agent:claude by fred, to run locally.`, contains `## Instructions`, the trimmed instructions, `## Run it locally` and `` `/pmkit:issues:work ISS-1` `` and `` `--as agent:claude` ``. `blank instructions fall back to the default line`: `instructions: '  \n'` gives `Work on ISS-1 as its description and acceptance criteria say.` `parseDelegation reads the first line`: round-trip gives `{ agent: 'agent:claude', by: 'fred', run: 'local' }`; `parseDelegation('Looks good.')` and `parseDelegation(undefined)` are `null`. `AGENT_ID` accepts `agent:claude` and rejects `fred`, `agent:`, `agent:Claude`.
- [ ] **Step 2: Run** `node --test scripts/delegation.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** with the comment text of spec decision 3.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(issues): build and read the delegation comment (PMK-57)`.

### Task 2: the `delegate` contract operation on Local

**Files:**
- Modify: `scripts/lib/contract.mjs` (`'delegate'` after `'archive'` in `TRACKER_OPERATIONS`)
- Modify: `scripts/lib/local/tracker.mjs` (new `delegate`, exported)
- Modify: `scripts/lib/linear/tracker.mjs` (stub, so `assertTracker` passes; Task 3 adds its message)
- Modify: `scripts/contract-suite.mjs` (family `agents`; `setup()` may return `agent`)
- Modify: `scripts/contract.test.mjs` (Local setup adds `agent:claude` to the fixture copy's members and returns `agent: 'agent:claude'`)

**Interfaces:**
- Consumes: Task 1.
- Produces: `tracker.delegate(id, agent, instructions, actor, { dryRun }) -> { before, after, comment, run: 'local' }`.

- [ ] **Step 1: Write the failing contract test** `delegates an issue to an agent with a comment` (needs `agents`, skips with `t.skip('needs an agent member')` when the setup names none): creates an issue, `delegate(id, agent, 'Do it.', actor)`; `after.assignee === agent`; `run === 'local'`; `parseDelegation(comment.body).agent === agent`; `listComments(id)` holds the comment; a second delegate leaves `before.assignee === after.assignee` and adds a second comment; `delegate(id, actor, 'x', actor)` rejects `INVALID_INPUT`; `delegate(id, 'agent:nobody', 'x', actor)` rejects `INVALID_INPUT`. Add `() => tracker.delegate(a, agent, 'Never', actor, dry)` to the dry-run writes when `agent` is set.
- [ ] **Step 2: Run** `node --test scripts/contract.test.mjs`. Expected: FAIL, missing operation `delegate`.
- [ ] **Step 3: Implement.** Local: `requireWriter(actor)`; `AGENT_ID` test, else `invalid('"<x>" is not an agent: an agent member id starts with agent:', <agent members or /pmkit:setup>)`; `requireMember(agent, 'agent')`; `assign`, then `comment(id, delegationComment(...), actor, { dryRun })`. Linear: `delegate: stub('delegate')`.
- [ ] **Step 4: Run** `node --test scripts/contract.test.mjs scripts/lib/linear/contract.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tracker): delegate an issue to an agent member (PMK-57)`.

### Task 3: Linear refuses and the manifest says why

**Files:**
- Modify: `scripts/lib/linear/manifest.mjs`, `scripts/lib/linear/manifest.test.mjs`
- Modify: `scripts/lib/linear/tracker.mjs` (`STUB_CAPABILITY.delegate = 'agent_delegation'`; message is the `enableHint` for every non-releases capability)
- Modify: `scripts/lib/linear/tracker.test.mjs`

- [ ] **Step 1: Write the failing tests.** Manifest: `entry.agent_delegation` deep-equals the Global constraints entry with `agents: ['Linear']`. Tracker: `delegate` rejects `NOT_SUPPORTED` with that hint as message and sends no mutation.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/manifest.test.mjs scripts/lib/linear/tracker.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the answer in `workspaceAnswers` and the stub message.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(linear): refuse delegate and say why in the manifest (PMK-57)`.

### Task 4: the `issues delegate` CLI command and the capability

**Files:**
- Modify: `scripts/pmkit.mjs` (command after `issues assign`)
- Modify: `scripts/lib/capabilities.mjs` (`agent_delegation: ['issues delegate']`, derived detail)
- Modify: `scripts/capabilities.test.mjs`, `scripts/golden-cases.mjs`, the four `capabilities.txt` goldens and new `issues-delegate.txt` goldens
- Modify: `scripts/cli-degraded-coverage.test.mjs` (REFUSALS and COVERED)
- Modify: `docs/adr/0001-local-tracker-is-the-reference-implementation.md`
- Create: `scripts/cli-delegate.test.mjs`, `scripts/__goldens__/_inputs/instructions.md`

**Interfaces:**
- Consumes: Task 2, `localRunLine` from Task 1.
- Produces: `pmkit issues delegate <id> <agent> [--instructions-file f]`, write, JSON = operation result.

- [ ] **Step 1: Write the failing tests** in `cli-delegate.test.mjs` on a `team` copy with `agent:claude` added: `--dry-run --json` returns `after.assignee === 'agent:claude'` and leaves `hashTree` unchanged; the real run writes the assignee and one comment whose body holds the file text; text output contains `commented` and `/pmkit:issues:work`; `fred` and `agent:nobody` exit 2 with `INVALID_INPUT`. Capabilities test: derived list is `['native_metrics', 'linked_code', 'agent_delegation', 'security_alerts']`, detail as in Global constraints. Degraded coverage: `['issues', 'delegate', 'ACME-1', 'agent:claude']` in REFUSALS.
- [ ] **Step 2: Run** `node --test scripts/cli-delegate.test.mjs scripts/capabilities.test.mjs scripts/cli-degraded-coverage.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the command, the capability entry, the golden case `[[a.issue, 'agent:claude', '--instructions-file', input('instructions.md')]]`, and the ADR count (15 served, four derived, five absent).
- [ ] **Step 4: Regenerate goldens** with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, review the diff (only `agent_delegation` lines and new delegate files), then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(issues): add issues delegate and serve agent_delegation (PMK-57)`.

### Task 5: the slash command and the docs

**Files:**
- Create: `commands/issues/delegate.md`
- Modify: `scripts/plugin.test.mjs` (`'delegate'` in `COMMANDS.issues`; a test that step 5 previews with `--dry-run`, step 6 writes without it, and both the delegation and the local-run steps use `AskUserQuestion`)
- Modify: `skills/pmkit/SKILL.md`, `README.md` (command list and CLI table), `CHANGELOG.md` (top of `## Unreleased`)

- [ ] **Step 1: Write the failing plugin tests.**
- [ ] **Step 2: Run** `node --test scripts/plugin.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write** the command with the six sections and the flow of spec decision 7, and the doc lines.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(issues): add /pmkit:issues:delegate (PMK-57)`.
