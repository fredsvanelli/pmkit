# PMK-365: set up pmkit on a Jira site

Issue: PMK-365, epic EPC-7, milestone `jira`. Builds on ADR 0013 (Jira Cloud only, token from the environment, `tracker.scope.site` and `tracker.scope.space`), ADR 0014 (`mappings.fields.<role>` holds the Jira field id), PMK-76 (discovery, manifest) and PMK-77 (work items, transitions, the mapping check).

## Intent

Today a Jira repository needs a hand-written `.pmkit/config.yaml`. `init --tracker jira` answers `NOT_SUPPORTED` ("not supported yet") and `/pmkit:setup` offers Local, Linear and GitHub Issues only. PMK-365 makes setup write the Jira config the way it writes the Linear and GitHub ones: the CLI reads the site, applies what it can infer, and returns the questions the user must answer; `commands/setup.md` asks them and writes the file after one summary.

## Goals

- `init --tracker jira --site <host> [--space <KEY>]` reads the site through `discover` and returns the questions setup must ask: the space (when not given), the statuses for `backlog`, `in_review`, `canceled` and `blocked`, each field role it maps (offered by name, written as the field id), and the work type of each pmkit type.
- `init --update` on a Jira config asks only what is broken (`brokenJiraMappings`) or never answered, and keeps the rest.
- `commands/setup.md` offers Jira in step 1 and has "Jira first run" and "Existing Jira config" sections, with the AUTH and NOT_SUPPORTED guidance of ADR 0013.
- `docs/runbooks/setup-jira.md` and `scripts/runbook-setup-jira.test.mjs`, on the fake Jira fetch.

## Non-goals

- No live Jira check: there are no credentials. A live run of setup against a real site goes to EPC-14 as a follow-up.
- No Jira writes: setup creates no status, field or work type in Jira.
- No change to how commands read the mappings (PMK-76, PMK-77 own that).
- No migration from another tracker to Jira, and no tracker switch (`init --update` already refuses it).

## Anti-goals

- Setup never asks for, prints or writes `JIRA_EMAIL` or `JIRA_API_TOKEN`, and never reads `.env` (ADR 0013).
- A real run never writes a file with unanswered questions (`writeHostedInit` refuses it, as on Linear and GitHub).

## Approaches

A. **A Jira proposal module, shaped like GitHub's (chosen).** `scripts/lib/jira/setup.mjs` exports `proposeJiraSetup(raw, current, answers, types)` returning `{ applied, questions, broken, notes, values }` with the question shape of `scripts/lib/mappings.mjs` (`path`, `flag`, `candidates`, `recommended`, `none`, `broken`), plus `titles` for the field ids, as GitHub's Project question carries. `runInitJira` in `scripts/pmkit.mjs` reuses `hostedInitFile`, `hostedDraft`, `putMappings`, `writeHostedInit` and `hostedInitLines`. Setup asks Jira's questions with the rules it already uses for Linear and GitHub.

B. **Feed the generic `proposeMappings` a Jira description (space as the team).** Rejected: it hard-codes Linear's keys (`in_review` and `blocked` only, `estimate` only, `tracker.scope.workspace` and `team`), so Jira would need most of it overridden.

C. **Setup reads `discover --json` and edits the YAML itself.** Rejected: the criterion asks `init` to return the questions, and the file would skip `writeHostedInit`'s validation and the dry-run/real-run split the other trackers have.

## Design

### The CLI: `init --tracker jira`

Flags: `--site <host>`, `--space <KEY>`, `--git-host`, `--status <key>=<name>`, `--field <role>=<field id>`, `--type-label <type>=<work type>`, `--update`, `--dry-run`. Local-only flags are refused by `hostedInitFile`; `--workspace`, `--team` and the GitHub flags are refused with "applies only with --tracker ...". `HOSTED_INIT` gains `jira`, so `init --update` on a Jira file takes this branch.

