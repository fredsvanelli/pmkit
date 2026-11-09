# PMK-191: make the ctime test of query-index stable

## Intent

`scripts/query-index.test.mjs` has a test that depends on the kernel's file ctime. It failed now and then
under a full parallel run during the rebases of PR #99 and passed on the next run. The goal is a test that
does not depend on the clock, while keeping the behavior it checks: a same-size edit whose mtime was
restored must be caught, because the index signature includes ctime.

## Goals

- The test "an edit reparses that file only, and a same-size edit with the mtime restored is caught by ctime"
  no longer waits on, or relies on, the kernel's ctime granularity.
- The production behavior is unchanged: the signature is still `size, mtimeMs, ctimeMs, ino`.

## Non-goals

- Changing the signature or the racy-entry rules in `scripts/lib/local/query-index.mjs`.
- Removing the real-filesystem coverage of ctime in `runStates`. It already waits for a tick through `tick()`;
  it stays as is. If it ever flakes, it gets its own issue.
- Reproducing the flake. It did not reproduce here (macOS, ctime with nanosecond resolution), not in 24
  parallel runs of the file nor under 12 CPU burners. The cause is inferred: the test needs a ctime change
  that a coarse-clock filesystem may not give.

## Anti-goals

- A fix that only adds sleeps or retries to the test. That still depends on the clock.
- Mocking `fs` globally. That would hide the real wiring.

## Decisions (my call, no user input)

1. **Inject the signer.** `readThroughIndex` takes an optional `sign` argument, defaulting to `signature`.
   The tracker does not pass it, so production is unchanged. The test passes a fake signer.
2. **Split the named test.** The first half (edit A, which changes size, reparses only A on the real
   filesystem) stays: size changes do not depend on the clock. The second half (same size, pinned mtime,
   ctime change only) moves to a deterministic test that uses the fake signer to return a changed ctime.
   The real-filesystem ctime path is still covered by `runStates`.
3. **Keep the test name** for the combined test, or rename it to name the two parts. Renamed, to say what is
   checked: the name no longer claims the real kernel clock detects the edit.

## Acceptance

- The named test no longer contains `Date.now()`, a busy wait or a `utimesSync` pin for the ctime half.
- `node --test scripts/query-index.test.mjs` passes 20 runs in a row.
- `npm test` exits 0 in the foreground.
