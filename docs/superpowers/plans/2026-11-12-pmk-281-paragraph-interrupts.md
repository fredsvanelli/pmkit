# PMK-281 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) with superpowers:test-driven-development.

**Goal:** `locate().end` reads which lines interrupt the Status paragraph, and tab-indented code, as CommonMark does.

**Architecture:** Narrow interrupt regex in the walk, wide block-start regex at the start of a block, tab-aware `indentColumns`, `LIST_ITEM` excludes `THEMATIC_BREAK`.

**Spec:** `docs/superpowers/specs/2026-11-12-pmk-281-paragraph-interrupts-design.md`

## Global Constraints

- One parser for `adr-get` and `adr-status` (PMK-263); no full list parser; no PMK-282/283 scope.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `(PMK-281)` in every message.

## Review Focus

- `Accepted\n\n2. foo\n===` and `Accepted\n\n-\n===` (block start) keep the section open.
- `Accepted\n\tcode\nmore\n===` (tab inside a paragraph) ends at `Accepted`.
- `Accepted\n\n\tcode\n===` (code, no paragraph) keeps the section open.

---

# PMK-281 plan

Spec: `docs/superpowers/specs/2026-11-12-pmk-281-paragraph-interrupts-design.md`. All code in `scripts/lib/adr.mjs`, tests in `scripts/adr.test.mjs`. Each task is test first.

1. Ordered start and empty item (criterion 1). Red: `Accepted\n2. foo\n===`, `Accepted\n*\n===`, `Accepted\n1.\n===` end at `Accepted` (status `Accepted 2. foo`... the section is only `Accepted`); `Accepted\n1. foo\n===` and `Accepted\n\n2. foo\n===` and `Accepted\n\n-\n===` stay open. Green: narrow `INTERRUPTS_PARAGRAPH` for the walk, wide `BLOCK_START` for the start of a block.
2. Tab-indented code (criterion 2). Red: `Accepted\n\n\tcode\nmore\n===` ends at `more`; `Accepted\n\n\tcode\n===` stays open; `Accepted\n\tcode\nmore\n===` ends at `Accepted`; ` \t` counts as 4 columns. Green: `indentColumns`, skip the code run.
3. PMK-280 review points: `- a\n\n  b\n- - -` keeps the section open as a thematic break, not an item; move the `LIST_ITEM` comment.
4. CLI test (`adr-get`, `adr-status`), CHANGELOG line, `npm test`, tick criteria, PR.
