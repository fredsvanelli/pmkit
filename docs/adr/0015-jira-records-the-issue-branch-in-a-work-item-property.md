# Jira records the issue branch in a work-item property

`pmkit issues branch` records the branch on the issue, and `pr open` reads it back from `issue.branch`. Linear suggests a branch name and GitHub links branches (ADR 0008), but a Jira work item has no branch field: its development panel shows branches only through a connected git integration, which pmkit neither configures nor reads. PMK-77 had to choose where a Jira tracker keeps the branch. The owner settled it on 2026-11-22 in `docs/superpowers/specs/2026-11-22-pmk-77-jira-work-items-transitions-links-jql-design.md`.

The Jira adapter stores the branch name in the work-item property `pmkit.branch` (`PUT /rest/api/3/issue/<key>/properties/pmkit.branch`, a JSON string) and reads it with `properties=pmkit.branch` in the same request that reads the item.

## Status

Accepted

## Considered options

- A. A work-item property. Chosen. It is Jira's documented store for app data on a work item, it costs no extra request on read, it needs no field a site admin must create, and nobody edits it by accident in the Jira UI.
- B. A custom field, or a line in the description. Rejected. A custom field needs an admin and a mapping on every site; a description line shows up in Jira and breaks when someone edits the text.
- C. No record on Jira. Rejected. `issues branch` and `pr open` would fail on Jira, so `/pmkit:issues:work` could not deliver.

## Consequences

- The key `pmkit.branch` and its value shape are a stored format: renaming either needs a migration of every work item that has one.
- The branch is invisible in the Jira UI. Jira's development panel still shows it when the site connects the git host, because pmkit names branches after the work-item key.
- Another tool that writes `pmkit.branch` would overwrite pmkit's record.
