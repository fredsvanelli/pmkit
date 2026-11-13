# PMK-296 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline).

**Goal:** a quoted path closes before `.`, `,`, `;`, `}` when what follows ends the path.
**Architecture:** widen the char class in `QUOTED_CLOSE`; nothing else in the closer loop changes.
**Tech Stack:** Node 22, `node:test`.
**Spec:** `docs/superpowers/specs/2026-11-12-pmk-296-quoted-close-punctuation-design.md`

## Global Constraints
- Linear time (PMK-288). Commits carry `(PMK-296)` and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
- `'/Users/x/a'.b c/d'` hides everything; `'/a'.,;}` runs and `'/a'.]` close; `'/a'.x` with no later quote hides to the end.
- Mixed run before a later quote: `'/x y'.. and '/b c'` closes twice.

### Task 1: Rule, tests, probe, docs
**Files:** Modify `scripts/lib/paths.mjs` (QUOTED_CLOSE, header doc), `scripts/paths.test.mjs`, `scripts/paths-timing.test.mjs`, `CHANGELOG.md`.
- [ ] Test first in `paths.test.mjs`: `hideAbsolutePaths("'/Users/x/a'. next") === "'<path>'. next"`; `"Cloning into 'file:///x/y'..."` -> `"Cloning into 'file:<path>'..."`; each of `. , ; }` with a following word; `"'/Users/x/a'.b c/d'"` and the other three characters show no `Users`, `a'`, `b c`, `d`; `'/x y'.x` unclosed -> `'<path>`.
- [ ] Run `node --test scripts/paths.test.mjs`: new tests FAIL.
- [ ] Change the class in `QUOTED_CLOSE` to `[\\]>.,;}]+(?=$|[\\s:)])`.
- [ ] Probe in `paths-timing.test.mjs`: 200k-character lines of `'/a'.`, `'/a'.x`, `"'/a'" + '.'.repeat(n) + 'x'`, `" '/a'.,;}"` repeated; each < 1 s.
- [ ] Run both files, then `npm test` (foreground, exit 0).
- [ ] CHANGELOG line under Unreleased, doc comment update; commit.
