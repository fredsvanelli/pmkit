# PMK-2 design: the capability manifest reports only capabilities a command serves

Issue PMK-2, epic EPC-1. Status: approved by the author's own choice (autonomous brainstorm).

## Problem

`buildCapabilities` in `scripts/lib/capabilities.mjs` marks all 20 capabilities native or derived. Eight of them have no CLI command behind them: `strategic_goals`, `releases`, `saved_views`, `demand_signals`, `request_queue`, `security_alerts`, `user_inbox` and `agent_delegation`. The issue names the first seven. `agent_delegation` is the eighth: the manifest says the assignee can be `agent:<name>`, but `assign` calls `requireMember`, which rejects any name that is not in the config members. `/pmkit:help` and every command that reads the manifest therefore promise paths that do not exist.

## Approaches

1. **A served-by table in `capabilities.mjs`.** A constant maps each capability id to the CLI command names that serve it. `buildCapabilities` reports a capability with at least one command as native or derived, and any other as `absent` with an `enableHint`. A test checks every command name in the table against `COMMANDS` in `scripts/pmkit.mjs`.
2. **A `serves` field on each entry of `COMMANDS`.** The manifest derives from the command table, so it cannot drift. The tracker would have to import `pmkit.mjs`, which imports the tracker. That inverts the layering (adapters know nothing about the CLI) and a hosted adapter could not reuse the idea.
3. **Keep the hardcoded manifest and add only a test.** The test fails when someone lists an unserved capability. The manifest stays wrong until someone fixes it by hand, and nothing flips a capability to served when a command lands.

Recommended: approach 1. The manifest is computed from one table, the table is checked against the real command list by a test, and PMK-3 turns a capability on by adding a command name to one line.

## Design

### Served-by table

`scripts/lib/capabilities.mjs` exports `SERVED_BY`, an object from capability id to an array of command names exactly as `COMMANDS[].name` spells them. An empty array means no command serves the capability. Initial content:

| Capability | Path | Commands |
|---|---|---|
| `cycles` | native | `cycle list`, `cycle current`, `cycle issues`, `cycle open`, `cycle close`, `cycle add` |
| `estimation` | native | `issues create`, `issues update` (the `--estimate` flag) |
| `multilevel_hierarchy` | native | `issues parent`, `epic list` |
| `dependencies` | native | `issues link` |
| `native_triage` | native | `issues move` (category `triage`) |
| `deliverables` | native | `epic list`, `epic get`, `epic create`, `epic progress` |
| `status_update` | native | `epic update-status`, `epic updates` |
| `capacity` | native | `cycle capacity` |
| `native_metrics` | derived | `metrics velocity`, `metrics cycle-time`, `events` |
| `documents` | native | `docs read`, `docs create` |
| `time_tracking` | native | `issues log-time` |
| `linked_code` | derived | `issues branch`, `pr open`, `pr ready`, `pr status`, `pr sync` |
| `strategic_goals`, `releases`, `saved_views`, `demand_signals`, `request_queue`, `agent_delegation`, `security_alerts`, `user_inbox` | absent | none |

Result: 10 native, 2 derived, 8 absent.

### Manifest construction

`buildCapabilities` keeps the existing `estimation` detail and the `derived` detail map. For each id in `CAPABILITIES`:

- No serving command: `{ id, path: 'absent', enableHint }`. No `detail`.
- Otherwise: the current native or derived entry. The derived detail entries for the five capabilities that are now absent are removed, since an absent entry carries no detail.

The hint reads `No pmkit command serves <id> in the Local tracker yet`. The ids make the text specific, and a hosted adapter can pick a different hint for the same id. The existing `linked_code` hint for `git_host: none` stays.

Entries keep spec order, and every entry keeps a `path`, so consumers never check for a missing key.

### Guard test

`scripts/capabilities.test.mjs` imports `COMMANDS` from `scripts/pmkit.mjs`, `SERVED_BY` and `CAPABILITIES`, and checks:

1. `SERVED_BY` has exactly the ids in `CAPABILITIES`.
2. Every command name in `SERVED_BY` exists in `COMMANDS`, so a rename fails the test.
3. For each manifest entry, `native` or `derived` implies a non-empty list, and `absent` implies an empty list and a non-empty `enableHint`.
4. A negative case calls `buildCapabilities` with a table that lists a capability as native with no command and shows the check rejects it. The check is a small exported function, `unservedCapabilities(manifest, commandNames)`, which returns the offending ids. The test asserts it returns `[]` for the real manifest and the offending id for a doctored one.

The existing tests update: the count test expects 10 native, 2 derived and 8 absent, and the detail test drops the three removed entries.

### Docs

- ADR-0001: replace "serves all 20 capabilities" with the list served today (10 native, 2 derived, 8 reported `absent`), name the eight, and say the manifest never lists a capability without a command. Update the third consequence: the Local tracker now has gaps, so command tests against it do exercise the `absent` path.
- `docs/superpowers/specs/2026-10-23-pmkit-design.md`, "Capability manifest": fix the paragraph that says the Local tracker serves all 20, and point to this spec.
- `commands/help.md` step 6: for an absent capability, show the `enableHint` first, then say which trackers support it.

### Extension (PMK-3 and later)

A command that starts serving a capability adds its name to the `SERVED_BY` entry. The manifest flips to native or derived with no other change, and the guard test confirms the name exists. The derived detail map and `estimation` stay in `buildCapabilities`. If a capability is derived, it also needs a `derived` detail entry, and the test in item 3 does not check for it. A capability that moves from absent to native needs no detail.

## Decisions

| Decision | Reason |
|---|---|
| Use approach 1, a served-by table in `capabilities.mjs` | Keeps adapters independent of the CLI, makes the manifest follow the table, and PMK-3 changes one line. |
| Match commands by name strings and check them against `COMMANDS` in a test | The test catches renames and typos without an import cycle at runtime. |
| Report `agent_delegation` as `absent` too | `assign` rejects `agent:<name>` (`requireMember`), so no command serves it. Implementing agent assignees is out of scope. |
| Keep `linked_code` derived even with `git_host: none` | Branch creation works without a host, and the existing hint already tells the user how to enable pull requests. |
| Absent entries carry an `enableHint` and no `detail` | Matches the contract of AC2 and keeps `detail` meaning "how it works". |
| Do not implement milestones, goals, releases or any other missing command | PMK-3 follows on this branch. This issue only makes the manifest honest. |
| Edit ADR-0001 in place | AC4 asks for the list in the ADR, and the decision (the Local tracker is the reference) is unchanged. |
| Leave `.issues/` untouched | The pmkit CLI owns it. |

## Acceptance criteria map

| Criterion | Part of the design |
|---|---|
| Every capability marked native or derived is served by at least one CLI command | `SERVED_BY` table plus `buildCapabilities`, which emits native or derived only for a non-empty list |
| A capability without a command is reported `absent` with an `enableHint` | Manifest construction, absent branch |
| A test fails when a capability is native or derived and no CLI command serves it | Guard test, checks 1 to 4, including the doctored-manifest case |
| ADR-0001 lists the capabilities served today | Docs, ADR-0001 rewrite (10 native, 2 derived, 8 absent) |

## Self-review

- Placeholders: none.
- Consistency: 10 + 2 + 8 = 20, matching `CAPABILITIES.length`.
- Scope: one table, one builder change, one test file, two docs and one command file. No new command.
- Ambiguity: "served" means a command that reads or writes the capability's data, listed by exact `COMMANDS` name. The table above is the source of truth for the plan.
