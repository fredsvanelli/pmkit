# PMK-339: read priority and estimate from labels on GitHub repositories without a Project

Issue: PMK-339 (EPC-8, feature). Found while working PMK-89 (PR #312, `docs/specs/2026-11-17-pmk-89-github-issues-without-a-project-design.md`). Builds on ADR 0009 (statuses and types from labels).

## Intent

Without a Project (`tracker.scope.project: none`), statuses and types can come from `label:<name>` mappings (ADR 0009), but the field roles `priority`, `estimate`, `start_date` and `target_date` can only come from org issue fields, which GHES has only from 3.22 (ADR 0007, amended) and which an organization must define. A team on such a repository has no priority and no estimate in pmkit, so sorting by priority, estimates and the flow and planning commands that use them see nothing. Many teams already keep these as labels (`P1`, `priority: high`, `size: M`, `estimate: 3`).

## Decision from the owner (2026-11-21, relayed by the PO)

Option A: priority and estimate may map to labels, one label per priority level and one label per estimate value. Start and target dates stay unsupported without a Project or issue fields, because a label cannot hold a free date. The question the issue asks ("decide whether field roles may map to labels") is answered by a new ADR.

## Goals, non-goals, anti-goals

- Goal: on a repository without a Project, `mappings.priority.<level>: label:<name>` (levels `urgent`, `high`, `medium`, `low`) and `mappings.estimate.<value>: label:<name>` give each issue its priority and estimate; writes swap the labels; setup asks the priority labels and takes estimate labels from flags.
- Goal: an ADR records the decision, the dates' "no", and the rule for when label values are valid.
- Non-goal: start and target dates from labels (owner: no).
- Non-goal: replaying priority and estimate label changes in `issues get --history` and the flow metrics. History keeps showing them as label events; a follow-up issue can add the replay if wanted.
- Anti-goal: a label value that silently competes with an issue field or a Project field for the same role.

## Approaches

1. **Per-value label maps in new mapping groups, valid only without a Project and with the role's field `none` (chosen).** Mirrors ADR 0009: `mappings.priority` and `mappings.estimate` are objects from a pmkit value to `label:<name>`. They are read only when `tracker.scope.project` is none and `mappings.fields.<role>` is none. Otherwise a held label value is a broken mapping (`NOT_CONFIGURED`, next step `/pmkit:setup`), as a `label:` status is with a Project.
2. **`mappings.fields.priority: label:<prefix>`, with values read from label names (`priority: high`).** One line of config, but it ties pmkit to a naming convention and cannot map `P1` to `high`. Rejected.
3. **Allow labels with a Project too.** A Project has single-select fields for this; two sources for one role is the anti-goal. Rejected.

## Design

### Config and the mapping check

- `schemas/pmkit.config.schema.json`: `mappings.priority` (keys `urgent`, `high`, `medium`, `low`) and `mappings.estimate` (keys: estimate values, strings), each value `label:<name>` or `none`. The descriptions say GitHub Issues without a Project only.
- `scripts/lib/github/mappings.mjs` (`problemOf`, `brokenGithubMappings`): the two groups join `status`, `fields` and `types`. A held value is broken when: it is not `label:<name>`; the repository no longer has the label; there is a Project; `mappings.fields.<role>` is not none; or one label stands for two values of the same role, or for a status or type label.

### Reads

- `scripts/lib/github/issues.mjs`: `priorityLabels` and `estimateLabels` beside `statusLabels` and `typeLabels`, built only under the rule above; their label ids join `mappedLabelIds`. `readLabels` returns `priority` and `estimate`. An issue with several priority labels reads the highest (urgent first) with a warning; several estimate labels read the first in the mapping's order with a warning, as type labels do. `priorityOf` and `estimateOf` read the labels when the maps are not empty.
- Estimate unit and scale (`estimateOf` in `scripts/lib/github/discovery.mjs`, used by `discover` and the manifest): the keys of `mappings.estimate` in order; unit `points` when every key is a number, else `sizes`. Issue estimates read as numbers for points and as strings for sizes, as today.

### Writes

- `scripts/lib/github/writes.mjs` (`planLabels`): a `priority` or `estimate` patch swaps that role's labels, as a type patch does (remove every label of the role, add the target's). `null` removes them. A value with no label is `INVALID_INPUT` naming the mapped values. A `labels` patch refuses a priority or estimate label (already true for every id in `mappedLabelIds`).

### Setup

- `init --priority-label <level>=<label|none>` and `--estimate-label <value>=<label|none>` (`scripts/pmkit.mjs`, `scripts/lib/github/mappings.mjs`). Without a Project and with `mappings.fields.priority` none, setup asks a label per priority level, like the status labels: candidates are the labels no status, type or other level took, recommended by name (`urgent`/`p0`, `high`/`p1`, `medium`/`p2`, `low`/`p3`, compared without case and without a `priority:` prefix). Estimate labels are never inferred: `commands/setup.md` asks once, when there is no Project, whether some labels hold estimates, and passes each answer as `--estimate-label`.
- The manifest (`scripts/lib/github/manifest.mjs`): `estimation` is `native` with the label scale when estimate labels are mapped; priority reports as it does for a field.

### Docs

- ADR 0012 "GitHub Issues without a Project reads priority and estimate from labels", with the dates' "no" and the validity rule.
- `CONTEXT.md`: **Priority label** and **Estimate label** next to **Status label**.
- README's GitHub section, `commands/setup.md`, `docs/runbooks/setup-github.md` and `docs/runbooks/issues-github.md` (the no-Project part).

## Tests

- Unit: `mappings.test.mjs` (questions, flags, broken values), `issues.test.mjs` (reads, several labels), `writes.test.mjs` (swaps, refusals), `discovery.test.mjs` / `manifest.test.mjs` (scale and unit), `tracker.test.mjs` (a no-Project tracker sorts by priority).
- E2E: `scripts/runbook-setup-github.test.mjs` (setup without a Project asks and records the priority labels, takes `--estimate-label`), `scripts/runbook-issues-github.test.mjs` (create with a priority and an estimate, read back, update both, the labels on the fake change), each with its runbook step.
- An ADR test like `scripts/adr-github-labels.test.mjs` pins ADR 0012's status line and decision.

## Left to the builder

Names; message wording; the order of setup's questions after the type questions.

## Interview

Approved on 2026-11-21 by the pmkit PO on the owner's behalf: the owner chose option A (priority and estimate from labels, dates unsupported), and that answer plus the acceptance criterion is the approval. The questions the grilling raised and the answers taken (the recommended ones, none of them a product question):

- Label values are valid only without a Project and with the role's field `none`: yes, one source per role (ADR 0009's rule, extended).
- Estimate labels come only from `--estimate-label`, never inferred from names: yes, estimate label names vary too much to guess safely.
- Several priority labels read the highest, with a warning: yes, so an urgent label is never hidden.
- History replay of these labels is left out: yes, it is not in the criterion; a follow-up can add it.
- New terms in `CONTEXT.md`: Priority label, Estimate label. A new ADR (0012), because the config format is hard to reverse (ADR 0009's consequence applies).
