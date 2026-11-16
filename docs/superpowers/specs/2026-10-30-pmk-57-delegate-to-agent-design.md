# PMK-57: delegate an issue to an agent

Epic: EPC-6 (Remaining generic commands). Sources: Unified model, Foundation catalog (`delegate-to-agent`, degradation "Assigns and comments with instructions for local execution"), and the Local adapter tab (`agent_delegation`: "`agent:<name>` assignee; the plugin itself runs the work locally"). The design spec already allows `agent:<name>` member ids. PMK-58 (track-agents) is blocked by this issue and reads what it writes.

## Intent

A user wants to hand an issue to an agent instead of a person, with instructions the agent can follow. The Local tracker has no agent runtime of its own, so delegating there means two things: the issue is assigned to an `agent:<name>` member, and a comment holds the instructions and says how to run the agent locally. The agent then runs in a session on the user's machine, through `/pmkit:issues:work`, and only when the user says so.

## Acceptance criteria

1. Assigns the issue to `agent:<name>` after confirmation.
2. Without native delegation it comments the instructions for local execution.

## Goals

- A CLI command `issues delegate <id> <agent>` that assigns the issue to the agent member and posts the delegation comment in one call, with `--dry-run`.
- A slash command `/pmkit:issues:delegate` that drafts the instructions, shows the write, always asks before it, and then offers to run the agent locally.
- A record that PMK-58 can read without parsing free text: the `agent:` assignee, the `assign` event, and a delegation comment with a fixed first line that `parseDelegation` reads.
- The `agent_delegation` capability becomes `derived` on the Local tracker, with `detail: { source: 'assignee', run: 'local' }`.

## Non-goals

- Native delegation on Linear (its `delegate` field for installed app agents). Linear answers `NOT_SUPPORTED` and the manifest says why.
- Starting an agent process from the CLI. The CLI never runs an agent.
- Listing delegated issues or their PR state. That is PMK-58.
- New issue fields or a new event op. The record uses what the store already has.

## Anti-goals

- An agent that starts, branches, pushes or opens a PR without the user saying yes.
- A delegation that `write_policy.confirm: none` lets through without a question.

## Decisions

These are my calls, made without a live user.

1. **Contract operation `delegate(id, agent, instructions, actor, { dryRun })`.** It is the first operation of the Agents family that the MVP spec lists as "not yet". It returns `{ before, after, comment, run }`, where `before` and `after` are the issue around the assignment, `comment` is the delegation comment and `run` says who runs the agent: `local` on the Local tracker, `native` for a future tracker that starts the agent itself. A contract operation, rather than an `assign` plus `comment` composed in the CLI, lets a hosted adapter replace both with its native call later without a CLI change, and lets Linear refuse before any write.
2. **Local behavior.** The agent must match `agent:[a-z0-9-]+` and be a member of `.issues/config.yaml`; otherwise `INVALID_INPUT` with the agent members, or with `/pmkit:setup` when there are none. The operation assigns the issue, then posts the comment, both in the same `now()`. When the issue already has that agent, the assignment changes nothing and the comment is still posted, so a second delegation carries new instructions. The dry run returns the same shape and writes nothing.
3. **The delegation comment.** `scripts/lib/delegation.mjs` builds and reads it:

   ```
   Delegated to agent:claude by fred, to run locally.

   ## Instructions

   <the instructions, or a default line that points to the description and the acceptance criteria>

   ## Run it locally

   This tracker does not start agents. To run this issue:

   1. Open a session of the agent in this repository.
   2. Run `/pmkit:issues:work ISS-1` and add `--as agent:claude` to every pmkit write, so the claim, the branch and the PR are recorded as the agent's.
   3. The work command asks before the plan, the branch, the PR and each tracker write. Nothing runs without those answers.
   ```

   `parseDelegation(body)` returns `{ agent, by, run }` for a body whose first line has that shape, and `null` otherwise. PMK-58 finds delegated issues by an `agent:` assignee, reads `parseDelegation` on their comments for who delegated and when, and reads the PR through the issue's `branch`.
