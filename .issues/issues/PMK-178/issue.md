---
id: PMK-178
title: "Fix unblock-pr when checks, reviews or scopes cannot be read"
type: bug
status: backlog
priority: high
estimate: 2
related: [PMK-62]
created: 2026-10-31T16:01:12.578Z
updated: 2026-10-31T16:01:13Z
---

## Description

### Context

`pr blockers` and `/pmkit:issues:unblock` (PMK-62) merged with these defects, found by the fourth review of PR #89. None of them gives `blocked: false` while GitHub refuses the merge, but the text contradicts the verdict. Source: PMK-62, PR #89.

### Scope (in)

- `scripts/lib/pr-blockers.mjs:103` and `:189`: when the read of the checks is refused, the required checks are not evaluated and the text says `policies: all met`. With `BLOCKED`, the text blames a rule the command does not read, when the cause is the unread check.
- `pr-blockers.mjs:100`: the same happens when the reviews are refused, because the required-approvals rule does not run.
- `scripts/lib/github/host.mjs:168`: `INSUFFICIENT_SCOPES` and a SAML refusal are not classified as refusals, so they stop the whole command instead of marking the area `unchecked`.
- `pr-blockers.mjs:124`: a `CHANGES_REQUESTED` from one author blocks whenever the protection requires reviews, even with `reviewDecision: APPROVED`, and a required count of 0 counts as required.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] With checks or reviews unread, the policies line says they were not checked, and `BLOCKED` names them as a possible cause
- [ ] `INSUFFICIENT_SCOPES` and SAML refusals mark the area `unchecked`
- [ ] `reviewDecision: APPROVED` and a required count of 0 do not make a change request blocking
