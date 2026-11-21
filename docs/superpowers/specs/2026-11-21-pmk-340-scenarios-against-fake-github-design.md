# PMK-340: run the scenario tests against the fake GitHub

Issue: PMK-340 (EPC-8, chore). Found while working PMK-90 (PR #313).

## Intent

The command scenarios (`scripts/scenarios.test.mjs`, `scripts/__scenarios__/`, rules in `docs/superpowers/specs/2026-10-25-pmk-10-command-scenarios-design.md`) check that a command file's steps call the CLI the way the file says. They can run a Local tracker, a Linear tracker over a fake fetch, and the old PR-only fake `gh` (`scenario.github`). They cannot run a GitHub Issues tracker, so `github-discussions.mjs` covers only "stops at step 1 on Local" and skips every GitHub call. Give the scenario helper the stateful fake GitHub, and cover the discussions command on it.

## Today

- `prepareCopy` in `scripts/scenario-helpers.mjs` sets up the copy; `scenario.github` turns the git host to github and puts `fakeGh` (`scripts/fake-gh.mjs`, canned PR answers) on `PATH`.
- `scripts/fake-gh-path.mjs` (`statefulGhOnPath`, `statefulGhCalls`) puts a `gh` on `PATH` that answers through the stateful fake GitHub and keeps its state in a fixture file between runs. The runbook tests use it; `scripts/runbook-setup-github.test.mjs` still has its own copy (`fakeGhOnPath`, `calls`), the same code.

## Goals, non-goals, anti-goals

- Goal (criterion 1): a scenario can declare a GitHub Issues tracker backed by the stateful fake `gh`.
- Goal (criterion 2): a GitHub scenario covers `/pmkit:github:discussions` (list, get, create the issue, comment back), with no skipped call.
- Goal (criterion 3): `runbook-setup-github.test.mjs` uses `scripts/fake-gh-path.mjs`.
- Non-goal: moving other GitHub commands' scenarios (draft-issues, issues, cycles) onto it; each can follow later with the same option.
- Anti-goal: a scenario that reaches the network, or a snapshot that holds the token or a scratch path.

## Approaches

1. **A `githubTracker` scenario option (chosen).** `githubTracker: { seed(github) }`: `prepareCopy` makes an empty repo (no fixture copy), `git init`, builds `fakeGithubIssues()`, lets `seed` add discussions, puts `statefulGhOnPath({ meta: null, issues: github.toJSON() })` first on `PATH` with a fake `GH_TOKEN`, and runs the same `init --tracker github ...` the runbook tests run (acme/widgets, Project acme/7). The snapshot lists the GraphQL operation names the fake `gh` received (from `statefulGhCalls`), not the bodies. The Local entry of `github-discussions.mjs` stays (it covers step 1's stop); a second entry runs on GitHub.
2. **Extend `scenario.github` to also mean the tracker.** It already means "the git host is GitHub with canned PR answers"; overloading it changes every existing GitHub scenario's snapshot. Rejected.
3. **In-process runner with an injected exec, like `linearRunner`.** No child process, but the GitHub client takes `exec` only through the adapter descriptor, and the runbook tests already prove the PATH fake works with the real CLI. More code. Rejected.

## Design

- `scripts/scenario-helpers.mjs`: the `githubTracker` branch in `prepareCopy`; `makeRepoView` gets `githubCalls()` (operation names); `formatSnapshot` prints them like `ghCalls`. The init arguments move from `runbook-discussions-github.test.mjs` into one exported constant if two files need them (left to the builder).
- `scripts/__scenarios__/github-discussions.mjs`: a GitHub entry following `commands/github/discussions.md` steps 1 to 8 with the confirmation points; the Local entry keeps the stop. Snapshot `github-discussions.1.after.txt` (the existing one becomes `.0.`).
- `scripts/runbook-setup-github.test.mjs`: imports `statefulGhOnPath` and `statefulGhCalls`, deletes its copies.

## Tests

- `scripts/scenario-helpers.test.mjs`: a `githubTracker` scenario prepares a copy whose `capabilities` reports the github tracker, and whose `gh` is the fake (no network).
- `scripts/scenarios.test.mjs` runs the new entry (rules 5 to 12).
- `runbook-setup-github.test.mjs` passes unchanged in what it asserts.

## Left to the builder

Names; where the init arguments live.

## Interview

Approved on 2026-11-21 by the pmkit PO on the owner's behalf: the issue's acceptance criteria and this design, with no open product question. The questions the grilling raised and the answers taken (the recommended ones):

- Only the discussions command gets a GitHub scenario now; draft-issues and the others can follow with the same option: yes, the issue names discussions.
- The snapshot lists the GraphQL operation names the fake `gh` received, not the request bodies: yes, bodies hold node ids that change with the seed.
- No new term for `CONTEXT.md` and no ADR.
