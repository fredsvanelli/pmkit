# GitHub Issues without a Project reads priority and estimate from labels

ADR 0009 lets a repository without a Project (`tracker.scope.project: none`) read statuses and types from labels. The field roles `priority`, `estimate`, `start_date` and `target_date` still came only from org issue fields, which GHES has only from 3.22 (ADR 0007, amended) and which an organization must define. PMK-339 asked whether those roles may map to labels too. The owner settled it on 2026-11-21 in `docs/superpowers/specs/2026-11-21-pmk-339-github-priority-estimate-labels-design.md`.

Priority and estimate may come from labels; the dates may not. `mappings.priority.<level>` (`urgent`, `high`, `medium`, `low`) names one label per priority level, and `mappings.estimate.<value>` names one label per estimate value, each written `label:<name>` as in ADR 0009. The estimate scale is the keys of `mappings.estimate` in order, in points when every key is a number and in sizes otherwise. A priority or estimate write swaps that role's labels with `addLabelsToLabelable` and `removeLabelsFromLabelable`, and a labels patch refuses a mapped label with `INVALID_INPUT`. An issue with several priority labels reads the highest and one with several estimate labels reads the first in the mapping's order, each with a warning.

A label value holds only while the repository has no Project and `mappings.fields.<role>` is `none`, so one role has one source. Otherwise the mapping check answers `NOT_CONFIGURED` with the next step `/pmkit:setup`, as for a `label:` status with a Project. Setup asks a label per priority level, recommended by name, and takes estimate labels only from `--estimate-label <value>=<label>`, because estimate label names vary too much to guess.

## Status

Accepted

## Considered options

- A. Priority and estimate from one label per value; dates unsupported. Chosen. Teams already mark priority and size with labels, and a value-to-label map can say that `P1` means high. A label cannot hold a free date, so a date label would need one label per day.
- B. Priority only. Rejected. Estimates matter as much to planning, and the same map shape covers them.
- C. No label for any field role. Rejected. A repository without a Project and without issue fields would keep no priority and no estimate.
- D. A label prefix, such as `mappings.fields.priority: label:priority`, read as `priority: high`. Rejected. It ties pmkit to one naming convention and cannot map `P1` to high.

## Consequences

- `mappings.priority` and `mappings.estimate` are a config format users write by hand. A later change cannot drop them without a migration.
- A repository that adds a Project after setup gets a broken mapping for each held priority and estimate label, and setup asks the fields again.
- `issues get --history` and the flow metrics show priority and estimate label changes as label events, not as priority or estimate changes.
- The dates stay unsupported without a Project or issue fields; setup records `none` for them.
