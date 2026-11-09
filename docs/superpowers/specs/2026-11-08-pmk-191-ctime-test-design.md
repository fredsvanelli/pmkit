# PMK-191: make the ctime test of query-index stable

## Intent

`scripts/query-index.test.mjs` has tests that depend on the kernel's file ctime. One failed now and then under
a full parallel run during the rebases of PR #99 and passed on the next run. The goal is a query-index test file
that does not depend on the clock, while keeping what it checks: a same-size edit whose mtime was restored must
be caught, because the index signature includes ctime.

## Goals

- The whole query-index test file is deterministic with respect to ctime: no test's outcome depends on the
  kernel's ctime granularity or on the wall clock.
- The production behavior is unchanged: the signature is still `size, mtimeMs, ctimeMs, ino`, and the tracker
  reads it with the real `signature` unless a test injects another.

## Non-goals

- Changing the racy-entry rules in `scripts/lib/local/query-index.mjs`.
- Reproducing the flake. It did not reproduce here (macOS, ctime with nanosecond resolution), not in 24 parallel
  runs of the file nor under 12 CPU burners. The cause is inferred: the tests needed a ctime change that a
  coarse-clock filesystem may not give.
- Testing that the real `signature` sees a kernel ctime change. The test file no longer does that; the production
  code still reads the real ctime, and the file-signature key test (`sig` keys) still pins its shape.

## Anti-goals

- A fix that only adds sleeps or retries to the tests. That still depends on the clock.
- Mocking `fs` globally. That would hide the real wiring.

## Decisions (my call, no user input)

1. **Inject the signer into the read.** `readThroughIndex` takes an optional `sign` argument, defaulting to
   `signature`. The local tracker takes the same optional `sign` option and passes it through; it is `undefined`
   in production, so the default applies.
2. **Split the named test.** The size-change half (edit A, which changes size, reparses only A) stays on the real
   filesystem: a size change does not depend on the clock. The same-size half moves to a deterministic test with
   a fake signer that returns a changed ctime, with size, mtime and inode held equal.
3. **Run the whole `runStates` matrix on the same signer.** `runStates` builds one signer per run. Its `ctimeMs`
   is 0 for every file until the test bumps a file; a bump sets the ctime to a new count. Each edit that must
   change ctime bumps the file, so the same-size step is detected by ctime alone. Every tracker and index read
   in the run uses that signer, so the index stays consistent between reads.
4. **Remove `tick()`.** Nothing waits for the kernel clock any more.
5. **Keep the real-clock racy tests.** Two tests set the index mtime to the file's ctime plus one second, which is
   racy by construction. They do not depend on the ctime granularity and stay as they are.

## Acceptance

- No test in `scripts/query-index.test.mjs` waits on, or relies on, the kernel's ctime (no `tick`, busy wait or
  ctime comparison for the ctime-only half).
- With the ctime bump disabled, the `runStates` tests fail (checked by mutation).
- `node --test scripts/query-index.test.mjs` passes 10 runs in a row for this change; 20 in a row for the PMK-191
  issue acceptance.
- `npm test` exits 0 in the foreground.
