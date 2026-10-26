---
id: PMK-8
title: Publish JSON Schemas for both config files
type: feature
status: in_review
priority: low
estimate: 3
assignee: fred
parent: EPC-1
milestone: local-gaps
branch: pmk-8-publish-json-schemas-for-both-config
created: 2026-10-25T19:13:19Z
updated: 2026-10-26T01:04:31Z
---

## Description

Source: Technical spec, Config schemas ("The build exports both to JSON Schema, and `setup` adds a `# yaml-language-server: $schema=…` line at the top of each file").

## Acceptance criteria

- [ ] JSON Schemas for `.pmkit/config.yaml` and `.issues/config.yaml` ship with the plugin
- [ ] Setup writes the `$schema` line at the top of each file
- [ ] A test fails when a schema and its validator disagree
