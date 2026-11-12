---
id: PMK-270
title: Write a Supersedes line a reader of the tracker can follow
type: bug
status: in_progress
priority: medium
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-270-write-a-supersedes-line-a-reader-of-the
created: 2026-11-12T00:43:33.054Z
updated: 2026-11-12T00:56:26Z
---

## Description

### Context

PMK-268 made `docs adr-status --by` write a path relative to the ADR that holds it when both ADRs are in a tracker outside the repository. `/pmkit:spec:record-decision` still writes the `Supersedes:` line from the `ref` of `docs adr-get`, which is the path from the repository root (`../<tracker>/docs/adr/...`). The review of PMK-268 recommended its own issue. Source: PMK-268, PR #220.

### Scope (in)

- With the new ADR and the replaced ADR both in a tracker outside the repository, the pair gets two different bases: the old ADR says `superseded by 0003-x.md`, the new one says `Supersedes: ADR 0001, ../outside/docs/adr/0001-a.md`, which a reader of the tracker alone cannot open (`commands/spec/record-decision.md`, step 4; `refFolder` in `scripts/lib/adr.mjs:58`).
- The `Supersedes:` line follows the same rule as `--by`: relative to the ADR that holds it when both are in the tracker outside the repository, from the repository root in the other cases.

### Out of scope

- ADRs inside the repository, which already resolve from the repository root.

### Tasks

- [ ] Give record-decision a reference relative to the new ADR
- [ ] Write the Supersedes line with it

## Acceptance criteria

- [ ] With both ADRs in a tracker outside the repository, the `Supersedes:` line of the new ADR resolves from the folder of the new ADR, with a test
- [ ] The `Supersedes:` line and the `superseded by` mark of the old ADR use the same base
- [ ] ADRs inside the repository keep the path from the repository root
