# PMK-175 npm audit through the shell on Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pmkit alerts list` runs `npm audit` through the shell on Windows, and a missing npm there still reports `npm is not installed or not on PATH`.

**Architecture:** The npm audit scanner in `scripts/lib/alerts.mjs` receives the platform and the spawn function as injected options, defaulting to `process.platform` and `spawnSync`. On `win32` it passes `shell: true`. A "not recognized" failure from the shell maps to the missing-npm message. Tests inject a fake spawn and a `win32` platform, so they run on Linux.

**Tech Stack:** Node 22, `node:test`, `node:child_process`.

**Spec:** `docs/superpowers/specs/2026-10-31-pmk-175-npm-audit-windows-shell-design.md`

## Global Constraints

- The arguments of the npm audit call stay fixed: `audit`, `--json`.
- Non-Windows spawn options stay as they are, with `shell: false`.
- The message for a missing npm is exactly `npm is not installed or not on PATH`.
- The CHANGELOG line goes under `## Unreleased`.
- No new dependency.

## Review Focus

1. A Windows `cmd.exe` in another display language prints a different "not recognized" text, so the warning shows the raw shell message. Pinned by a test that the match is case-insensitive and that the non-matching text falls through to the generic error. The localized case is a follow-up.
2. npm found and exits 1 with vulnerabilities on Windows, stdout is valid JSON. The result must parse normally and not become a missing-npm warning. Pinned by a Windows-simulated test with `status: 1`, real JSON stdout and empty stderr.
3. A missing npm on Linux still reports `npm is not installed or not on PATH` through `ENOENT`. Pinned by the existing CLI test "a missing npm is a warning, not a failure", which must still pass.
4. A timeout on Windows: `result.error` with `ETIMEDOUT` must still produce the timeout warning, not the missing-npm message. Pinned by a Windows-simulated test with `error: { code: 'ETIMEDOUT' }`.
5. `npm.cmd` on Windows with an unrelated stderr from a failed audit (for example a registry error) must not be read as missing npm. Pinned by a Windows-simulated test with `status: 1`, empty stdout and stderr `npm ERR! code E403`, expecting the parser's error, not the missing-npm message.

---

### Task 1: Shell spawn on Windows and the missing-npm mapping

**Files:**
- Modify: `scripts/lib/alerts.mjs` (the `SCANNERS` npm-audit `run`, and `collectAlerts`)
- Test: `scripts/alerts.test.mjs`

**Interfaces:**
- Consumes: `npmCommand(platform)` already in `scripts/lib/alerts.mjs`.
- Produces:
  - `collectAlerts(root: string, options?: { env?, timeoutMs?, platform?: string, spawn?: Function })`. `platform` defaults to `process.platform`, `spawn` to `spawnSync`. Both are passed to each scanner's `run` as `{ timeoutMs, platform, spawn }`.
  - `isNpmMissingOnShell(result: { status, stderr }): boolean` exported from `scripts/lib/alerts.mjs`. True when `status` is non-zero and `stderr` matches `/is not recognized/i`.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/alerts.test.mjs`. Import `collectAlerts` and `isNpmMissingOnShell` from `./lib/alerts.mjs`.

```js
const REPORT_ONE = JSON.stringify({ vulnerabilities: { a: { name: 'a', severity: 'low', via: [], fixAvailable: false } } })

function fakeSpawn(result) {
  const calls = []
  const spawn = (command, args, options) => {
    calls.push({ command, args, options })
    return { stdout: '', stderr: '', status: 0, ...result }
  }
  return { spawn, calls }
}

function repoWithLockfile() {
  const root = tempDir('pmkit-win-')
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n')
  return root
}

test('on win32 the npm audit call uses the shell and npm.cmd', () => {
  const { spawn, calls } = fakeSpawn({ stdout: REPORT_ONE, status: 0 })
  collectAlerts(repoWithLockfile(), { platform: 'win32', spawn })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'npm.cmd')
  assert.deepEqual(calls[0].args, ['audit', '--json'])
  assert.equal(calls[0].options.shell, true)
})

test('on linux the npm audit call does not use the shell', () => {
  const { spawn, calls } = fakeSpawn({ stdout: REPORT_ONE, status: 0 })
  collectAlerts(repoWithLockfile(), { platform: 'linux', spawn })
  assert.equal(calls[0].command, 'npm')
  assert.equal(calls[0].options.shell, false)
})

