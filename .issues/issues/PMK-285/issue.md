---
id: PMK-285
title: Keep the cause after a quoted file:// URL in git errors
type: bug
status: done
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-285-keep-the-cause-after-a-quoted-file-url
created: 2026-11-12T14:41:34.693Z
updated: 2026-11-12T20:41:46Z
---

## Description

### Context

PMK-278 turns every `file://` URL into `file:<path>`, but the path after `file:` goes through the unquoted rule of `hideAbsolutePaths` (`scripts/lib/paths.mjs:35`), which runs to the end of the line. `fatal: 'file:///Users/a/r': does not appear to be a git repository` becomes `fatal: 'file:<path>`, so the cause is lost. Source: PMK-278, PR #233 (cycle 3 review).

### Scope (in)

- A `file://` URL inside quotes ends at the closing quote, as a quoted path does, so the text after it shows.

### Out of scope

- Unquoted `file://` URLs, which still run to the end of the line.

### Tasks

- [ ] End a quoted file:// URL at its quote
- [ ] Test the git message above

## Acceptance criteria

- [x] `'file:///Users/a/r': does not appear to be a git repository` keeps the text after the quote and hides the path, with a test
