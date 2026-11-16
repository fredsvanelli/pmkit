---
id: PMK-260
title: Show and set several Linear releases per issue
type: feature
status: backlog
priority: low
estimate: 3
parent: EPC-5
created: 2026-11-11T22:34:42.770Z
updated: 2026-11-11T22:34:42Z
---

## Description

### Context

A Linear issue can be in several releases, one per release pipeline (for example iOS and Android). PMK-246 chose one release per issue (decision PMK-246-1, option A): with two or more, `issues get` shows `releases` in the JSON only, and `issues update --release` and `issues bulk release` refuse. The cycle 3 review also found that the text output shows no release line for such an issue. Source: PMK-246, PR #208.

### Scope (in)

- The text output of `issues get` and lists shows every release of an issue.
- `--release none` clears every release of an issue, even when it has two or more.
- `--release <id>` replaces only the release of the same pipeline and keeps the releases of other pipelines (option B of PMK-246-1).

### Out of scope

- Creating or marking releases (its own issue).

### Tasks

- [ ] Show every release of a Linear issue in the text output
- [ ] Clear all releases of an issue with `--release none`
- [ ] Set a release per pipeline without touching the others

## Acceptance criteria

- [ ] `issues get` in text shows each release of a Linear issue that is in two releases
- [ ] `issues update --release none` clears an issue that is in two releases
- [ ] `issues update --release <id>` on an issue in releases of two pipelines changes only the release of that id's pipeline
- [ ] `issues bulk release` follows the same rule, with the same preview
