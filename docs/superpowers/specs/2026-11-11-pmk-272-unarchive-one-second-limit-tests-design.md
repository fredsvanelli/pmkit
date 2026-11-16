# PMK-272: pin the one-second unarchive history limit with a test

## Intent

PMK-267 (PR #219) made the event replay collapse a whole merged archive, unarchive, archive, unarchive run made within one second. That rule has a known ceiling, marked with a `ponytail:` comment in `scripts/lib/local/events.mjs` (around line 58): a real run of two equal halves in one second, such as four real flips with no merge, reads as a merge copy and shows two events. The final state is the same. No test fixes the ceiling, so a later change could alter it unnoticed. This issue only adds tests. It changes no behaviour.

## Goals

1. A test fixes the ceiling: four real flips (archive, unarchive, archive, unarchive) in one second, without a merge, show as two events and leave the issue unarchived. It is checked both on the event replay (unit) and through the CLI with real `issues archive` and `issues unarchive` calls, reading `issues get --history`.
2. A test fixes that `issues bulk unarchive --limit` on the Local tracker answers `INVALID_INPUT` because of the limit.

## Non-goals

- Sub-second timestamps in events (out of scope in the issue).
- Any change to `parseEvents`, to the bulk code, or to the `ponytail:` comment's ceiling.
- The Linear check order (`cli-bulk-linear.test.mjs` already covers `NOT_SUPPORTED` with `--limit`).

## Anti-goals

- A test that passes whatever the code does. Each new test must fail if the rule it names is removed (checked by a temporary mutation during implementation).

## What exists today

- `scripts/events.test.mjs:60` covers a merge that repeats the four-flip run made within one second (8 lines in, 4 events out). It does not cover one run of four flips.
- `scripts/cli-bulk.test.mjs:475` ("bulk unarchive without --archived or with a limit is INVALID_INPUT") checks only the code. On the Local tracker, `--limit` does not reach `scripts/lib/bulk.mjs`: the flag parser rejects it first with `unknown option --limit for issues bulk`, code `INVALID_INPUT`. (An earlier draft of this spec said the refusal came from `bulk.mjs:104`; a run of the tightened test showed that was wrong.) The test does not check the message, so it would also pass for a different `INVALID_INPUT`.

## Design

1. `scripts/events.test.mjs`: new test. Write one run of archive, unarchive, archive, unarchive, all at the same `at`, and read it with `readEvents`. Expect ops `['archive', 'unarchive']` and `replay(events).archived` to be `undefined`. Name it with PMK-272 and the ceiling.
2. `scripts/cli-bulk.test.mjs`: new test after the PMK-250 test, using `withRepo` and `ok`. The `ENV` already pins `PMKIT_NOW`, so all four commands share one second. Run `issues archive`, `issues unarchive`, `issues archive`, `issues unarchive` on one issue. Expect `issues get --history --json` to have exactly two archive or unarchive ops in order, and `issues get` to show the issue active (listed by `issues list`).
3. `scripts/cli-bulk.test.mjs:475`: tighten the existing assertion to also match `/unknown option --limit for issues bulk/` on the message. No new test for criterion 2.

## Calls made without a user

- Criterion 2 is pinned by tightening the existing test, not by adding a second one. Reason: the behaviour is already covered, and a duplicate would only repeat the same check.
- The CLI test uses the real commands, not a hand-written file, because the issue says "real archive, unarchive".
- The ceiling is asserted as current behaviour, with a message that says so. If a later change makes four real flips show as four, that test must change on purpose.

## Verification

- `node --test scripts/events.test.mjs` and `node --test scripts/cli-bulk.test.mjs` pass.
- Temporary mutation: disable the equal-halves drop in `parseEvents` and confirm the new unit test fails; then restore. Criterion 2 is pinned by the message assertion only; no mutation is run for it, because the refusal is the flag parser's, not `bulk.mjs`.
- `npm test` in the foreground exits 0.
