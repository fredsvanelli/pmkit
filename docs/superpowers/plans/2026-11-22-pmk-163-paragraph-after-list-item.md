# PMK-163 Paragraph After List Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static rule fails on an indented lazy-continuation paragraph after a list item in `commands/`, `skills/` and `docs/`, and today's ten are fixed.

**Architecture:** `lazyContinuations(text)` in `scripts/scenarios.test.mjs`, one scan test, one unit test.

**Tech Stack:** Node 18+, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-163-paragraph-after-list-item-design.md`

## Global Constraints

- No dependencies. Only blank lines change in the fixed files.

## Review Focus

- A line inside a fence that looks like the shape: skipped.
- CRLF files: split on `\r?\n`.
- A continuation indented to the content column: not a hit.

---

### Task 1: Rule and fixes

- [ ] Unit test of `lazyContinuations` (hit, blank line, content-column indent, fence) and the scan test; run: the scan lists the ten places.
- [ ] Insert a blank line before each of the ten paragraphs; run: green.
- [ ] CHANGELOG; `npm test`; `npm run lint`; commit.
