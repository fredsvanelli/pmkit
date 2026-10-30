import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { NPM_MAX_BUFFER, NPM_TIMEOUT_MS, collectAlerts, npmCommand } from './lib/alerts.mjs'
import { makeRepo, tempDir } from './test-helpers.mjs'

// A fake npm that prints the canned stdout of PMKIT_FAKE_NPM_OUT (or one alert with a title of PMKIT_FAKE_NPM_PAD bytes),
// waits PMKIT_FAKE_NPM_SLEEP_MS and exits with PMKIT_FAKE_NPM_STATUS.
const FAKE_NPM = `#!/usr/bin/env node
const pad = Number(process.env.PMKIT_FAKE_NPM_PAD ?? 0)
const out = pad > 0
  ? JSON.stringify({ vulnerabilities: { big: { name: 'big', severity: 'high', via: [{ title: 'x'.repeat(pad) }] } } })
  : process.env.PMKIT_FAKE_NPM_OUT ?? ''
const sleep = Number(process.env.PMKIT_FAKE_NPM_SLEEP_MS ?? 0)
if (sleep > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleep)
process.stdout.write(out)
process.exitCode = Number(process.env.PMKIT_FAKE_NPM_STATUS ?? 0)
`

function fakeNpm() {
  const dir = tempDir('pmkit-npm-')
  fs.writeFileSync(path.join(dir, 'npm'), FAKE_NPM, { mode: 0o755 })
  fs.chmodSync(path.join(dir, 'npm'), 0o755)
  return dir
}

const REPORT = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {
    minimist: { name: 'minimist', severity: 'moderate', via: [{ title: 'Prototype Pollution', url: 'https://example.com/a/1' }], fixAvailable: true },
    lodash: { name: 'lodash', severity: 'critical', via: [{ title: 'Command Injection', url: 'https://example.com/a/2' }], fixAvailable: false },
    tar: { name: 'tar', severity: 'high', via: ['minimist'], fixAvailable: true },
  },
})

function setup({ lockfile = 'package-lock.json', out = REPORT, status = 1, path: pathDir = fakeNpm(), extraEnv = {} } = {}) {
  const root = makeRepo('basic')
  if (lockfile) fs.writeFileSync(path.join(root, lockfile), '{}\n')
  const env = {
    ...process.env, PATH: `${pathDir}${path.delimiter}${process.env.PATH}`, PMKIT_FAKE_NPM_OUT: out, PMKIT_FAKE_NPM_STATUS: String(status),
    GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', ...extraEnv,
  }
  return (args) => run(['alerts', 'list', ...args], { env, cwd: root })
}

test('alerts list reads npm audit output even when npm exits 1, highest severity first', async () => {
  const result = await setup()(['--json'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const data = JSON.parse(result.stdout)
  assert.deepEqual(data.alerts.map((a) => [a.id, a.severity]), [['npm-audit:lodash', 'critical'], ['npm-audit:tar', 'high'], ['npm-audit:minimist', 'medium']])
  assert.deepEqual(data.scanners, [{ id: 'npm-audit', detected: true, alerts: 3 }])
})

test('alerts list prints a table in text mode', async () => {
  const result = await setup()([])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /^ID\s+\| Severity\s+\| Package\s+\| Title/m)
  assert.match(result.stdout, /npm-audit:lodash\s+\| critical\s+\| lodash\s+\| Command Injection/)
})

test('without a lockfile no scanner is found', async () => {
  const result = await setup({ lockfile: null })([])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'no scanners found in this repository (looked for: npm-audit needs package-lock.json or npm-shrinkwrap.json)')
  const data = JSON.parse((await setup({ lockfile: null })(['--json'])).stdout)
  assert.deepEqual(data, { incomplete: false, scanners: [{ id: 'npm-audit', detected: false, alerts: 0 }], alerts: [] })
})

test('a scanner with no findings prints no alerts', async () => {
  const result = await setup({ out: JSON.stringify({ vulnerabilities: {} }), status: 0 })([])
  assert.equal(result.stdout.trim(), 'no alerts')
})

