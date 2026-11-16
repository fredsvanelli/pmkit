# PMK-285 quoted file:// URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** A quoted `file://` URL ends at its closing quote in `hideAbsolutePaths`.
**Architecture:** Add an optional `file://` prefix group to the quoted-path regex; replacement keeps it as `file:`.
**Tech Stack:** Node, `node:test`.
**Spec:** `docs/superpowers/specs/2026-11-12-pmk-285-quoted-file-url-design.md`

## Global Constraints
Commits carry `(PMK-285)` and the Claude Opus 5.5 trailer. Stay inside `hideAbsolutePaths`.

## Review Focus
- `'file:///x/a'b': cause` hides the whole path, shows the cause.
- Unclosed quote and unquoted URL behave as before.
- Other quoted-path and scheme URL cases unchanged (compare develop vs branch on a battery of git/gh texts).

### Task 1: quoted file:// rule
**Files:** Modify `scripts/lib/paths.mjs`; Test `scripts/paths.test.mjs`

- [ ] Write failing test `hideAbsolutePaths ends a quoted file:// URL at its quote (PMK-285)` with the cases in the spec.
- [ ] Run `node --test scripts/paths.test.mjs`; expect FAIL.
- [ ] Rule 1: capture `((?:[Ff][Ii][Ll][Ee]:(?=\/\/))?)` after the quote, replace with `$1$2<path>$1`.
- [ ] Run the test file and `npm test`; expect exit 0.
- [ ] Commit.

### Task 2: delivery
- [ ] Battery comparison develop vs branch; CHANGELOG line; check criterion; PR.
