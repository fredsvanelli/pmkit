---
id: PMK-219
title: Find more TODOs in todos-to-issues
type: feature
status: in_progress
priority: low
estimate: 5
assignee: fred
related: [PMK-64, PMK-238]
branch: pmk-219-find-more-todos-in-todos-to-issues
created: 2026-11-08T20:37:24.030Z
updated: 2026-11-10T07:19:17Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-64 (todos-to-issues) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-64. Split into this issue and PMK-238.

### Scope (in)

- More tags, such as `HACK` and `XXX`.
- A full comment parser per language: comments in `<script>` and `<style>` of html and vue, a lone quote that hides a comment, `@todo`, Python docstrings.
- The warning about unread file types is noisy (425 files in this repository, 372 of them `.txt`).

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [x] More tags, such as `HACK` and `XXX`
- [x] A full comment parser per language: comments in `<script>` and `<style>` of html and vue, a lone quote that hides a comment, `@todo`, Python docstrings
- [x] The warning about unread file types is noisy (425 files in this repository, 372 of them `.txt`)
