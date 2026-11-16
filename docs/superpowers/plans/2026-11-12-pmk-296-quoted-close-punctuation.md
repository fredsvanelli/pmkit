# PMK-296 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline).

**Goal:** a quoted path closes before `.`, `,`, `;`, `}` when what follows ends the path.
**Architecture:** `QUOTED_CLOSE` keeps the PMK-284 rule (`]`/`>` runs). A new sticky `PUNCT_CLOSE` matches a run of `] > . , ; }` before `$`, space, `:` or `)`; the closer loop accepts it only when `indexOf(quote, close + 1)` finds no quote before the line end. Two quotes of one kind on a line fall back to the old rule.
**Tech Stack:** Node 22, `node:test`.
**Spec:** `docs/superpowers/specs/2026-11-12-pmk-296-quoted-close-punctuation-design.md`

## Global Constraints
- Linear time (PMK-288). Commits carry `(PMK-296)` and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
- `'/Users/x/a', b/c'`, `"/Users/x/a"} y/z"`, `'/Users/x/a'. b c/d'` hide everything; `'/a'.,;}` runs and `'/a'.]` close when no other quote follows.
- `'/Users/x/a'. Don't retry` stays hidden to the end (another quote of the kind); another kind of quote does not count; the rest of the line only.

### Task 1: Rule, tests, probe, docs
**Files:** Modify `scripts/lib/paths.mjs` (QUOTED_CLOSE, header doc), `scripts/paths.test.mjs`, `scripts/paths-timing.test.mjs`, `CHANGELOG.md`.
- [ ] Test first in `paths.test.mjs`: `hideAbsolutePaths("'/Users/x/a'. next") === "'<path>'. next"`; `"Cloning into 'file:///x/y'..."` -> `"Cloning into 'file:<path>'..."`; each of `. , ; }` with a following word; `"'/Users/x/a'.b c/d'"` and the other three characters show no `Users`, `a'`, `b c`, `d`; `'/x y'.x` unclosed -> `'<path>`; the reviewer's three cases; `'/a', 'b'` -> `'<path>'`; `Don't retry`.
- [ ] Run `node --test scripts/paths.test.mjs`: new tests FAIL.
- [ ] Add `PUNCT_CLOSE` (`quote[\\]>.,;}]+(?=$|[\\s:)])`, sticky) and accept it in the closer loop only when `text.indexOf(quote, close + 1)` is `-1` or at or after the line end.
- [ ] Probe in `paths-timing.test.mjs`: 200k-character lines of `'/a'.`, `'/a'.x`, `"'/a'" + '.'.repeat(n) + 'x'`, `" '/a'.,;}"` repeated; each < 1 s; a second probe with many quotes (`'/a', `, `'/a'. 'b' `, `'/a ` + `'. ` repeated, one quote per line).
- [ ] Run both files, then `npm test` (foreground, exit 0).
- [ ] CHANGELOG line under Unreleased, doc comment update; commit.
