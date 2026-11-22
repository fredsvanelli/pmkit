---
id: PMK-360
title: Run the migration branch of /pmkit:local:doctor in a scenario
type: chore
status: backlog
priority: low
parent: EPC-12
related: [PMK-156]
created: 2026-11-22T05:53:35.917Z
updated: 2026-11-22T05:53:36Z
---

## Description

Found in PMK-156 (PR #358). `/pmkit:local:doctor` step 3 now settles `migration` problems before any CLI fix: a missing migration sends the user to `/pmkit:upgrade`, and a failing step shows its reason. Only static tests in `scripts/scenarios.test.mjs` pin that text. The scenario harness runs the shipped `MIGRATIONS`, which never fail on the fixtures, and has no way to inject a failing or missing migration, so no flow test drives the branch. The CLI side is covered by `scripts/migrations.test.mjs`.

## Acceptance criteria

- [ ] A doctor scenario (or a runbook test) runs `/pmkit:local:doctor` on a tracker whose migration fails, and checks that no CLI fix runs before the problem is settled
- [ ] The same for a missing migration, which ends with `/pmkit:upgrade`
