---
id: PMK-169
title: Make pmkit a Linear agent
type: feature
status: backlog
priority: low
estimate: 5
related: [PMK-28]
created: 2026-10-29T02:47:14.498Z
updated: 2026-10-29T02:47:14Z
---

## Description

pmkit uses a personal API key today (ADR-0005), so every write shows up in Linear as the key's owner and pmkit cannot be assigned an issue. Linear lets an OAuth app act as an agent (`actor=app` with the `app:assignable` scope), which would let people assign or mention pmkit in Linear.

This needs its own epic. It adds an OAuth app with PKCE, a stored token and refresh, a callback port, a registered app, an admin install and a revisit of ADR-0005 and its security rules. The first step is a design spec that answers PMK-28 Q2: which agent actions pmkit serves, where the token lives, and how the key and the app coexist. Create the epic and split the work from that spec.

Source: PMK-28 Q2, ADR-0005 "Considered options" (OAuth app with PKCE).

## Acceptance criteria

- [ ] A design spec names the agent actions pmkit serves and the token storage, and states how ADR-0005 changes
- [ ] The spec is reviewed and the user decides whether to build it
- [ ] A new epic holds the implementation issues, each linked to this one
