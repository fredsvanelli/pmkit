# PMK-304: name the cause and a working step when issues delete cannot remove its leftover

## Problem

`issues delete` renames the issue folder to `.deleting-<ID>-…` and then removes it. When the removal fails, the warning is `the issue is deleted, but <folder> could not be removed: <code>; run pmkit validate for the step to remove it` (`scripts/lib/local/tracker.mjs:695`). The code alone hides the cause: on Node 26 a read-only subfolder reports `ENOTEMPTY`, on Node 22 `EACCES`. Then `validate` gives the step `rm -rf <folder>` (`scripts/lib/validate.mjs:340`), which fails the same way on a read-only leftover, so the step does not work.

## Intent

The user should read the warning and know that a file inside is the problem, most often write permission. The `validate` step should remove the leftover when pasted.

## Goals

- The warning names the likely cause for `EACCES`, `EPERM` and `ENOTEMPTY`, the same way on Node 22 and Node 26.
- The `validate` step removes a read-only leftover.

## Non-goals

- Removing the leftover automatically (the brief says so).
- Changing the warning or the step for other codes.

## Constraints

- The tests must not depend on the error code: the same read-only subfolder gives `EACCES` on Node 22 and `ENOTEMPTY` on Node 26.
- Permission tests skip when running as root, as `scripts/tracker-delete.test.mjs:193` does, because `chmod` does not stop root.
- The step uses the relative path, as today, quoted, so a path with a space works.

## Approaches

1. **Change the message text only.** Smallest change, but the step still fails on a read-only leftover. Rejected: the second criterion is not met.
2. **Remove the leftover from `validate --fix`-style code.** Works, but it is automatic removal, which the brief rules out. Rejected.
3. **Chosen: name the cause in the warning, and make the step `chmod -R u+w` then `rm -rf`, both on the quoted relative path.** Each part is a plain shell command the user can read. The step changes only the leftover's own permissions.

## Design

**Warning** (`tracker.mjs`). When the code is `EACCES`, `EPERM` or `ENOTEMPTY`, the warning reads:

`the issue is deleted, but <folder> could not be removed: <code>; a file or folder inside could not be removed, often for lack of write permission; run pmkit validate for the step to remove it`

For other codes the warning keeps its current text. A small `PERMISSION_CODES` set and one conditional in the same warning line hold this.

**Step** (`validate.mjs`). The leftover message becomes:

`it is what a failed issues delete left behind, not an issue; remove it with: chmod -R u+w '<rel>' && rm -rf '<rel>'`

`<rel>` is the relative path as today, wrapped in single quotes, with any `'` in it written as `'\''`. The path always starts with `.issues/issues/.deleting-`, so pasting it wrong cannot reach `/`, and quoting keeps a space from splitting it.

## Tests

- **Warning** (`scripts/tracker-delete.test.mjs`): make a comments subfolder read-only, delete, and check that the warning matches `could not be removed: <code>; a file or folder inside could not be removed, often for lack of write permission`, with any of the three codes. Skip as root.
- **Step** (`scripts/validate.test.mjs`): make a leftover with a read-only subfolder inside a folder whose name has a space. Read the step from `validateRepo`, run it with `sh -c` in the temp root, and check the folder is gone. Restore permissions in `finally`. Skip as root. Update the existing expected message.

## What is left to the builder

- Exact wording of the warning and step beyond what is written here.
- Whether `PERMISSION_CODES` sits in `tracker.mjs` or is imported.

## Decisions taken without the user

- Approved by the orchestrator's brief, which says to pick sensible options and proceed. This doc is the approved design.
- Small change, so no builder-check subagent.
- Approach 3 chosen over the two others as above.
