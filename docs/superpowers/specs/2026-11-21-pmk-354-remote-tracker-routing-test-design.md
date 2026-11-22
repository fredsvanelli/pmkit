# PMK-354: test that every remote tracker routes the operations its adapters implement

## Problem

`createLinearTracker` and `createGithubTracker` build their contract from a hand-written `contract` map, then fill every missing operation with `implemented[operation] ?? stub(operation)`. If an operation is implemented by an adapter's `*-ops.mjs` module but missing from the map, it answers NOT_SUPPORTED (`the <adapter> adapter does not implement <op> yet`) with no error anywhere. PMK-353 hit this: `moveDeliverable` existed in both `project-ops.mjs` files but answered NOT_SUPPORTED until a contract case called it.

## Approaches

1. **Behavioural: call each implemented operation on a tracker over the fakes, and fail on the stub's refusal** (chosen). The ops modules are read by listing `scripts/lib/<system>/*-ops.mjs`, which picks up a new module with no edit to the test. Each exported `*Operations` factory is called with an inert proxy for its dependencies, to list the operation names it returns. For every name in `TRACKER_OPERATIONS`, the test calls the tracker's operation with no arguments. Any outcome passes except the stub's `NOT_SUPPORTED` "does not implement <op> yet". This tests what the user gets, through the same `guarded` wrapper, and it covers the Linear map's spreads (`...views`, the cycle names list) without parsing them.
2. Parse the `contract` object from `tracker.mjs` source. Brittle: Linear builds part of it with spreads and `Object.fromEntries`, and a regex would miss those.
3. Mark the stub function (`stub.notImplemented = true`) and check the flag. That changes how unimplemented operations are stubbed, which the issue rules out.

## Design

- New `scripts/lib/tracker-routing.test.mjs`, with one test per system:
  - `opsOperations(system)`: for each `*-ops.mjs` in `scripts/lib/<system>/` and each exported function whose name ends in `Operations`, the keys of `factory(inert)` that are in `TRACKER_OPERATIONS`, with the module they come from.
  - The tracker: GitHub over `fakeGithubIssues` with the contract test's config (scope, Project, every status mapped); Linear over `fakeLinearFetch` with the contract test's workspace.
  - For each operation: `await tracker[op]()` in a try. A caught `NOT_SUPPORTED` whose message matches `` `does not implement ${op} yet` `` is a miss. The test asserts the misses are `[]`, and the failure message names each operation with its module (`moveDeliverable (project-ops.mjs) is not routed by scripts/lib/github/tracker.mjs`).
- Nothing outside the test changes.

## Checks

- Passes on the current code.
- A throwaway edit that removes `moveDeliverable` from `scripts/lib/github/tracker.mjs` fails the GitHub test, naming `moveDeliverable`. Shown in the PR.

## Interview

- What if a factory needs a real dependency at construction? All 11 factories return their operations with the inert proxy (checked at `000c2c75`). One that threw would fail the test loudly, which is the right signal.
- Does calling every operation with no arguments write to the fakes? Some reach the body and fail on the missing input. The fakes are per-test and in memory, so nothing leaks.
- Linear operations that refuse by capability (goal reads, releases, customers) go through `stub(operation)`, which answers with the manifest hint when the capability is absent, not "does not implement". Probed at `4e6e3e2f`: on the fake workspace no Linear contract operation answers with the stub message. On GitHub, the 34 that do are all operations no `*-ops.mjs` module returns (releases, documents, views, goals, customers, notifications).
- New terms or ADRs: none.
- Approval: there is no product question and the acceptance criteria are exact.
