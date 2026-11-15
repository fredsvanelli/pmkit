# PMK-325 Status name after a definitions block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `adr-status` refusal names the status glued to the first shown paragraph also when link reference definitions open the section as a block of their own, at the top level, in a quote or item, and before a quote or item.

**Architecture:** One change inside the existing walk of `statusSection` (`scripts/lib/adr.mjs`): track per parent the run of definitions-only paragraphs and map the run's first line (`after`) to the shown paragraph that is the next block, climbing through quotes and items whose first block it is. `statusLineOf` is unchanged.

**Tech Stack:** Node 22 ESM, `node:test`, no dependencies (ADR 0003).

**Spec:** `docs/superpowers/specs/2026-11-15-pmk-325-definitions-block-status-name-design.md`

## Global Constraints

- Only names change: refusal yes/no, text written and `adr-get` status equal to develop.
- One walk: no second walk, no raw-line test of block kind in `statusLineOf`.
- Zero dependencies; comparison scripts stay in the scratchpad (`PMK-325/`).
- Every commit carries `(PMK-325)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A section whose only status-like word is in a hidden definition (`[Draft]:`, `Rejected`, blank, `see ADR 3`): no line reads as a status, so the first-line fallback stays (pinned PMK-322 test, unchanged).
- A definitions run that does not open the section (`Date: x`, blank, `[x]: /u`, blank, `Accepted`): unchanged, `after` is only read for the first line (existing control test plus one new).
- A `---` or indented code between the definitions and the paragraph: run broken, names unchanged (controls).
- Nested: definitions in a quote before an inner quote (`> [a]: /u`, `>`, `> > Date: x`, `> > Accepted`): the climb reaches the outer run.
- A second paragraph of a quote after definitions plus a paragraph: not first shown, unchanged (existing tests).

---

### Task 1: Definitions block before the first shown paragraph

**Files:**
- Modify: `scripts/lib/adr.mjs` (`add` in `sectionEnd`; the `walk` closure in `statusSection`; comments)
- Test: `scripts/adr.test.mjs` (after the PMK-322 blocks, ~line 2185)

**Interfaces:**
- Consumes: `held.paragraphs` entries `{ parent, index, lines, lazy, text }`; every block added gets `parent` when `held.paragraphs` is set.
- Produces: `paragraphOf.after(i)` also defined for the first line of a run of definitions-only paragraphs that the next shown paragraph follows.

- [ ] **Step 1: Write the failing tests** — a `for` table in the PMK-322 style (`adrStatusDropped` plus CLI dry run and real, code 2, file unchanged), named `(PMK-325)`:
  - `[a]: /u`, blank, `Date: x`, `Accepted`, blank, `> Proposed` → `['[a]: /u', 'Date: x', '> Proposed']`, kept `Accepted`
  - `[a]: /u`, `[b]: /v`, blank, same → `['[a]: /u', '[b]: /v', 'Date: x', '> Proposed']`
  - `[a]: /u`, blank, `[b]: /v`, blank, same → `['[a]: /u', '[b]: /v', 'Date: x', '> Proposed']`
  - quote `> [a]: /u`, `>`, `> Date: x`, `> Accepted`, blank, `> Proposed` → `['> [a]: /u', '>', '> Date: x', '> Proposed']`, kept `> Accepted`
  - item `- [a]: /u`, blank, `  Date: x`, `  Accepted`, blank, `> Proposed` → `['- [a]: /u', 'Date: x', '> Proposed']`
  - no later status `[a]: /u`, blank, `Date: x`, `Accepted` → `['[a]: /u', 'Date: x']`; quote form → `['> [a]: /u', '>', '> Date: x']`
  - before a quote `[a]: /u`, blank, `> Date: x`, `> Accepted` → `['[a]: /u', '> Date: x']`; with blank, `> Proposed` → `['[a]: /u', '> Date: x', '> Proposed']`
  - nested `> [a]: /u`, `>`, `> > Date: x`, `> > Accepted` → `['> [a]: /u', '>', '> > Date: x']`
  Controls (`adrStatusDropped` only, pass before and after): `[a]: /u`, `---`, `Date: x`, `Accepted` → `['---', 'Date: x', 'Accepted']`; `    code`, blank, `Date: x`, `Accepted` → `['Date: x', 'Accepted']`; `Date: x`, blank, `[x]: /u`, blank, `Accepted` → as on develop.
- [ ] **Step 2: Run** `node --test --test-name-pattern=PMK-325 scripts/adr.test.mjs` — expected: the new refusal cases FAIL (old names), controls PASS.
- [ ] **Step 3: Implement.** In `add`, set `block.parent = parent` for every block when `held.paragraphs` (paragraphs keep `lines`, `lazy`). In `walk`: `runs = new Map()` (parent → `{ line, index }`); a definitions-only paragraph extends the parent's run when `run.index === index - 1`, else starts one at `lines[0]`; for a shown paragraph that passes the existing first-block check, climb `node` from the paragraph: if `runs.get(node.parent)?.index === node.index - 1`, `after.set(run.line - section - 1, start)` and stop; else stop at the document or when `node.index !== 1`, else `node = node.parent`. Keep the existing `after` entry for glued definitions.
- [ ] **Step 4: Run** the same command — all PASS; then `node --test scripts/adr.test.mjs` — PASS.
- [ ] **Step 5: Commit** `fix(adr): the status after a definitions block is the one the reader sees (PMK-325)`.

### Task 2: Evidence, changelog, ship

- [ ] Comparison script `PMK-325/compare.mjs` in the scratchpad: random Status bodies from a seeded generator over lines (definitions, blank, `>`/`-` prefixes, statuses, dates, `---`, indented code), run through the CLI (`docs adr-status`, `docs adr-get`) on a develop worktree and on the branch; compare exit code, refusal yes/no, `nextStep`, file after the write, `adr-get` status; classify each name difference (dropped list) by "a definitions-only block precedes the first shown paragraph". Report counts, seed, time.
- [ ] `node scripts/dev/adr-commonmark-diff.mjs` full run on develop and the branch: 0 worse.
- [ ] CHANGELOG line under `## Unreleased`; commit `docs: PMK-325 changelog`.
- [ ] `npm test` foreground, exit 0. `/utils:review-work`. Check ACs, commit `.issues/`, `pr open`, `issues comment`, `issues move PMK-325 in_review`.