4. **CLI `issues delegate <id> <agent> [--instructions-file f]`.** The file is optional; without it the comment carries the default line. JSON is the operation's result. Text is the assignee change from `writeText`, then `commented <comment id>`, then one line on how the agent runs. With `auto_commit` on, it commits as `pmkit: issues delegate <id>`.
5. **Capability.** `SERVED_BY.agent_delegation` gets `issues delegate`. The Local entry is `derived` with `detail: { source: 'assignee', run: 'local' }`, because the plugin derives delegation from an assignee and a comment. ADR 0001 is updated: 15 of 20 capabilities, four derived, five absent.
6. **Linear.** The workspace answer becomes `absent`, with `detail: { workspace: 'conditional', agents, unsupported: ['delegate'] }` and the hint `The Linear adapter does not delegate to agents yet; Linear offers it on this workspace`. `delegate` joins `STUB_CAPABILITY` under `agent_delegation`, so it answers `NOT_SUPPORTED` with that hint and sends no mutation. Linear refuses app users as assignees, so the Local fallback (assign plus comment) cannot run there either.
7. **The slash command `/pmkit:issues:delegate <id> [agent] [instructions]`.**
   - It checks `agent_delegation` first and stops with the hint when it is absent.
   - It resolves the agent among the `agent:` members of `discover`. It asks when several match and stops with `/pmkit:setup` when there is none.
   - It reads the issue with comments and lists the readiness problems (done or canceled, an open blocker, no acceptance criteria, assigned to another person). It asks once whether to continue.
   - It drafts the instructions from the user's text, the acceptance criteria and the comments, writes them to a temporary file outside `.issues/`, and runs the dry run.
   - It shows the assignee before and after and the full comment, and asks with `AskUserQuestion`. This question is always asked, even with `write_policy.confirm: none`, because it hands the issue to an agent and AC 1 says "after confirmation".
   - After the write, when `run` is `local`, it asks whether to run the agent now in this session or later. It never starts it without that answer. Now means the session follows `/pmkit:issues:work <id>` as the agent, with `--as <agent>` on every write, and every question of that command stays. Later means it shows the steps from the comment. When `run` is `native`, it says the tracker started the agent and skips the question.
8. **Docs.** README command list and CLI table, the routing table in `skills/pmkit/SKILL.md`, `scripts/plugin.test.mjs` `COMMANDS`, and one `CHANGELOG.md` line under `## Unreleased`. `commands/help.md` builds its list from the command files, so it does not change.

## Constraints

- PMK-44, PMK-59 and PMK-61 run in parallel and touch `capabilities.mjs`, the capability goldens, the README, the CHANGELOG, `commands/help.md` and `skills/pmkit/`. The changes there stay to one line or one entry each.
- The Local store is PMK-44's. `delegate` lives in `scripts/lib/local/tracker.mjs` and calls `assign` and `comment`; it does not touch the store or the views code.

## Test plan

- `scripts/delegation.test.mjs`: `delegationComment` and `parseDelegation` round-trip; a body without the first line parses to `null`.
- `scripts/contract-suite.mjs`: an `agents` family test. `setup()` may name `agent`, an agent member id; without one the test skips. It delegates, checks the assignee, the comment and `run`, and checks that a non-agent member is refused. The dry-run test covers `delegate` when the setup names an agent. The Local setup adds `agent:claude`; Linear does not list the family.
- `scripts/cli-delegate.test.mjs`: the CLI on a fixture copy with an agent member. The dry run writes nothing, the real run assigns and comments, a non-agent and an unknown member are refused, and `--instructions-file` lands in the comment.
- `scripts/capabilities.test.mjs`: `agent_delegation` is derived with its detail.
- `scripts/lib/linear/manifest.test.mjs` and `scripts/cli-degraded-coverage.test.mjs`: the Linear entry and the refusal with no mutation.
- Goldens: `issues delegate` gets a case. The fixtures have no agent member, so the goldens record the refusal, and the capability goldens change on the `agent_delegation` line.
