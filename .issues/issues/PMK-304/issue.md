---
id: PMK-304
title: Name the cause and a working step when issues delete cannot remove its leftover
type: bug
status: in_review
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-304-name-the-cause-and-a-working-step-when
created: 2026-11-13T16:20:45.410Z
updated: 2026-11-13T17:10:19Z
---

## Description

### Context

When `issues delete` cannot remove the renamed folder, it warns `the issue is deleted, but <folder> could not be removed: <code>; run pmkit validate for the step to remove it` (`scripts/lib/local/tracker.mjs:695`), and `validate` gives the step `rm -rf <folder>` (`scripts/lib/validate.mjs:340`). Checked at 7fee61b9 with a read-only subfolder: Node 22 reports `EACCES: permission denied, unlink ...`, Node 26.4.0 reports `ENOTEMPTY, Directory not empty`. On Node 26 the warning names a code that hides the cause (permissions), and with a read-only subfolder `rm -rf` fails the same way, so the step does not work. Source: PMK-301, PR #256 (review cycle 1).

### Scope (in)

- The warning names the likely cause when the code is `EACCES`, `EPERM` or `ENOTEMPTY`: a file or folder inside could not be removed, often for lack of write permission.
- The step from `validate` works for a read-only leftover (for example `chmod -R u+w <folder>` before `rm -rf`).

### Out of scope

- Removing the leftover automatically.

### Tasks

- [ ] Reword the warning for the three codes
- [ ] Give validate a step that works on a read-only leftover, and test it

## Acceptance criteria

- [x] The warning of a failed cleanup says that a file inside could not be removed and names permissions as the likely cause, on Node 22 and Node 26, with a test
- [x] The step from `validate` removes a read-only leftover when run, with a test
