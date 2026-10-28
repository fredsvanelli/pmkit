# PMK-34 design: ask for the mappings a hosted tracker cannot infer

Issue PMK-34, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: the user answered the four open questions on 2026-10-27, and the design applies the answers. Decisions come from an autonomous brainstorming run on 2026-10-27 with no user dialogue, from the issue, ADR-0002, ADR-0003, ADR-0005, the PMK-31 and PMK-33 specs, the code, and read-only calls to the sandbox workspace. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

pmkit can read a Linear workspace (PMK-33), but nothing writes a Linear config. `init --tracker` accepts `local` only, and `/pmkit:setup` has no Linear branch. Linear also lacks two things every command reasons with: a status category for "in review" and a notion of "blocked" as a status. Linear has no issue type field either, so PMK-33 left `types` empty for this issue. A wrong guess at any of these corrupts metrics and status moves without a word, and a name that later disappears from Linear does the same.

Sources:

- Unified model, Q6 decision C: infer the unambiguous, ask the ambiguous, approve one summary, store in the repo file. "Re-asked only when it breaks: if a mapped status or field disappears, the skill stops and asks instead of guessing."
- Unified model, Q5 decision A: the example `.pmkit/config.yaml` with `scope.team`, `mappings.status.in_review`, `mappings.status.blocked` and `mappings.fields.estimate: native`.
- Unified model, "Common status categories" (Linear column: "In review: mapped Started state"; "Blocked is not a category: it is a derived state") and "Common entity model" (Linear issue type: "Label or template").
- MVP skills, `setup`: "Ask only what can't be inferred (Q6)"; "Show a one-screen summary for approval".
- Linear tab, "Setup and context": "Authenticates, discovers teams, states by category, labels, members and estimate scales".
- PMK-33 spec, "What PMK-34 gets".

Acceptance criteria:

1. Setup applies unambiguous mappings by itself: native state categories, single-candidate fields, tier, plan and version, the default scope when the user is in one team.
2. Setup always asks which status means in review and blocked, the estimate field when there are several candidates, and the default scope when the user is in several teams.
3. One summary is approved at the end, and the mappings go to `.pmkit/config.yaml`.
4. When a mapped status or field disappears, the command stops and asks.

## Facts checked against the sandbox

One read-only query on 2026-10-27 against the sandbox workspace (Free plan): `viewer { teams }`, `teams { issueEstimationType states }` and `issueLabels`. No write was sent.

- One team, and the viewer belongs to it.
- Estimates are off (`notUsed`).
- Ten states. Five are `started`, in this position order: In Progress, UAT, Ready to ship, Code Review, In Review. No state name contains "block".
- Two team label groups: a size group whose children are XS, S, M, L and XL, and a difficulty group with three children. No label is named after a pmkit type.

One consequence shapes the rules below: "Code Review" comes before "In Review" by position, so a rule that recommends the first name containing "review" picks the wrong one. The rule prefers the exact name first.

## Goals

- `/pmkit:setup` can set up a Linear repository from scratch and bring an existing Linear config up to date.
- One CLI call computes what setup infers and what it must ask, so the inference lives in code, not in prose (ADR-0002).
- The written mappings have one documented shape that PMK-35 can read with a helper, without reading `mappings` itself.
- Every Linear operation other than `discover` and `capabilities` refuses to run on a mapping that names something the workspace no longer has, and every command reacts to that refusal the same way.

## Non-goals

- Issue, relation and search operations (PMK-35). This issue defines how they read the mappings, not the operations.
- Creating anything in Linear, such as an "In Review" state or the `needs-criteria` label. Setup sends queries only.
- Switching an existing repository from the Local tracker to Linear (PMK-41, `local-migrate`).
- `link-repo` (PMK-53) and triage rotation (PMK-43).
- Mappings for Jira, GitHub, GitLab or Azure DevOps. The generic part is shaped for them, and only Linear feeds it.

## Anti-goals

- `npm test` opening a socket. Every test injects `fakeLinearFetch`.
- A new dependency (ADR-0003).
- A change to any Local tracker output. Every golden stays byte-identical, and the Local setup scenarios keep their calls.
- The key in output, in `.pmkit/config.yaml`, in an error or on a command line (ADR-0005).
- The real workspace URL key or team key in any file. Examples use `acme` and `ACME`.

## Approaches

### Where the inference lives and how answers reach the file

A. **Setup infers in prose.** `/pmkit:setup` reads `discover --json`, applies the rules described in Markdown, and writes the file with a generic config writer. ADR-0002 rules this out: commands never compute, and each agent would apply the rules its own way.

B. **`init --tracker linear` computes a proposal in its dry run and takes the answers as flags.** The dry run returns what it applied, what it must ask (with candidates and a recommendation) and what is broken. Setup asks, passes the answers as `--team`, `--status` and `--field`, shows one summary from the last dry run, and runs the same command without `--dry-run`. One write, after one approval. `--update` does the same on an existing Linear config.

