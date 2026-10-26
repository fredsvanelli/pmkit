# PMK-117 sprint current in the design spec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The CLI table in the pmkit design spec shows `[--sprint id\|current\|none]` on the `issues create` and `issues update` rows, the same text the CLI prints.

**Architecture:** Two table rows in one Markdown file change. No code changes. A static check (`grep -F` counts and one `node -e` comparison) fails first, then the edit makes it pass.

**Tech Stack:** Markdown, `grep`, Node 18+ (`node -e`), `npm test` (`node:test`).

**Spec:** `docs/superpowers/specs/2026-10-26-pmk-117-sprint-current-in-design-spec-design.md`

## Global Constraints

- The only file that may change in the implementation commit is `docs/superpowers/specs/2026-10-23-pmkit-design.md`, lines 330 and 331. Do not touch the Does column, `cycle add`, `scripts/`, `CHANGELOG`, or any test.
- Pipes inside the table are escaped as `\|`. The raw file contains `[--sprint id\|current\|none]`. The rendered text is `[--sprint id|current|none]`, equal to the usage strings at `scripts/pmkit.mjs` lines 278 (create) and 288 (update).
- After text of line 330 (`issues create`), exactly:

```
| `issues create --title t [--type] [--priority] [--estimate] [--assignee] [--label l,..] [--parent] [--sprint id\|current\|none] [--due] [--milestone m] [--description-file f] [--criteria-file f]` | creates |
```

- After text of line 331 (`issues update`), exactly:

```
| `issues update <id> [--title] [--type] [--priority] [--estimate] [--label l,..] [--sprint id\|current\|none] [--due] [--milestone] [--branch] [--description-file f] [--criteria-file f] [--check n] [--uncheck n]` | edits fields and criteria |
```

- No test, golden or snapshot reads the design spec (`grep -rn "2026-10-23-pmkit-design" scripts/` finds nothing). If one ever did, regenerate it with `UPDATE_GOLDENS=1` and read the diff line by line. Never edit a golden by hand. This plan edits no golden.
- Commit message format: a subject ending with `(PMK-117)`, then the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Straight quotes, no em dashes in prose.
- Decision on the open choices: one task, not two. The two rows share one check and one reviewer gate, and a reviewer would not approve one row and reject the other.

## Review Focus

1. A raw `|` in the new text splits the table cell. The pipe-escape check in Task 1 (`grep -cF '[--sprint id\|current\|none]'` prints `2`) pins it.
2. Another row still shows the bare `[--sprint]`. Task 1 checks that `grep -cF '[--sprint]'` prints `0`.
3. The edit touches a line other than 330 and 331. Task 1 checks that exactly 4 table lines changed (2 removed, 2 added) and that only one file differs.

---

### Task 1: Show `--sprint id|current|none` in the two CLI rows

**Files:**
- Modify: `docs/superpowers/specs/2026-10-23-pmkit-design.md` (lines 330 and 331)

**Interfaces:**
- Consumes: the usage strings in `scripts/pmkit.mjs` lines 278 and 288 (read only).
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing check.** Run each command from the repo root. Expected output now is in the second column.

| Command | Prints now |
| --- | --- |
| `grep -cF 'issues create --title t [--type] [--priority] [--estimate] [--assignee] [--label l,..] [--parent] [--sprint id\|current\|none] [--due] [--milestone m] [--description-file f] [--criteria-file f]' docs/superpowers/specs/2026-10-23-pmkit-design.md` | `0` |
| `grep -cF 'issues update <id> [--title] [--type] [--priority] [--estimate] [--label l,..] [--sprint id\|current\|none] [--due] [--milestone] [--branch] [--description-file f] [--criteria-file f] [--check n] [--uncheck n]' docs/superpowers/specs/2026-10-23-pmkit-design.md` | `0` |
| `grep -cF '[--sprint]' docs/superpowers/specs/2026-10-23-pmkit-design.md` | `1` |
| `grep -cF '[--sprint id\|current\|none]' docs/superpowers/specs/2026-10-23-pmkit-design.md` | `0` |

Then run the rendered-text comparison, which reads both files, unescapes `\|` in the spec, and compares each row with the usage string:

```
node -e 'const fs=require("fs");const s=fs.readFileSync("docs/superpowers/specs/2026-10-23-pmkit-design.md","utf8").replace(/\\\|/g,"|");const c=fs.readFileSync("scripts/pmkit.mjs","utf8");for(const n of ["issues create","issues update"]){const u=c.match(new RegExp("name: \x27"+n+"\x27[^\\n]*\\n\\s*usage: \x27([^\x27]*)\x27"))[1];console.log(n,s.includes("\x60"+n+" "+u+"\x60"))}'
```

Expected now: `issues create false` and `issues update false`. If any command prints something else, stop and report.

- [ ] **Step 2: Edit the two rows.** In `docs/superpowers/specs/2026-10-23-pmkit-design.md`, replace line 330 and line 331 with the two after-texts from Global Constraints, character for character. The create row changes only `[--sprint]` to `[--sprint id\|current\|none]`. The update row replaces the phrase `[field flags, including --milestone and --branch]` with `[--title] [--type] [--priority] [--estimate] [--label l,..] [--sprint id\|current\|none] [--due] [--milestone] [--branch]`.

- [ ] **Step 3: Run the check again and confirm it passes.**
  - The first two `grep -cF` commands from Step 1 print `1`.
  - `grep -cF '[--sprint]' docs/superpowers/specs/2026-10-23-pmkit-design.md` prints `0` and exits with code 1.
  - `grep -cF '[--sprint id\|current\|none]' docs/superpowers/specs/2026-10-23-pmkit-design.md` prints `2`.
  - The `node -e` comparison prints `issues create true` and `issues update true`.
  - `git diff -U0 -- docs/superpowers/specs/2026-10-23-pmkit-design.md | grep -c '^[-+]|'` prints `4`.
  - `git diff --name-only` prints only `docs/superpowers/specs/2026-10-23-pmkit-design.md`.

- [ ] **Step 4: Run the whole suite.**

Run: `npm test`
Expected: all tests pass, with the same count as on `main`. No test reads the spec, so this only proves nothing else changed.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-23-pmkit-design.md
git commit -m "docs: show --sprint id|current|none in design spec CLI table (PMK-117)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Complexidade: baixa
