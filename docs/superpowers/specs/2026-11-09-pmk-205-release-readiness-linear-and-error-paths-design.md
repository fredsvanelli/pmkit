# PMK-205: Fix the Linear and error paths of release readiness

Source: PMK-69, PR #115. Code: `runReleaseReadiness` in `scripts/pmkit.mjs`, `scripts/lib/release-readiness.mjs`, `listDeploys` in `scripts/lib/github/host.mjs`, `readinessText` in `scripts/lib/format.mjs`.

No questions were asked: the issue lists the six defects and four acceptance criteria. The calls below are mine.

## Goals

1. `--release`, `--milestone` and `--sprint` work on Linear with releases on. They read only what their basis needs, so the `listReleases` stub (NOT_SUPPORTED on Linear) is never called for a selector.
2. A transient read error (`RATE_LIMITED`, `UPSTREAM`) of `currentCycle`, `listMilestones` or `listReleases` marks the result incomplete (`problems`, `complete: false`, `ready: null`, a warning, a `skipped` reason `*_not_read`) and does not abort when the other rungs can still pick a basis. A selector skips these reads, so they cannot abort it.
3. On the automatic pick, a Linear `listReleases` NOT_SUPPORTED (the stub) is "not read" the same way: incomplete, never "no planned release".
4. `--sprint current` on a tracker without cycles answers `NOT_SUPPORTED` ("this tracker has no cycles") with the capability's next step, not `INVALID_INPUT`. With cycles on and no active sprint it stays `INVALID_INPUT`.
5. A basis with no issues is never `ready: true`. `ready` is `null`, and the report has `empty: true` so the agent and the text say why. (My call: applies to every basis, not only releases; an empty milestone or sprint is as vacuous.)
6. The deploy of a release's tag is found even when it is older than the 20 newest. For a release with a `tag`, the CLI also asks GitHub for the deployments whose ref is `<tag>` and `refs/tags/<tag>` (`listDeploys({ ref })`, the API's `ref` filter, limit 100), merges them with the newest 20 by id and sorts newest first.
7. A deploy ref `refs/tags/<tag>` matches the release's tag like `<tag>` does.

## Non-goals

- The improvements in `docs/superpowers/epc-6-follow-ups.md`.
- Implementing `listReleases` on Linear.
- Reading more than 200 pull requests.

## Behaviour when nothing can be picked

If no basis is found and at least one rung was not read, the command rethrows the first read error (so a rate limit is a rate limit, not "nothing to check"). With every rung read, `INVALID_INPUT` stays.

## Files

`release-readiness.mjs` (`unread` input, `empty`, ref match), `format.mjs` (skip texts, empty verdict), `host.mjs` (`ref` filter), `pmkit.mjs` (lazy reads, tolerant reads, ref deploys), `commands/report/release-readiness.md`, README/SKILL only if they list the skip reasons, CHANGELOG, tests.