C. **A separate `mappings` command beside `init`.** `pmkit mappings --json` proposes and `pmkit mappings set` writes, and `init --tracker linear` writes only the tracker block. The first run then needs two writes, or a config that names Linear with no team between them. A tracker cannot be created before the config exists, so `mappings` would need the same in-memory draft as B anyway.

Chosen: B. It follows the pattern of the Local first run (dry run, summary, the same command as a write), keeps one write per approval, and puts every rule in code that tests can reach.

### What goes into the file

1. **The answers, the scope and the inferred field roles.** `tracker.scope.workspace`, `tracker.scope.team`, `mappings.status.in_review`, `mappings.status.blocked`, `mappings.fields.estimate` when it has a value, and `mappings.types`. Native state categories stay computed from each state's type on every read.
2. **Every mapping, inferred ones included.** A line per category, naming the state that category moves to. The file then repeats what Linear already says, and a renamed state breaks a mapping nobody chose.

Chosen: 1. It is the shape of the Q5 example, and only the names a person chose or that a check can verify go in the file.

### How "answered, nothing" is recorded

A team with no review status or no blocked status still needs an answer, or every later setup run asks again. Leaving the key out cannot tell "never asked" from "answered with nothing". Chosen: the reserved value `none`, as `native` is already reserved in `mappings.fields`. Setup refuses to map to a Linear state literally named `none` **(builder's call)**.

`mappings.types` has no `none` value, because a type without a label is left out of the object. The key as a whole carries the answer: `types` absent means setup never asked, and `types: {}` or a partial object means the user answered. A type the user answered with nothing stays out, and later runs do not ask for it again. Setup asks only for the pmkit types in the repository's `types` list that the object lacks while `types` is absent, and for a type whose label broke.

## Design

### Files

| File | Change |
|---|---|
| `scripts/lib/mappings.mjs` | New. The generic rules: `proposeMappings(description, current, answers)`, `brokenMappings(description, pmkit)`, `parseMappingFlags(ctx)` and `NONE`. No Linear name appears in it. |
| `scripts/lib/linear/mappings.mjs` | New. `linearDescription(raw, view, viewerId)` turns PMK-33's discovery into the generic description. `resolveMappings(view, pmkit)` is the reader PMK-35 uses. |
| `scripts/lib/linear/discovery.mjs` | `discoveryView` skips `none` values, fills `types` with the keys of `mappings.types`, and leaves the mapped labels out of `labels`. |
| `scripts/lib/linear/manifest.mjs` | `estimation` is `absent` with the hint `mappings.fields.estimate is none in .pmkit/config.yaml` when the estimate is mapped to `none`. An absent key means `none` here too: when the configured team uses estimates and the file has no `mappings.fields.estimate`, `estimation` is `absent` with the hint `Run /pmkit:setup to set mappings.fields.estimate in .pmkit/config.yaml`. With no configured team, the manifest describes the workspace, as PMK-33 built it. |
| `scripts/lib/linear/tracker.mjs` | The mapping check before every operation except `discover` and `capabilities`. |
| `scripts/lib/linear/adapter.mjs` | `configProblems` adds the offline Linear rules on `mappings.fields`. The descriptor gains `describe(raw, view, viewerId)`, which calls `linearDescription`. |
| `schemas/pmkit.config.schema.json` | See "Schema changes". |
| `scripts/lib/yaml-edit.mjs` | `setScalar` creates missing parent maps, so `--update` can add `mappings.status.blocked` to a file with no `mappings` block. |
| `scripts/pmkit.mjs` | `init` gains `--tracker linear`, `--workspace`, `--team`, `--status`, `--field` and `--type-label`, and a hosted branch. A JSON error whose details hold `mappings` prints that list. |
| `commands/setup.md` | The tracker question in step 1, "Linear first run", "Existing Linear config", their confirmation points and the missing-key case. |
| `skills/pmkit/references/conventions.md` | One rule for a broken mapping. |
| `CONTEXT.md` | The term **Mapping**. |
| `CHANGELOG.md` | One entry. |
| `scripts/scenario-helpers.mjs` | A scenario option `linear` that runs the CLI in process with a fake Linear adapter. |
| `scripts/__scenarios__/setup.mjs` and snapshots | Entries 0 and 1 gain the tracker answer. New entries 2 and 3 cover the Linear paths. |
| Tests | See "Testing". |

### Schema changes

- `mappings` gains `types`, the only schema change of this wave, owned by this issue: an object from a pmkit type name to one label name of the tracker, such as `{ bug: Bug, feature: Feature }`. Every value is a non-empty string. A type without a label is left out. PMK-35 reads it through `resolveMappings`.
- The description of `mappings.fields` says: "A field role to the tracker's field name, native for the tracker's own field, or none for no field."
- The descriptions of `mappings.status` and its values say that `none` means "this team has no such status".
- Nothing else. `tracker.scope.team` already passes through `additionalProperties`, and one status name per key is enough for the questions this issue asks.

`validatePmkitConfig` in `scripts/lib/config.mjs` gets a matching check: `mappings.types` must be a map whose values are non-empty strings. The parity test in `schemas.test.mjs` needs a row for `mappings.types`.

### The mappings contract

This is the shape PMK-35, PMK-37, PMK-38 and PMK-43 read. A key that is absent means the same as `none` for every reader. Setup treats an absent key as a question and `none` as an answer.

```yaml
tracker:
  system: linear
  scope:
    workspace: acme          # organization.urlKey; PMK-30's pin checks it on each run
    team: ACME               # Linear team key; every operation but discover and capabilities needs it
mappings:
  status:
    in_review: In Review     # a state of the team, or none
    blocked: none            # a state of the team, or none
  fields:
    estimate: native         # native or none; absent when the team has estimates off
  types:
    bug: Bug                 # a label of the team or the workspace; a type with no label is left out
    feature: Feature
```

Reading rules. Names compare exactly, with Linear's case.

1. **Category of a state.** When `mappings.status.<category>` names the state, the state takes that category. Otherwise its type decides, as PMK-33 maps it. `blocked` and `none` never change a category.
2. **Target of `move_to_category(c)`.** The state that `mappings.status.c` names, when set and not `none`. Otherwise the first state of the team by `position` whose category is `c`. With no such state, the move fails with `NOT_SUPPORTED`, `team ACME has no status in the in_review category`, next step `/pmkit:setup`.
3. **Blocked.** An issue is blocked when one of its blockers is open, as today, or when its state is the one `mappings.status.blocked` names. The state keeps the category of its type, so a blocked issue in a `started` state still counts as `in_progress`.
4. **Estimate.** `native` reads and writes `Issue.estimate` with the team's scale from discovery. `none`, an absent key, or a team with estimates off gives `estimate: null` on every issue.
5. **Type.** The type of an issue is the pmkit type whose mapped label the issue carries. When an issue carries labels of two types, the type that comes first in `mappings.types` wins. Setup writes that object in the order of the repository's `types` list. Setting a type adds the mapped label and removes the labels of the other mapped types. A team label wins over a workspace label with the same name. With no `mappings.types`, `types` is `[]` and every issue has `type: null`.
6. **Other categories.** A hand-written `mappings.status.<category>` for any other category follows rule 1. Setup does not ask for them until one breaks.

`resolveMappings(view, pmkit)` in `scripts/lib/linear/mappings.mjs` returns the result of these rules for the configured team, so PMK-35 never reads `mappings` itself:

```js
{
  team: 'ACME',
  categoryOf: (stateName) => 'in_review',     // rule 1
  targetState: (category) => ({ id, name }),  // rule 2, null when the team has none
  blockedState: { id, name } | null,          // rule 3
  estimate: 'native' | null,                  // rule 4
  types: { bug: { id, name } },               // rule 5, only the types with a label
  typeOf: (labelNames) => 'bug' | null,       // rule 5
}
```

The name, the arguments and this return shape are the contract with PMK-35. A change to them needs a note in PMK-35's spec and the changelog.

`resolveMappings` needs the Linear ids of states and labels, which `discoveryView` does not return today. It reads them from the raw discovery that the tracker already holds, so `discoveryView` keeps its output and attaches the raw discovery to the view as a hidden property (`view.raw`, not enumerable, so it never reaches JSON). `resolveMappings(view, pmkit)` reads the ids from it, and takes the raw discovery as an optional third argument for a view that was copied **(builder's call, made while building)**.

### The generic description

`proposeMappings` and `brokenMappings` read an adapter-neutral description. The Linear descriptor's `describe` builds it from PMK-33's raw discovery, its view and the viewer's id:

```js
{
  workspace: { urlKey: 'acme', name: 'Acme', plan: 'free' },
  viewerTeams: ['ACME'],
  teams: [{
    key: 'ACME', name: 'Acme',
    statuses: [{ name: 'In Progress', category: 'in_progress', type: 'started', position: 2 }, ...],
    candidates: {
      'mappings.status.in_review': ['In Review', 'In Progress', 'UAT', 'Ready to ship', 'Code Review'],
      'mappings.status.blocked': [...],
      'mappings.fields.estimate': [],          // ['native'] when the team uses estimates
      'mappings.types.bug': ['Bug', 'Improvement', 'Difficulty'],   // one entry per pmkit type
    },
    recommended: { 'mappings.status.in_review': 'In Review', 'mappings.status.blocked': 'none', ... },
    exists: (path, value) => boolean,          // for brokenMappings
  }],
}
```

`candidates` lists the recommended value first and then the rest in Linear's position order. The Linear rules for each key:

| Key | Candidates | Recommended |
|---|---|---|
| `tracker.scope.team` | The viewer's teams. When the viewer is in no team, every team. | None. |
| `mappings.status.in_review` | The team's `started` states. Empty when the team has only one, because mapping it would leave `in_progress` with no status. | The state named "In Review", ignoring case. Else the first by position whose name contains "review". Else `none`. |
| `mappings.status.blocked` | The team's states in `backlog`, `todo` and `in_progress`. A state already given for in review fails with `INVALID_INPUT`. | The first by position whose name contains "block", ignoring case. Else `none`. |
| `mappings.fields.estimate` | `native` when the team's estimation type is not `notUsed`. Else empty. Size label groups do not join: native is the only estimate on Linear, and groups are a follow-up. | The only candidate. |
| `mappings.types.<type>` | The labels of the team and the workspace that are not groups, team first, then by name. A label another type already took is left out. | The label whose name equals the pmkit type, ignoring case. Else `none`, which leaves the type out of the file. |
| `mappings.status.<category>` for any other category | Every state of the team, by position. Setup reads them only for a hand-written key that broke. | `none`. |

### The inference rule

`proposeMappings(description, current, answers)` walks the keys in this order: `tracker.scope.workspace`, `tracker.scope.team`, then, once the team is known, `mappings.status.in_review`, `mappings.status.blocked`, `mappings.fields.estimate` and one `mappings.types.<type>` for each type of the repository's `types` list. `current` is the mappings already in the file (empty on a first run) and `answers` is what the flags gave. For each key, the first rule that matches wins:

1. **An answer.** A flag gave a value. It must be a candidate, `none`, or for the team any team key of the workspace. Otherwise the call fails with `INVALID_INPUT`, `--status in_review=Review is not a status of team ACME`, next step `Pass one of: In Review, In Progress, UAT, Ready to ship, Code Review, or none`.
2. **Kept.** The file holds a value and `brokenMappings` does not list it. Nothing is asked again (Q6, "re-asked only when it breaks").
3. **Broken.** The file holds a value that the workspace no longer has. The key becomes a question with `broken: { was, problem }`. This holds for every key the file sets, including a hand-written status, field or type that setup never asks for, so every item of `broken` is also a question and setup can repair it. The question for a hand-written key takes its candidates from the description, or offers only `none` when the description has none for that path, and its flag accepts that key. `init` passes the types the file maps by hand to `describe` after the repository's `types` list, so their labels are candidates.
4. **Always asked.** `mappings.status.in_review` and `mappings.status.blocked` become questions, even with one candidate or none. A key with no candidate offers only `none`.
5. **Applied.** The workspace from the key's organization. The team when the viewer is in exactly one. A field with exactly one candidate. These go to `applied` with a reason and into the file.
6. **Asked.** A field or the team with two or more candidates. Every `mappings.types.<type>`, while `mappings.types` is absent from the file, with the recommended label first and `none` as the last option.
7. **Nothing.** A field with no candidate is neither asked nor written. The summary says why, for example "team ACME has estimates off; turn them on in the team's settings in Linear and run setup again".

Rule 5 answers criterion 1 for the scope and the fields. The plan, the tier and the version are not mappings and never reach the file. The plan comes from discovery and shapes the manifest, and Linear has no tier or version. Native categories come from the state types on every read, and the proposal lists them so the summary can show them.

### The `init` call for Linear

```
init --tracker linear [--git-host github|none] [--workspace <key>] [--team <KEY>]
     [--status in_review=<name|none>] [--status blocked=<name|none>]
     [--field estimate=<native|none>] [--type-label <type>=<label|none>] [--update] [--dry-run]
```

- `--status`, `--field` and `--type-label` repeat, and each takes `<key>=<value>`. The value runs to the end of the argument, so `--status "in_review=In Review"` keeps the space.
- With `--tracker linear`, `init` refuses `--prefix`, `--id-style`, `--estimate-unit`, `--label`, `--member`, `--name`, `--email` and `--members-file` with `INVALID_INPUT`, `Linear sets <flag> itself`, next step `Remove <flag>`.
- On a first run, `.pmkit/config.yaml` must not exist (`CONFLICT`, as for Local). `init` writes only that file and no `.issues/` folder.
- `--update` reads `tracker.system` from the file. With `linear` it takes the hosted branch and refuses `--tracker` with another value (`NOT_SUPPORTED`, `setup cannot switch trackers`, next step `Keep tracker.system as it is`). A Local config with `--tracker linear` gets the same refusal.
- `init` builds a draft config in memory from the file (on `--update`) or from the template (on a first run), applies the flags, creates the tracker with `adapterFor('linear').create(draft, { env, now })`, and calls `discover({ refresh: true })`. A missing key fails with `AUTH` before any request, as PMK-33 built. The client's workspace pin checks `--workspace` or the file's workspace, so a key from another workspace fails with `AUTH`.
- `init` writes the default git host block with the system and the repo only, without `default_branch`, which the code reads as `main` when it is absent **(builder's call)**.
- `init` always refreshes, as `discover` does. Setup is the moment the user fixes things, and a stale cache would hide the change they just made in Linear **(builder's call)**.
- A write (no `--dry-run`) refuses while the proposal still has questions: `INVALID_INPUT`, `setup has unanswered questions: mappings.status.in_review, mappings.status.blocked`, next step `/pmkit:setup`. This makes criterion 2 hold for any caller, not only for setup.
- The final text passes `validatePmkitConfig` and the Linear `configProblems` before anything is written, as Local's `pmkitConfigRefusal` does today.

The result, for a dry run and for a write:

```js
{
  dryRun: true,
  tracker: 'linear',
  workspace: { urlKey: 'acme', name: 'Acme', plan: 'free' },
  viewer: { id: '...', name: 'Test User' },
  team: 'ACME',                               // null while the team is a question
  applied: [
    { path: 'tracker.scope.workspace', value: 'acme', reason: 'the key belongs to this workspace' },
    { path: 'tracker.scope.team', value: 'ACME', reason: 'you are a member of one team' },
  ],
  questions: [{
    path: 'mappings.status.in_review',
    flag: '--status in_review=<value>',
    candidates: ['In Review', 'In Progress', 'UAT', 'Ready to ship', 'Code Review'],
    recommended: 'In Review',
    none: 'No status means in review',
  }, ...],
  broken: [],                                 // { path, value, problem } on --update
  statuses: [{ name: 'In Review', category: 'in_review', type: 'started' }, ...],   // the team's, after the answers
  notes: ['team ACME has estimates off; turn them on in the team\'s settings in Linear and run setup again'],
  files: [{ path: '.pmkit/config.yaml', action: 'create' }],   // with diff on change
}
```

While `team` is null, `questions` holds only the team, because the other candidates depend on it. The text output prints the same parts as short lines, as the Local `init` does.

### The mapping check at run time (criterion 4)

The Linear tracker runs `brokenMappings(description, config.pmkit)` before every operation except `discover` and `capabilities`, after the workspace check that PMK-33 placed in each stub:

1. Build the description from the run's discovery (memo, then cache, then API).
2. When the list is empty, run the operation.
3. When it is not empty and the discovery came from the cache, refresh once (`discover({ refresh: true })`) and check again. PMK-33 planned this refresh "when a name the user gave is missing from the cached data".
4. When it is still not empty, throw `NOT_CONFIGURED`, `a mapping in .pmkit/config.yaml names something the workspace no longer has: <problems joined by "; ">`, next step `/pmkit:setup`, with `details.mappings` set to the list.

A missing `tracker.scope.team` is one item of that list, `tracker.scope.team is not set`. It needs no request, and its error message is that sentence alone. The problems read:

- `tracker.scope.team names ACME, which this workspace no longer has`
- `mappings.status.in_review names In Review, which team ACME no longer has`
- `mappings.fields.estimate is native, but team ACME has estimates off`
- `mappings.types.bug names Bug, which is neither a label of team ACME nor of the workspace`

`none` and absent keys are never broken. `discover` and `capabilities` keep PMK-33's warnings instead of throwing, because setup needs them to fix the file. The check also runs on reads, because a missing review status changes the category of every issue that a read returns.

The CLI prints `details.mappings` as `error.mappings` in the JSON error. No other `details` key reaches the output, so nothing else changes in the error shape.

### The command text

ADR-0002 makes the command files the source for every agent, so the text below is part of the design. The builder may change wording but not the steps, the calls or the confirmation points.

#### `skills/pmkit/references/conventions.md`

A new item in "Reading errors", placed before the `NOT_CONFIGURED` item:

> - `NOT_CONFIGURED` with an `error.mappings` list means `.pmkit/config.yaml` maps a team, status, field or label that the tracker no longer has. Stop the command before any other call. Show the `problem` of each item. Ask once with `AskUserQuestion` whether to run `/pmkit:setup` now, which asks again only for these mappings. Never pick a replacement yourself, and do not retry the call.

#### `commands/setup.md`

"Parameters" names both question sets:

> None. Run `/pmkit:setup` from the root of the repository. The command asks for what it cannot detect. With the Local tracker, that is the ID prefix, the ID style, the estimate unit, the members and the `needs-criteria` label. With Linear, it is the team when you belong to several, the status that means in review, the status that means blocked, the label for each issue type, and a field only when the workspace offers more than one.

Step 1 becomes:

> 1. Check whether `.pmkit/config.yaml` exists. When it does, read its `tracker.system`. `local` goes to "Existing config" and `linear` goes to "Existing Linear config". When it does not exist, ask with `AskUserQuestion` which tracker holds the issues. Offer "Local (Recommended)", for files in this repository, and "Linear", for a Linear workspace reached with a personal API key. Local continues with "First run". Linear goes to "Linear first run".

The step numbers of "First run" and "Existing config" stay as they are. Two sections follow "Existing config":

> ### Linear first run
>
> 2. Detect the git host as in step 2 of "First run".
> 3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --tracker linear --git-host <github|none> --dry-run --json`. It reads the workspace with the key in `LINEAR_API_KEY` and writes nothing. On `AUTH`, tell the user to create a personal API key in Linear (Settings, Security & access) with read and write access and to export it as `LINEAR_API_KEY` in the shell profile or in `~/.claude/settings.json`, never in a file inside the repository. Never ask for the key and never write it. Then stop and ask the user to run setup again.
> 4. When `questions` holds `tracker.scope.team`, ask it alone with `AskUserQuestion`. Offer up to four of its `candidates`; the user can type another team key. Then run the dry run of step 3 again with `--workspace <workspace.urlKey> --team <key>`.
> 5. Ask every other item of `questions` with `AskUserQuestion`, one question per item, in batches of four, in the order given. Name what each one decides: which status means in review, which status means blocked, which field holds the estimate, which label stands for each issue type. AskUserQuestion takes four questions per call, so ask them in batches of four, in the order given. Offer `recommended` first with "(Recommended)", then the next `candidates`, then `none` with the label the item gives, four options at most. The user can type another candidate in the free-text answer.
> 6. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --tracker linear --git-host <github|none> --workspace <key> --team <key> --status <key>=<value> --field <key>=<value> --dry-run --json`, with one `--status`, `--field` or `--type-label` per answer and the team from step 3 or 4. On `INVALID_INPUT` naming a value, ask that question again with the values its next step lists.
> 7. Show one summary: the workspace and its plan, the team, the git host, each status of the team with its category, the status that means blocked, the estimate, the type, the `notes`, and `.pmkit/config.yaml` as the dry run would create it. Say that Linear numbers its own issues, so setup asks for no prefix and no ID style, and that setup creates no label in Linear.
> 8. After the user approves, run the command of step 6 without `--dry-run`.
> 9. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. Go to "Output".
>
> ### Existing Linear config
>
> 2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json`. A problem in `.pmkit/config.yaml` makes `init --update` refuse, so ask the user to fix the file by hand first and run the check again.
> 3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --update --dry-run --json`. On `AUTH`, follow step 3 of "Linear first run". `broken` lists each mapping that names a team, status, field or label the workspace no longer has, and `questions` holds each of them plus any mapping never answered. Add `--git-host`, `--team`, `--status` or `--field` only when the user asks to change them.
> 4. When `questions` is empty and no file is `change`, say "already up to date" and go to step 7. Otherwise ask the questions as steps 4 and 5 of "Linear first run" do. For a broken mapping, name its old value and its `problem` in the question.
> 5. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" init --update --team <key> --status <key>=<value> --field <key>=<value> --type-label <type>=<value> --dry-run --json` with the answers of step 4 and the flags of step 3. Show the diff of `.pmkit/config.yaml` and the summary of step 7 of "Linear first run", and ask once with `AskUserQuestion` whether to apply it. When the user declines, stop and change nothing.
> 6. After the user approves, run the command of step 5 without `--dry-run`.
> 7. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. Go to "Output".

"Confirmation points" gains two items and widens the last one:

> - Linear first run: the one summary of step 7, before `.pmkit/config.yaml` is written.
> - Existing Linear config: one question in step 5 before `init --update` writes. With nothing to write, there is no question.
> - The tracker question of step 1, the questions of step 4 of the first run, the label question of step 3 of the existing config, and the questions of steps 4 and 5 of the Linear first run and step 4 of the existing Linear config are inputs, not confirmations.

"If something is missing" gains one item:

> - `LINEAR_API_KEY` is not set, or belongs to another workspace: follow step 3 of "Linear first run". Never ask for the key.

The calls in this text are what the scenario rules check: every flag exists in the CLI (rule 3), every call ends with `--json` (rule 4), and the write calls have a confirmation point (rule 13).

### CONTEXT.md

A new term after **Category**:

> **Mapping**:
> A line under `mappings` in `.pmkit/config.yaml` that ties a pmkit category, `blocked`, a field role or an issue type to a hosted tracker's own name, such as `in_review: In Review` or `bug: Bug`. Setup writes the mappings it infers and the ones the user answers. `none` means the team has no such status or field. When a mapping names something the tracker no longer has, every command stops and offers `/pmkit:setup`.
> _Avoid_: binding, alias

## The sandbox, end to end

With the sandbox facts above, the Linear first run goes like this:

1. Step 3's dry run applies the workspace and team `ACME` (one team, the viewer is in it). `notes` says estimates are off. The type candidates are the team's labels, including those of the size and difficulty groups.
2. Step 5 asks six questions, in two batches of four and two. In review offers "In Review (Recommended)", "In Progress", "UAT" and "No status means in review". Blocked offers "No status means blocked (Recommended)" and three states. Each of the four types (feature, bug, task, chore) offers "No label stands for this type (Recommended)" and the team's labels, because no label is named after a type.
3. With the recommended answers, the file is:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/fredsvanelli/pmkit/main/schemas/pmkit.config.schema.json
version: 1
tracker:
  system: linear
  scope:
    workspace: acme
    team: ACME
git_host:
  system: github
  repo: acme/app
write_policy:
  confirm: single_writes
  preview: [bulk, delete, publish_update, move_scope]
mappings:
  status:
    in_review: In Review
    blocked: none
  types: {}
```

If someone later renames "In Review" in Linear, the next `issues list` refreshes the cache once, still misses the name, and fails with `NOT_CONFIGURED` and `error.mappings`. The command offers `/pmkit:setup`, whose `init --update` dry run lists the broken mapping as the only question.

## Testing

Every test injects `fakeLinearFetch` with routes from `fakeWorkspace()` and sets `PMKIT_HOME` with `userStoreEnv()`. No test opens a socket.

- `scripts/lib/mappings.test.mjs`, on hand-written descriptions: one viewer team is applied; two give a team question with only those teams; no viewer team gives every team; in review and blocked are asked with one candidate and with none; one estimate candidate is applied, two are asked, none gives a note; an answer outside the candidates fails with `INVALID_INPUT` naming them; a kept value is not asked again; a broken value is asked with `broken`; `none` is never broken; a write with questions left fails.
- `scripts/lib/linear/mappings.test.mjs`: the sandbox-like fake gives "In Review" over "Code Review"; a team with one `started` state offers no in-review candidate; a label named like a pmkit type is applied to it, ignoring case, and a group label is not a candidate; `resolveMappings` follows rules 1 to 5, the move target falls back to the first state by position, and a blocked state keeps its type's category.
- `discovery.test.mjs`: `in_review: none` gives no warning; the keys of `mappings.types` fill `types` and the mapped labels leave `labels`; a team label wins over a workspace label with the same name.
- `manifest.test.mjs`: `estimate: none` makes `estimation` absent with its hint, and so does an absent key on a configured team that uses estimates.
- `tracker.test.mjs`: a stub with a broken status mapping throws `NOT_CONFIGURED` with `details.mappings` after exactly one refresh; a state that is back after the refresh lets the call through; no team gives the `tracker.scope.team is not set` item; `discover` and `capabilities` warn and do not throw.
- `cli-linear.test.mjs`, through `run(argv, { env, adapters })`: the first dry run's JSON shape; the write creates `.pmkit/config.yaml` with the exact text above and no `.issues/`; a write with questions left exits 2; Local-only flags are refused; `--update` with a removed state lists it in `broken` and `questions`; a value with a space survives; the error JSON of a broken mapping has `mappings`; `FAKE_KEY` appears in no output and in no file.
- `config.test.mjs` and `schemas.test.mjs`: `mappings.types` is valid on both sides, and a non-string value is refused on both sides.
- `yaml-edit.test.mjs`: `setScalar` adds `mappings.status.blocked` to a file with no `mappings` block and keeps the comments.
- Scenarios: `scripts/scenario-helpers.mjs` gains a `linear` option. A scenario with `linear: { ...fakeWorkspace options }` runs the CLI with the in-process `run` and `adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }) }`, with `LINEAR_API_KEY` set to `FAKE_KEY` and `PMKIT_HOME` under the scratch folder. No test hook enters `scripts/pmkit.mjs`. Entry 2 is a Linear first run on a workspace where the viewer is in two teams, so it covers steps 3 to 9 with the team question. Entry 3 is an existing Linear config whose in-review state is gone, so it covers steps 2 to 7 with a broken mapping. Entries 0 and 1 gain "Local (Recommended)" as their first answer, and their calls and snapshots stay as they are.
- Every golden stays byte-identical.

## Acceptance criteria map

| Criterion | Design part |
|---|---|
| 1. Setup applies unambiguous mappings by itself | "The inference rule" rule 5 (workspace, team with one viewer team, single-candidate fields) and its last paragraph (native categories from state types, plan from discovery, no tier or version on Linear); "The generic description" table; "What goes into the file"; `mappings.test.mjs` and the sandbox walkthrough |
| 2. Setup always asks in review, blocked, the estimate with several candidates, and the scope with several teams | "The inference rule" rules 4 and 6; the candidates table; the write refusal while questions remain; setup steps 4 and 5 of "Linear first run"; scenario entry 2 (two teams) |
| 3. One summary is approved at the end, and the mappings go to `.pmkit/config.yaml` | "The `init` call for Linear" (one write after the last dry run); setup step 7 and its confirmation point; "The mappings contract"; "Schema changes"; the `cli-linear.test.mjs` case that checks the written text |
| 4. When a mapped status or field disappears, the command stops and asks | "The mapping check at run time" (refresh once, then `NOT_CONFIGURED` with `error.mappings`); the conventions rule; "Existing Linear config" steps 3 to 6; `tracker.test.mjs`; scenario entry 3 |

## Decisions

| Decision | Reason |
|---|---|
| `init --tracker linear` computes the proposal and takes answers as flags | ADR-0002 keeps rules out of prose, and one write follows one approval. |
| Only answers, the scope and inferred field roles go in the file | The Q5 example has that shape, and computed categories survive renames. |
| `none` records "answered, nothing" | Otherwise setup cannot tell a skipped question from an empty answer, and Q6 asks again only when something breaks. |
| The in-review recommendation prefers the exact name | The sandbox puts "Code Review" before "In Review" by position. |
| `mappings.types` maps a pmkit type to one label name | The user chose it (answer to question 1). A type without a label is left out, and the key's presence records that setup asked. |
| `init` always refreshes discovery | Setup runs right after the user changes Linear. |
| A write refuses while questions remain | Criterion 2 then holds for any caller of the CLI, not only for setup. |
| The run-time check refreshes once before it throws | A cached miss is often only an old cache, as PMK-33 planned. |
| `NOT_CONFIGURED` with `error.mappings`, no new error code | The conventions already map `NOT_CONFIGURED` to `/pmkit:setup`, and the list tells the command what to show. |
| Every operation but `discover` and `capabilities` needs `tracker.scope.team` | PMK-35 needs a team to create issues, and status names collide across teams. `configProblems` does not require it, so PMK-33's no-team tests and setup's draft stay valid. |
| The default team goes in `.pmkit/config.yaml`, not in the personal defaults of the user store | A repository belongs to a team, and teammates share the file (Q5). |
| The scenario harness injects the adapter in process | The CLI keeps no test hook, as PMK-33 chose for `fetch`. |

## Risks

- **PMK-35 in parallel.** Its spec is being written now. It should read the mappings through `resolveMappings` and the rules in "The mappings contract". If PMK-35 lands first, its own reading of `mappings` needs to move to the helper.
- **Several review states.** A team with "Code Review" and "In Review" can map only one to `in_review`. The other stays `in_progress`. A list per key would change the schema, so this issue leaves it out.
- **Contract suite.** PMK-39 requires a status in every category and at least one type. A sandbox with `in_review: none` or an empty `types` fails those checks. PMK-39 should map both in its sandbox team, or the suite should accept `none` for a hosted tracker.
- **Status names across teams.** The rules key everything to one team. A second team in the same repository is PMK-53's or a later issue's problem.
- **AskUserQuestion has four options.** A team with many `started` states shows three of them plus `none`. The free-text answer covers the rest, and the CLI checks it.
- **In-process scenarios.** `gitUserEmail` reads `process.env`, so the harness needs the git isolation that `cli-linear.test.mjs` sets.
- **Non-admin keys.** PMK-33 noted that a member's key may not list integrations. Setup does not need them, but the live check should run with a member's key before the milestone ships.

## Answered questions

The user answered on 2026-10-27, and the design above applies each answer.

1. **Types.** Add one field, `mappings.types`, the only schema change of this wave. Its shape is an object from a pmkit type name to one Linear label name, for example `{ bug: Bug, feature: Feature }`. A type without a label is left out. Setup asks for it and writes it. PMK-35 reads it through `resolveMappings`, whose name and return shape stay stable and documented.
2. **Estimate.** Linear's native estimate field only. Size label groups are a follow-up.
3. **How setup picks Linear.** A tracker question in step 1 of `commands/setup.md`, not an argument.
4. **Broken mappings.** A broken mapping stops reads as well as writes.

No ADR. ADR-0005 already says setup runs discovery and writes the workspace, and this design follows it.

## Left to the builder

- The module split between `scripts/lib/mappings.mjs` and `scripts/lib/linear/mappings.mjs`, as long as no Linear name enters the generic module.
- The text output of the hosted `init` and the wording of reasons, notes and problems beyond the templates above.
- How `resolveMappings` gets the Linear ids, from `raw` or from ids added to the team view.

## Self-review

- Placeholders: none. The user's four answers are applied.
- Consistency: "proposal" is the `applied`, `questions`, `broken` and `notes` of an `init` dry run. "Broken" always means a value the workspace no longer has. Examples use `acme` and `ACME`.
- Scope: two new modules, small changes to four Linear modules, `init` flags, one schema enum value, one yaml-edit change, two command files, one glossary term, a harness option and tests. No write to Linear, no new dependency, no ADR.
- Boundaries: operations go to PMK-35, the contract suite to PMK-39, tracker switching to PMK-41, `link-repo` to PMK-53, and triage rotation to PMK-43.