1. **Site.** `--site`, else `tracker.scope.site` from the file. Neither: `INVALID_INPUT`, "setup needs the Jira site", next step `Pass --site <host>, such as --site acme.atlassian.net`. The site cannot be discovered: setup asks the user for it. The value must match the client's `HOST` (lowercased); a URL is refused with the same next step **(builder's call: setup.md strips `https://` and the path before passing it)**.
2. **Space.** `--space`, else the file's `tracker.scope.space`. Neither: the CLI lists the spaces (`GET /rest/api/3/project/search`, paged, through the PMK-75 client) and returns one question, `tracker.scope.space`, with the keys as `candidates`, the names in `titles`, `recommended` set when the site has one space, `none: null`. It returns there, as Linear's team question does. The spaces are listed only then, or when the discovery of step 3 fails with `NOT_CONFIGURED` (the space is missing or the token's owner cannot browse it): a `--space` the site lacks becomes `INVALID_INPUT` naming the space keys, and a held space becomes the same question with `broken`. The descriptor gains `connect({ env, site })`, returning the client, as GitHub's adapter has one, so tests still inject the fake fetch.
3. **Discovery.** With the space known, the CLI builds the Jira tracker from a config that holds only `tracker: { system: jira, scope: { site, space } }` and calls `discover({ refresh: true })`. The client's first request runs the `myself` and `serverInfo` check, so a missing variable or a 401/403 is `AUTH` and a non-Cloud site is `NOT_SUPPORTED`, with the messages ADR 0013 gives. The CLI adds nothing to them.
4. **Proposal.** `proposeJiraSetup(view.raw, current, flags, types)`, where `types` is the default pmkit types plus any type the file maps by hand (as Linear and GitHub do).
5. **File.** Writes `tracker.scope.site`, `tracker.scope.space` and the mapping values through `putMappings`, then `writeHostedInit` with the adapter's `configProblems` (`jiraConfigProblems`). `git_host` follows Linear: `withGithubRepo`.
6. **Output.** `data`: `{ dryRun, tracker: 'jira', site, space: { key, name, style } | null, viewer, applied, questions, broken, statuses, notes, files }`. `statuses` lists each space status with the category the answers give it. Text: `site: <host>, viewer <name>`, `space: <KEY> <name> (<style>)` or `(not chosen yet)`, then `hostedInitLines`.

### The proposal rules (`scripts/lib/jira/setup.mjs`)

The order every rule follows, for each key: an answer from the flags (checked against the candidates, else `INVALID_INPUT` with `Pass one of: ...`), else the held value when it is not broken, else a question (with `broken` when the held value broke), else applied or a note as below.

**Statuses: `backlog`, `in_review`, `canceled`, `blocked`.** Jira has three status categories, so `todo`, `in_progress` and `done` come from them and are never asked; these four are always asked on a first run, as the issue's first criterion lists them. Open for the Interview: on Jira a `blocked` mapping changes nothing today (blocked comes from Blocks links, `brokenJiraMappings` and `discoveryView` skip it), unlike Linear, where an issue in that state is blocked. Candidates: every status of the space, the recommended one first. Recommended: the status whose name matches without case (backlog: `backlog`; in_review: `in review`, `review`, `code review`; canceled: `canceled`, `cancelled`, `won't do`, `declined`; blocked: `blocked`, `on hold`), else `none`. `none` label: "No status means <key>". One status cannot answer two keys: `INVALID_INPUT`, as GitHub refuses a shared option. A held key outside the four (hand-written `triage`, say) is kept, and asked again only when broken.

**Field roles.** Setup asks only the roles the Jira code reads through `mappings.fields`: `estimate` and `acceptance_criteria` (`makeContext` in `scripts/lib/jira/issues.mjs`). The discovery keeps each field's `schema.type`, a new `type` key of the raw field, to pick candidates:

| Role | Candidates | Recommended |
|---|---|---|
| `estimate` | number fields that are custom, plus `timeoriginalestimate` | the PMK-76 rule (board estimation field, then the story-points type, then the name) |
| `acceptance_criteria` | custom `string` fields | the PMK-76 rule (`Acceptance criteria` by name) |

The other roles are not asked **(builder's call)**: `priority`, `assignee` and `target_date` are Jira system fields the work-item code reads and writes directly (`priority`, `assignee`, `duedate` in `BASE_FIELDS`), so a mapping would change nothing or misstate what pmkit uses; `start_date`, `time_spent` and `sprint` are read by no Jira command yet (sprints are PMK-78, which adds its question; `init --update` asks a never-answered key then). A held mapping of any role is kept and broken-checked as today.

For an asked role: exactly one candidate and it is the recommended one: applied, reason "the site offers only this field". Otherwise one or more candidates: a question, `recommended` the rule's pick or `none`, `candidates` the field ids recommended first, `titles` `{ id: name }`, `none` label "No field holds the <role words>". No candidate: a note, "the site has no field for the <role>", and nothing written, as Linear does. An answer is a field id; setup offers names and passes the id (ADR 0014).

**Types.** Each pmkit type (default `feature`, `bug`, `task`, `chore`) to a work type of the space at the `standard` level: an epic-level type is not a pmkit type and a sub-task needs a parent. Asked while `mappings.types` is absent from the file, as on Linear. Recommended by name without case: feature `story`, `feature`; bug `bug`; task `task`; chore `chore`, `task`; else `none`. Every type's candidates are all the standard work types, the recommended one first; recommendations may repeat across types. Two answers (flags or held values) naming the same work type are refused with `INVALID_INPUT`, as a shared status is, because reads map a work type name back to one pmkit type. A space with no standard work type gives questions with no candidates: setup offers `none` and "Stop setup", as Linear's rule for an empty list. `none` label "No work type stands for this type"; a `none` answer leaves the type out of the map, as Linear does.

**Broken.** `brokenJiraMappings(raw, pmkit)` on the held mappings; each item joins `broken` and turns its key back into a question. A held `tracker.scope.space` the site lacks is the space question with `broken`.

### `commands/setup.md`

- Parameters paragraph: what Jira setup asks (the site, the space when you can browse several, the four statuses, the field roles with more than one candidate, the work type of each type).
- Step 1: `jira` goes to "Existing Jira config"; the tracker question adds "Jira", for a Jira Cloud site reached with an API token from the environment. `AskUserQuestion` takes four options, so the four are Local (Recommended), Linear, GitHub Issues, Jira.
- **Jira first run.** 2: detect the git host as in "First run". 3: ask the site host as free text (`acme.atlassian.net`); pass only the host. 4: run `init --tracker jira --git-host <...> --site <host> --dry-run --json`. On `AUTH`: tell the user to create an API token at id.atlassian.com and export `JIRA_EMAIL` and `JIRA_API_TOKEN` in the shell profile or in `~/.claude/settings.json` under `env`, never in a file inside the repository, then run setup again; never ask for the token. On `NOT_SUPPORTED`: say pmkit supports Jira Cloud only, and stop. 5: the space question alone, as the Linear team question (up to four candidates with their names; one candidate recommended, else "Stop setup" last). 6: the other questions as step 5 of "Linear first run", offering each field by name with its id. 7: the full dry run; 8: one summary (site, viewer, space, statuses with categories, applied, field roles, work types, notes, the file), saying Jira numbers its own work items so setup asks no prefix or ID style, and creates nothing in Jira; 9: the real run; 10: `validate`, `discover`, `capabilities`, naming the capabilities reported absent.
- **Existing Jira config.** As "Existing GitHub config": `validate`, `init --update --dry-run --json`, AUTH and NOT_SUPPORTED as above, "already up to date" when nothing is asked and the file is `keep`, otherwise ask, preview the diff, confirm once, write, then the three checks.
- "If something is missing": `JIRA_EMAIL` or `JIRA_API_TOKEN` not set or rejected: follow the AUTH step. Confirmation points: the summary of the first run and the one question of the update.

### Runbook and E2E test

`docs/runbooks/setup-jira.md` walks: first run without `--space` (the space question), with the space (the status, field and type questions, nothing written), every answer (`questions: []`, `create`), the real run, `validate` and `discover` on the result, `init --update` with nothing changed (`keep`), a broken mapping asked again, `AUTH` without the variables, `NOT_SUPPORTED` on a Server site. `scripts/runbook-setup-jira.test.mjs` runs each step with the real CLI through the fake-fetch launcher of `runbook-discover-jira.test.mjs`, and checks no output carries the token, the email or the header.

### ADR 0013

ADR 0013 says setup runs `discover --json`, maps AUTH and NOT_SUPPORTED, and writes the site and space. Here `init --tracker jira` runs the same discovery and returns the same errors, and setup runs `discover --json` after writing, as for the other trackers. The ADR's decision holds; its Consequences line gets one clause naming `init --tracker jira` as the call that does it.

## Constraints

- No dependencies (ADR 0003); Node 18 for the scripts.
- Reaches Jira only through the PMK-75 client (ADR 0013).
- `mappings.fields.<role>` holds the field id (ADR 0014).

## Risks

- The field-type rules and the recommended names are unverified on a live site (no credentials). A live setup run goes to EPC-14.
- The raw discovery gains `type` on each field. A cache written before this change lacks it; setup always refreshes, so only setup reads it.

## Left to the builder

- The exact wording of notes and errors, within the patterns of the Linear and GitHub branches.
- Whether `runInitJira` lives in `scripts/pmkit.mjs` next to its siblings (expected) or in `scripts/lib/jira/setup.mjs`.