test('on win32 a shell "not recognized" failure is a missing npm', () => {
  const { spawn } = fakeSpawn({ status: 1, stdout: '', stderr: "'npm.cmd' is not recognized as an internal or external command" })
  const found = collectAlerts(repoWithLockfile(), { platform: 'win32', spawn })
  assert.equal(found.warnings[0], 'npm-audit failed: npm is not installed or not on PATH')
})

test('on win32 npm that exits 1 with vulnerabilities still parses', () => {
  const { spawn } = fakeSpawn({ status: 1, stdout: REPORT_ONE, stderr: '' })
  const found = collectAlerts(repoWithLockfile(), { platform: 'win32', spawn })
  assert.deepEqual(found.warnings, [])
  assert.equal(found.alerts.length, 1)
})

test('on win32 a registry error on stderr is not a missing npm', () => {
  const { spawn } = fakeSpawn({ status: 1, stdout: '', stderr: 'npm ERR! code E403' })
  const found = collectAlerts(repoWithLockfile(), { platform: 'win32', spawn })
  assert.doesNotMatch(found.warnings[0], /not installed/)
})

test('on win32 a timeout still reports the timeout', () => {
  const { spawn } = fakeSpawn({ error: Object.assign(new Error('spawnSync npm.cmd ETIMEDOUT'), { code: 'ETIMEDOUT' }), status: null })
  const found = collectAlerts(repoWithLockfile(), { platform: 'win32', spawn, timeoutMs: 300 })
  assert.match(found.warnings[0], /timed out after 0\.3 s/)
})

test('isNpmMissingOnShell matches only the not-recognized text, case-insensitively', () => {
  assert.equal(isNpmMissingOnShell({ status: 1, stderr: "'npm.cmd' IS NOT RECOGNIZED" }), true)
  assert.equal(isNpmMissingOnShell({ status: 0, stderr: 'is not recognized' }), false)
  assert.equal(isNpmMissingOnShell({ status: 1, stderr: 'npm ERR! code E403' }), false)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/alerts.test.mjs`
Expected: FAIL. The new tests fail because `collectAlerts` ignores `platform` and `spawn`, and `isNpmMissingOnShell` is not exported.

- [ ] **Step 3: Implement the change in `scripts/lib/alerts.mjs`**

- Add `export const isNpmMissingOnShell = (result) => result.status !== 0 && /is not recognized/i.test(result.stderr ?? '')`.
- In the npm-audit `run`, take `{ timeoutMs, platform, spawn }` as the third argument. Call `spawn(npmCommand(platform), ['audit', '--json'], { cwd: root, env, encoding: 'utf8', maxBuffer: NPM_MAX_BUFFER, timeout: timeoutMs, shell: platform === 'win32' })`.
- After the `result.error` block, add: `if (platform === 'win32' && isNpmMissingOnShell(result)) throw new Error('npm is not installed or not on PATH')`.
- In `collectAlerts`, destructure `{ env = process.env, timeoutMs = NPM_TIMEOUT_MS, platform = process.platform, spawn = spawnSync }` and pass `{ timeoutMs, platform, spawn }` to `scanner.run`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/alerts.test.mjs scripts/cli-alerts.test.mjs`
Expected: PASS, including the existing "a missing npm is a warning, not a failure" test.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/alerts.mjs scripts/alerts.test.mjs
git commit -m "fix(alerts): run npm audit through the shell on Windows (PMK-175)

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 2: CHANGELOG line

**Files:**
- Modify: `CHANGELOG.md` (under `## Unreleased`, at the top of the list)

**Interfaces:**
- Consumes: none.
- Produces: none.

- [ ] **Step 1: Add the line**

Add one bullet at the start of the list under `## Unreleased`, in the style of the entries there. Text: `- Fixes \`pmkit alerts list\` on Windows, where npm audit failed with \`EINVAL\` since Node 18.20.2, 20.12.2 and 21.7.3. The scanner now runs npm through the shell on Windows, and a missing npm there still reports \`npm is not installed or not on PATH\` (PMK-175).`

- [ ] **Step 2: Verify**

Run: `grep -n "PMK-175" CHANGELOG.md`
Expected: one match, under `## Unreleased`.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note the Windows npm audit fix (PMK-175)

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

## Verification before the PR

- Run `npm test` and expect it to pass.
- Tick the three acceptance criteria with `node scripts/pmkit.mjs issues update PMK-175 --check <n>`, dry-run first, then for real. Commit the `.issues/` changes.
