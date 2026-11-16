# PMK-309 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm test` asks for the TAP reporter when stdout is not a terminal, and leaves the reporter alone in a terminal.

**Architecture:** An exported pure function `testArgs(isTTY)` in `scripts/run-tests.mjs` builds the `node --test` arguments. The entry block passes it `process.stdout.isTTY === true`. Nothing else in the runner changes.

**Tech Stack:** Node.js built-in test runner (`node:test`), `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-11-13-pmk-309-tap-reporter-when-piped-design.md`

## Global Constraints

- Reporter flag, verbatim: `--test-reporter=tap`, added only when `isTTY` is not `true`.
- Argument order: `--test`, optional reporter, then the glob `scripts/**/*.test.mjs`.
- Do not change `findLeaks`, `childEnv`, `finish`, or any test's assertions. Do not touch the PMK-301 child runs.

## Review Focus

- Piped stdout where `process.stdout.isTTY` is `undefined` (not `false`) must still get the TAP reporter. Covered by coercing with `=== true` and by the `testArgs(false)` test.

---

### Task 1: `testArgs` builds the runner arguments

**Files:**
- Modify: `scripts/run-tests.mjs` (add export after `finish`; change the entry block at the bottom)
- Test: `scripts/run-tests.test.mjs` (add import and two tests)

**Interfaces:**
- Produces: `export function testArgs(isTTY: boolean): string[]`. Returns `['--test', '--test-reporter=tap', 'scripts/**/*.test.mjs']` when `isTTY` is false, and `['--test', 'scripts/**/*.test.mjs']` when true.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing tests**

Add `testArgs` to the existing import from `./run-tests.mjs` in `scripts/run-tests.test.mjs`, then append:

```js
test('testArgs asks for the TAP reporter when stdout is not a terminal', () => {
  assert.deepEqual(testArgs(false), ['--test', '--test-reporter=tap', 'scripts/**/*.test.mjs'])
})

test('testArgs leaves the reporter alone in a terminal', () => {
  assert.deepEqual(testArgs(true), ['--test', 'scripts/**/*.test.mjs'])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/run-tests.test.mjs`
Expected: FAIL, because `testArgs` is not exported (import error or `testArgs is not a function`).

- [ ] **Step 3: Implement `testArgs` in `scripts/run-tests.mjs`**

Add after `finish`:

```js
/** Returns the node --test arguments: the TAP reporter only when stdout is not a terminal. */
export function testArgs(isTTY) {
  return ['--test', ...(isTTY ? [] : ['--test-reporter=tap']), 'scripts/**/*.test.mjs']
}
```

Change the entry block so the spawn line reads `spawnSync(process.execPath, testArgs(process.stdout.isTTY === true), { ... })` in place of the inline array. Leave `stdio`, `cwd`, `env` and the `finish` call as they are.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/run-tests.test.mjs`
Expected: PASS, all tests in the file, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-tests.mjs scripts/run-tests.test.mjs
git commit -m "fix(tests): keep npm test output in TAP when piped (PMK-309)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
