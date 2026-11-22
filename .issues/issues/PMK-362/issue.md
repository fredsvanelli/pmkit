---
id: PMK-362
title: Verify the rest of the Linear docs points live
type: task
status: backlog
priority: low
parent: EPC-13
created: 2026-11-22T17:58:26.726Z
updated: 2026-11-22T17:58:26Z
---

## Description

### Context

Found in PMK-254 (PR #375). The live docs probe confirmed every point of the PMK-252 section of `scripts/lib/linear/API-VERIFICATION.md` but three, which the run did not exercise: Linear's attachment upsert by URL, the `x-complexity` of `PmkitIssuesAttachments` alone, and an issue with more than 20 attachments (read one issue at a time). pmkit does not rely on the upsert.

### Scope (in)

- A live probe for each, through the sandbox guard.

## Acceptance criteria

- [ ] Each of the three points is marked confirmed or corrected in the PMK-252 section, with the date
- [ ] Any difference from the fake is fixed in the adapter and the fake, with a test
