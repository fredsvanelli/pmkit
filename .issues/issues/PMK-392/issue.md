---
id: PMK-392
title: Check a scoped Jira token on the site host
type: chore
status: backlog
priority: low
parent: EPC-14
related: [PMK-364]
created: 2026-11-24T18:26:04.106Z
updated: 2026-11-24T18:26:09Z
---

## Description

Follow-up from PMK-364. The opt-in live check `scripts/lib/jira/client-live.mjs` has a scoped-token test, skipped in PMK-364 because no token known to be scoped existed (the owner's token behaves as classic).

Run it with a scoped token:

- The owner creates a scoped API token at id.atlassian.com ("Create API token with scopes", Jira read scopes such as `read:jira-user`, `read:jira-work`) and puts it in the env block of the main checkout's git-ignored `.claude/settings.local.json` as `ATLASSIAN_SCOPED_API_KEY`.
- Load it at run time into `PMKIT_LIVE_JIRA_SCOPED_TOKEN` (never print it), with `PMKIT_LIVE=1`, `PMKIT_LIVE_JIRA_SITE`, `JIRA_EMAIL` and `JIRA_API_TOKEN` as in PMK-364, and run `node --test scripts/lib/jira/client-live.mjs`.
- If the scoped token fails on the site host, write the ADR that decides the `api.atlassian.com/ex/jira/<cloudId>` path (ADR 0013).

## Acceptance criteria

- [ ] A scoped token is checked on the site host with client-live.mjs
- [ ] An ADR decides the api.atlassian.com/ex/jira/<cloudId> path if it fails
