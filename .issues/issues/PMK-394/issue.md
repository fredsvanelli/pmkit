---
id: PMK-394
title: Resolve Jira status and type mappings in any viewer language
type: bug
status: backlog
priority: medium
estimate: 3
parent: EPC-14
related: [PMK-368]
milestone: jira
created: 2026-11-24T19:29:15.480Z
updated: 2026-11-24T19:29:18Z
---

## Description

Found live in PMK-368 on a Jira Cloud site whose token owner uses Portuguese. Jira shows status and work type names in the viewer's language: the same status is `Em análise` for a Portuguese user and `In Review` for an English one (`untranslatedName` keeps the English name; `Accept-Language` does not change it). `mappings.status` and `mappings.types` hold the shown name, and the Jira adapter compares mappings with the shown name, so a config written by one teammate breaks for a teammate whose Jira is in another language (a status mapping turns into a broken mapping, a type mapping into "no work type").

Evidence: `docs/superpowers/specs/2026-11-24-pmk-368-check-jira-setup-live-design.md`, Q3.

Options: resolve a status or type mapping against both the shown and the English name (the raw discovery keeps `untranslated` since PMK-368), or hold ids (an ADR, as ADR 0014 did for fields).

## Acceptance criteria

- [ ] A status or type mapping written in one Jira language resolves for a viewer in another language
- [ ] Setup and `discover` agree on which name a mapping holds, and the choice is recorded (an ADR if mappings move to ids)
