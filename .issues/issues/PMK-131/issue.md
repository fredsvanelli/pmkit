---
id: PMK-131
title: "`render --out` fails with UNEXPECTED on a broken parent path"
type: bug
status: backlog
related: [PMK-25]
created: 2026-10-27T19:32:58.076Z
updated: 2026-10-27T19:32:58Z
---

## Description

When part of the `--out` path is a file or a dangling link, `mkdir` throws `EEXIST`, `ENOTDIR` or `ENOENT` and the CLI exits with `UNEXPECTED`. Turn these into a usage error that names the path. On case-insensitive file systems, `--out .ISSUES/x.md` may also pass the tracker-folder check; compare paths case-insensitively there.
