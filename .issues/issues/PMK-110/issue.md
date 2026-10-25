---
id: PMK-110
title: List pmkit in the fredsvanelli/skills marketplace
type: chore
status: in_review
priority: high
estimate: 1
assignee: fred
parent: EPC-1
related: [PMK-1]
milestone: local-gaps
branch: pmk-110-list-pmkit-in-the-fredsvanelli-skills
created: 2026-10-25T20:11:40.644Z
updated: 2026-10-25T20:28:23Z
---

## Description

The README installs pmkit with `claude plugin marketplace add fredsvanelli/skills` and `claude plugin install pmkit@fredsvanelli`, but `fredsvanelli/skills/.claude-plugin/marketplace.json` lists only `runbooks` and `utils`. Since commit 5c39154 pmkit lives in its own repository, so the entry needs a `github` source.

## Acceptance criteria

- [ ] `fredsvanelli/skills/.claude-plugin/marketplace.json` has a `pmkit` entry with `"source": { "source": "github", "repo": "fredsvanelli/pmkit" }`
- [ ] `claude plugin install pmkit@fredsvanelli` installs pmkit after `claude plugin marketplace add fredsvanelli/skills`
- [ ] `/pmkit:upgrade` finds the latest version through the `github` source
