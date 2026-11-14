# PMK-315 status line fuzz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline).

**Goal:** `adr-commonmark-diff.mjs` exercises the status line choice and compares what `setAdrStatus` removes at two refs.
**Architecture:** a pure helper `compareWrites` in `scripts/dev/adr-write-compare.mjs` (no commonmark), tested in `npm test`; the script builds the corpus and wires it.
**Tech Stack:** node:test, commonmark.js outside the repo.
**Spec:** `docs/superpowers/specs/2026-11-14-pmk-315-status-line-fuzz-design.md`

## Global Constraints
- Do not touch `scripts/lib/adr.mjs`. Commits carry `(PMK-315)` and the Opus trailer.

## Review Focus
- Refusal at a ref is its own outcome, not "removed" (test).
- Duplicate lines: removed text is a multiset (test).
- Empty section: no removed text, not worse (test).

### Task 1: pure helper
**Files:** Create `scripts/dev/adr-write-compare.mjs`, `scripts/dev/adr-write-compare.test.mjs`
**Interfaces:** Produces `removedLines(before, after): string[]` (multiset diff of trimmed non-blank lines); `compareWrites({ base, head, headStatus })` where `base`/`head` are `{ refused: true }` or `{ removed: string[] }` and `headStatus` is the head's status line; returns one of `'refusedBoth' | 'newlyRefused' | 'acceptedWhereRefused' | 'same' | 'worse'` plus `extra: string[]`.
- [ ] Write tests (refusals, multiset, status allowance, worse in both-write and base-refused cases); run, expect FAIL
- [ ] Implement; run `node --test scripts/dev/adr-write-compare.test.mjs`, expect PASS
- [ ] Commit

### Task 2: corpus and script
**Files:** Modify `scripts/dev/adr-commonmark-diff.mjs`, `CHANGELOG.md`
- [ ] Add STATUSY lines to the alphabet and a weighted random kind; add `guards(mod)`/`write(mod,text)` per ref (refusal = adrHtmlHeld/adrFenceHeld/adrStatusDropped non-empty); report lines for write comparison and `empty status`; exit 1 on `worse`; header comment with definitions.
- [ ] Run full `--base 3f24c7e6 --head 5d09c170`, record counts and time
- [ ] CHANGELOG line under `## Unreleased`; commit

### Task 3: mutation proof
- [ ] Temp worktree at 5d09c170, mutate the in-place write to drop the line after the status, run `--head worktree`, expect exit 1; save output

### Task 4: verify and deliver
- [ ] `npm test` foreground exit 0; check criteria; PR