test('a scanner that prints garbage is a warning, not a failure', async () => {
  const result = await setup({ out: 'boom', status: 1 })(['--json'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.match(result.stderr, /warning: npm-audit failed: npm audit output is not valid JSON/)
  assert.equal(JSON.parse(result.stdout).scanners[0].error, 'npm audit output is not valid JSON')
})

test('a missing npm is a warning, not a failure', async () => {
  const empty = tempDir('pmkit-nonpm-')
  const root = makeRepo('basic')
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n')
  const result = await run(['alerts', 'list'], { env: { PATH: empty }, cwd: root })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stderr, /warning: npm-audit failed: npm is not installed or not on PATH/)
})

test('--severity keeps only the listed severities', async () => {
  const result = await setup()(['--severity', 'critical,high', '--json'])
  assert.deepEqual(JSON.parse(result.stdout).alerts.map((a) => a.package), ['lodash', 'tar'])
})

test('--severity with an unknown value is INVALID_INPUT', async () => {
  const result = await setup()(['--severity', 'bogus', '--json'])
  assert.equal(result.code, 2)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
})

test('output larger than 1 MiB is read in full, with no warning', async () => {
  const result = await setup({ out: '', status: 1, extraEnv: { PMKIT_FAKE_NPM_PAD: String(3 * 1024 * 1024) } })(['--json'])
  assert.equal(result.code, 0, result.stderr.slice(0, 300))
  assert.equal(result.stderr, '')
  assert.deepEqual(JSON.parse(result.stdout).alerts.map((a) => a.id), ['npm-audit:big'])
  assert.equal(NPM_MAX_BUFFER, 256 * 1024 * 1024)
})

test('text mode says the result is incomplete when a scanner failed, not "no alerts"', async () => {
  const result = await setup({ out: 'boom', status: 1 })([])
  assert.equal(result.code, 0, result.stderr)
  assert.doesNotMatch(result.stdout, /^no alerts$/m)
  assert.match(result.stdout, /incomplete: npm-audit failed \(npm audit output is not valid JSON\)/)
  assert.equal(JSON.parse((await setup({ out: 'boom', status: 1 })(['--json'])).stdout).incomplete, true)
})

test('incomplete is false when every scanner ran', async () => {
  const root = makeRepo('basic')
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n')
  const env = { ...process.env, PATH: `${fakeNpm()}${path.delimiter}${process.env.PATH}`, PMKIT_FAKE_NPM_OUT: REPORT, PMKIT_FAKE_NPM_STATUS: '1' }
  const clean = await run(['alerts', 'list', '--json'], { env, cwd: root })
  assert.equal(JSON.parse(clean.stdout).incomplete, false)
})

test('an npm error report shows npm message in the warning', async () => {
  const out = JSON.stringify({ message: 'This command requires an existing lockfile.', error: { code: 'ENOLOCK', summary: 'This command requires an existing lockfile.', detail: 'long' } })
  const result = await setup({ out, status: 1 })(['--json'])
  assert.match(result.stderr, /warning: npm-audit failed: npm audit failed \(ENOLOCK\): This command requires an existing lockfile\./)
  assert.doesNotMatch(result.stderr, /no vulnerabilities object/)
})

test('npm-shrinkwrap.json alone also counts as a lockfile', async () => {
  const result = await setup({ lockfile: 'npm-shrinkwrap.json' })(['--json'])
  assert.equal(JSON.parse(result.stdout).alerts.length, 3)
})

test('--severity also filters the per-scanner count', async () => {
  const result = await setup()(['--severity', 'critical', '--json'])
  const data = JSON.parse(result.stdout)
  assert.deepEqual(data.scanners, [{ id: 'npm-audit', detected: true, alerts: 1 }])
  assert.equal(data.alerts.length, 1)
})

test('a via with no entries gets a readable title', async () => {
  const out = JSON.stringify({ vulnerabilities: { a: { name: 'a', severity: 'low', via: [], fixAvailable: false } } })
  const data = JSON.parse((await setup({ out })(['--json'])).stdout)
  assert.equal(data.alerts[0].title, 'no advisory details from npm audit')
})

test('an npm audit that runs too long times out with a clear warning', () => {
  const root = makeRepo('basic')
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n')
  const env = { ...process.env, PATH: `${fakeNpm()}${path.delimiter}${process.env.PATH}`, PMKIT_FAKE_NPM_OUT: REPORT, PMKIT_FAKE_NPM_SLEEP_MS: '5000' }
  const found = collectAlerts(root, { env, timeoutMs: 300 })
  assert.deepEqual(found.alerts, [])
  assert.match(found.warnings[0], /npm-audit failed: npm audit timed out after 0\.3 s/)
  assert.equal(NPM_TIMEOUT_MS, 60000)
})

test('npm is called npm.cmd on Windows only', () => {
  assert.equal(npmCommand('win32'), 'npm.cmd')
  assert.equal(npmCommand('linux'), 'npm')
  assert.equal(npmCommand('darwin'), 'npm')
})
