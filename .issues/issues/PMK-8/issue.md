---
id: PMK-8
title: Publish JSON Schemas for both config files
type: feature
status: backlog
priority: low
estimate: 3
parent: EPC-1
milestone: local-gaps
created: 2026-10-25T19:13:19Z
updated: 2026-10-25T19:13:19Z
---

## Description

Source: Technical spec, Config schemas ("The build exports both to JSON Schema, and `setup` adds a `# yaml-language-server: $schema=…` line at the top of each file").

## Acceptance criteria

- [ ] JSON Schemas for `.pmkit/config.yaml` and `.issues/config.yaml` ship with the plugin
- [ ] Setup writes the `$schema` line at the top of each file
- [ ] A test fails when a schema and its validator disagree
