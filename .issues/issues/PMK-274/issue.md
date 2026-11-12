---
id: PMK-274
title: Stop step 2 of record-decision from keeping the old ref for the Supersedes line
type: chore
status: in_progress
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-274-stop-step-2-of-record-decision-from
created: 2026-11-12T02:12:43.326Z
updated: 2026-11-12T02:19:55Z
---

## Description

### Context

PMK-270 made `/pmkit:spec:record-decision` write the `Supersedes:` line from `supersedesRef`, read in step 4 with `docs adr-get --from`. Step 2 still tells the agent to keep the old ADR's `ref` and explains its `../...` form, which step 4 then tells it not to use. The review of PMK-270 left it as a follow-up. Source: PMK-270, PR #224.

### Scope (in)

- Step 2 of `commands/spec/record-decision.md` keeps `number` and says what `ref` is still used for, without suggesting it goes into the `Supersedes:` line.
- No rule of the command file is lost (`scripts/plugin.test.mjs` and the `spec-record-decision` scenario still pass).

### Out of scope

- The CLI output of `docs adr-get`.

### Tasks

- [ ] Rewrite the `ref` sentence of step 2

## Acceptance criteria

- [ ] Step 2 no longer tells the agent to keep `ref` for the Supersedes line, and steps 2 and 4 agree on what the line cites
- [ ] The plugin test and the record-decision scenario pass
