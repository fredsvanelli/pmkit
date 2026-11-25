# PMK-331 Corpus HTML Tally And One-Space Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The corpus tally shows the HTML container cases apart, `isStatus` is a real check, and `npm test` guards the one-space in-place write.

**Architecture:** `scripts/dev` only: tag `HTML_CONTAINERS` cases with `group`, tally by end and group, test `isStatus` by the PMK-315 lists, pin the in-place one-space writes.

**Tech Stack:** Node 18+, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-331-corpus-html-tally-one-space-guard-design.md`

## Global Constraints

- `scripts/lib` unchanged. The PMK-324 prefix test stays green with its constant unchanged, so the `CONTAINERS` cases keep their shape `{ text, end }`.

## Review Focus

- `isStatus` on a break line (`Accepted  `, `Accepted\\`): false. Asserted.
- A future change to `setAdrStatus` that writes fewer one-space bodies in place: the pinned 315 per line fails, on purpose.
- The tally key for a case without `group`: `PMK-321`, as before.

---

### Task 1: Tally

- [ ] `HTML_CONTAINERS` maps each case to `{ ...item, group: 'HTML, PMK-327' }`; the driver keys the tally by `` `${item.end} (${item.group ?? 'PMK-321'})` ``.
- [ ] Run `--base 3fb6707b --head worktree`; the HTML end-of-file writes show on their own lines.

### Task 2: Tests

- [ ] Export `STATUS_WORDS` and `STATUS_OTHER`; `isStatus` uses them (a line or a line plus one trailing space, leading spaces trimmed); assert it is false on `lazy`, `a`, `''`, `Accepted  `, `Accepted\\`.
- [ ] New test: per `ONE_SPACE` line, the count of unrefused `oneSpacePairs` bodies written in place over it is 315.
- [ ] Mutations (throwaway): `STATUS_NEAR` with a member swapped for `lazy` fails the new `isStatus` and passes the old; `oneSpacePairs` with a break line after each one-space line fails the new in-place test.

### Task 3: Words

- [ ] Count comment `+ 3,766`; the "among them" wording in `adr-commonmark-diff.mjs`, `adr-write-compare.mjs` and the PMK-327 CHANGELOG line; an Unreleased line.
- [ ] `npm test`, `npm run lint`, commit.
