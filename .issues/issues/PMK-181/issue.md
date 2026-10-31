---
id: PMK-181
title: Fix parseDelegation on trailing spaces and the delegate identity text
type: bug
status: backlog
priority: medium
estimate: 1
related: [PMK-57]
created: 2026-10-31T16:01:17.026Z
updated: 2026-10-31T16:01:17Z
---

## Description

### Context

`/pmkit:issues:delegate` (PMK-57) merged with these defects, found by the review of PR #87. PMK-58 (track-agents) reads the delegation record. Source: PMK-57, PR #87.

### Scope (in)

- `scripts/lib/delegation.mjs:33`: `parseDelegation` returns `null` when the first line ends with a space or the body has an unnormalized `\r`. `listComments` normalizes, so the CLI path works today, but any other reader fails. Use `split(/\r?\n/)[0].trimEnd()`.
- `commands/issues/delegate.md:27` and the delegation comment say the claim, the branch and the PR are "the agent's". `--as` only changes the actor of the tracker events; commits and the GitHub PR keep the user's identity.
- `scripts/contract.test.mjs`: the setup adds `agent:claude`, which sorts first, so the contract `assign` test now assigns the agent and no longer covers a person.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] `parseDelegation` reads a first line with trailing spaces or `\r\n`
- [ ] The command and the comment say which identity the commits and the PR use
- [ ] The contract `assign` test assigns a person again
