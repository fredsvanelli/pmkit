# Jira field mappings hold the field id

A Jira site names each field by an id (`customfield_10016`, `duedate`) and a display name (`Story point estimate`). Display names repeat: every team-managed space can define its own "Story point estimate", and a site admin can rename any custom field. PMK-76 maps each pmkit field role to a Jira field and had to choose which of the two `mappings.fields.<role>` holds for `tracker.system: jira`. The owner settled it on 2026-11-22 in `docs/superpowers/specs/2026-11-22-pmk-76-jira-discovery-and-manifest-design.md`.

`mappings.fields.<role>` holds the Jira field id, such as `estimate: customfield_10016`, or `none`. `discover` shows the name next to the id. A mapping whose id the site does not list is a warning in `discover`, and the role falls back to the inference rules.

## Status

Accepted

## Considered options

- A. The field id. Chosen. It is stable across renames and unique on the site, and it is what Jira's REST and JQL take.
- B. The display name. Rejected. Two team-managed spaces can hold two fields with the same name, and a rename breaks the mapping without any change in pmkit.
- C. A prefixed source, as GitHub's `issue:<name>` (ADR 0007). Rejected. Jira has one field source, so a prefix adds nothing.

## Consequences

- `mappings.fields` for Jira is a config format users may write by hand; changing it later needs a migration.
- A user reading `.pmkit/config.yaml` sees an opaque id; `pmkit discover` names it.
- Setup (the Jira setup issue in EPC-7) offers fields by name and writes their ids.
