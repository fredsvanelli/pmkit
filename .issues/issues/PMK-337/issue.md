---
id: PMK-337
title: Page through Project items and linked Projects past the first 20
type: bug
status: in_review
priority: low
assignee: fred
parent: EPC-8
milestone: github-issues
branch: pmk-337-page-through-project-items-and-linked
created: 2026-11-17T01:21:31.037Z
updated: 2026-11-18T01:33:33Z
---

## Description

Found by `utils:review-work` on PMK-87 (PR #311) and PMK-91 (PR #317). Three GitHub reads stop at the first 20 Project entries and never page:

- `scripts/lib/github/documents.mjs` reads `projectItems(first: 20)` for a blocker's Status (blockedBy).
- `scripts/lib/github/documents.mjs` reads `projectItems(first: 20)` for the metric events.
- `fetchLinkedProjects` in `scripts/lib/github/discovery.mjs` reads only the first 20 Projects linked to the repository. Setup's Project question and the `--project` check of `github draft-issues` use it.

An issue in more than 20 Projects can get the wrong Status or miss metric events, and a repository with more than 20 linked Projects can refuse a valid `--project`.

## Acceptance criteria

- [x] Both `projectItems` reads page through every Project item, or find the configured Project's item directly
- [x] `fetchLinkedProjects` pages through every linked Project
- [x] Tests cover more than 20 Project items and more than 20 linked Projects
