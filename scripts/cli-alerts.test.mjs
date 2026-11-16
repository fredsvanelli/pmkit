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

const SCANNER_IDS = ['npm-audit', 'yarn-audit', 'pnpm-audit', 'pip-audit', 'cargo-audit']
const LOOKED_FOR = 'npm-audit needs package-lock.json or npm-shrinkwrap.json; yarn-audit needs yarn.lock; pnpm-audit needs pnpm-lock.yaml; pip-audit needs requirements.txt; cargo-audit needs Cargo.lock'

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
  assert.deepEqual(data.scanners[0], { id: 'npm-audit', detected: true, alerts: 3 })
  assert.ok(data.scanners.slice(1).every((scanner) => !scanner.detected && scanner.alerts === 0))
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
  assert.equal(result.stdout.trim(), `no scanners found in this repository (looked for: ${LOOKED_FOR})`)
  const data = JSON.parse((await setup({ lockfile: null })(['--json'])).stdout)
  assert.deepEqual(data, { incomplete: false, scanners: SCANNER_IDS.map((id) => ({ id, detected: false, alerts: 0 })), alerts: [] })
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
  assert.doesNotMatch(result.stderr, /warning/)
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
  assert.deepEqual(data.scanners[0], { id: 'npm-audit', detected: true, alerts: 1 })
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

test('alerts scan runs on the same fake npm as alerts list', async () => {
  const result = await setup()(['--json'])
  assert.equal(JSON.parse(result.stdout).alerts.length, 3)
  const root = makeRepo('basic')
  const scan = await run(['alerts', 'scan', '--json'], { env: process.env, cwd: root })
  assert.equal(JSON.parse(scan.stdout).absent, true)
})

test('alerts list prints the note of the derived path, like alerts scan', async () => {
  const result = await setup()(['--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stderr, /^note: security_alerts is derived from scanners, not read natively$/m)
})

test('a scanner that skipped packages makes alerts list incomplete and says so in the text', async () => {
  const dir = tempDir('pmkit-pipbin-')
  const out = JSON.stringify({ dependencies: [{ name: 'private-lib', skip_reason: 'not on PyPI' }] })
  fs.writeFileSync(path.join(dir, 'pip-audit'), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(out)})\n`, { mode: 0o755 })
  const root = makeRepo('basic')
  fs.writeFileSync(path.join(root, 'requirements.txt'), 'x\n')
  const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
  const json = await run(['alerts', 'list', '--json'], { env, cwd: root })
  assert.equal(json.code, 0, json.stderr)
  assert.equal(JSON.parse(json.stdout).incomplete, true)
  assert.match(json.stderr, /warning: pip-audit did not audit private-lib: not on PyPI/)
  const text = await run(['alerts', 'list'], { env, cwd: root })
  assert.match(text.stdout, /^incomplete: pip-audit did not audit every package, so this result may miss alerts$/m)
  assert.doesNotMatch(text.stdout, /^no alerts$/m)
  const scan = await run(['alerts', 'scan', '--json'], { env, cwd: root })
  assert.equal(JSON.parse(scan.stdout).incomplete, true)
  assert.match(scan.stderr, /incomplete: pip-audit did not audit every package, so this list may miss alerts\. Do not create issues from this list/)
})

// ---- --report (PMK-208) ----

function offline() {
  const root = makeRepo('basic')
  const env = { PATH: tempDir('pmkit-nobin-'), GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
  const write = (name, text) => {
    fs.writeFileSync(path.join(root, name), text)
    return name
  }
  return { root, write, cli: (args) => run(args, { env, cwd: root }) }
}

test('alerts list --report reads a saved report with no lockfile and nothing on PATH', async () => {
  const { write, cli } = offline()
  write('npm-audit.json', REPORT)
  const result = await cli(['alerts', 'list', '--report', 'npm-audit=npm-audit.json', '--json'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.incomplete, false)
  assert.deepEqual(data.scanners[0], { id: 'npm-audit', detected: true, alerts: 3, report: 'npm-audit.json' })
  assert.deepEqual(data.alerts.map((a) => a.id), ['npm-audit:lodash', 'npm-audit:tar', 'npm-audit:minimist'])
})

test('a detected scanner with no --report is unread, so alerts list and alerts scan are incomplete and never say no alerts', async () => {
  const { write, cli } = offline()
  write('package-lock.json', '{}\n')
  write('pnpm-lock.yaml', '\n')
  write('saved.json', JSON.stringify({ vulnerabilities: {} }))
  const result = await cli(['alerts', 'list', '--report=npm-audit=saved.json', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.incomplete, true)
  assert.deepEqual(data.scanners.find((s) => s.id === 'pnpm-audit'), { id: 'pnpm-audit', detected: true, alerts: 0, skipped: true })
  const text = await cli(['alerts', 'list', '--report=npm-audit=saved.json'])
  assert.equal(text.stdout.trim(), 'no alerts read\nincomplete: pnpm-audit was not read because --report was given without it (pass --report pnpm-audit=<file>), so this result may miss alerts')
  const scan = await cli(['alerts', 'scan', '--report=npm-audit=saved.json', '--json'])
  assert.equal(scan.code, 0, scan.stderr)
  const scanned = JSON.parse(scan.stdout)
  assert.equal(scanned.incomplete, true)
  assert.deepEqual(scanned.candidates, [])
  assert.match(scan.stderr, /incomplete: pnpm-audit was not read because --report was given without it \(pass --report pnpm-audit=<file>\), so this list may miss alerts\. Do not create issues from this list/)
  assert.doesNotMatch((await cli(['alerts', 'scan', '--report=npm-audit=saved.json'])).stdout, /^no alerts$/m)
})

test('alerts scan --report errors name alerts scan in the next step, and an empty report file is refused', async () => {
  const { write, cli } = offline()
  write('empty.json', ' \n')
  const bogus = JSON.parse((await cli(['alerts', 'scan', '--report', 'bogus=x.json', '--json'])).stdout).error
  assert.equal(bogus.nextStep, 'pmkit alerts scan --report npm-audit=npm-audit.json')
  const empty = await cli(['alerts', 'list', '--report', 'npm-audit=empty.json', '--json'])
  assert.equal(empty.code, 2)
  assert.equal(JSON.parse(empty.stdout).error.code, 'INVALID_INPUT')
  assert.match(JSON.parse(empty.stdout).error.message, /^cannot read empty\.json: the file is empty$/)
})

test('alerts list --report reads every scanner format, a CRLF yarn report and a UTF-16 npm report', async () => {
  const { root, write, cli } = offline()
  const yarn = [JSON.stringify({ type: 'auditAdvisory', data: { advisory: { module_name: 'y', severity: 'high', title: 'Y', url: null, patched_versions: '<0.0.0' } } }), JSON.stringify({ type: 'auditSummary', data: {} })].join('\r\n')
  write('yarn.json', yarn)
  fs.writeFileSync(path.join(root, 'npm.json'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(REPORT, 'utf16le')]))
  write('pnpm.json', JSON.stringify({ advisories: { 1: { module_name: 'p', severity: 'low', title: 'P', url: null, patched_versions: '>=2' } } }))
  write('pip.json', JSON.stringify({ dependencies: [{ name: 'q', vulns: [{ id: 'PYSEC-1', fix_versions: [] }] }] }))
  write('cargo.json', JSON.stringify({ vulnerabilities: { list: [{ advisory: { id: 'RUSTSEC-1', package: 'r', title: 'R', cvss: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }, versions: { patched: [] }, package: { name: 'r' } }] } }))
  const args = ['npm-audit=npm.json', 'yarn-audit=yarn.json', 'pnpm-audit=pnpm.json', 'pip-audit=pip.json', 'cargo-audit=cargo.json'].flatMap((value) => ['--report', value])
  const result = await cli(['alerts', 'list', ...args, '--json'])
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.incomplete, false)
  assert.deepEqual(data.alerts.map((a) => [a.id, a.severity]), [
    ['npm-audit:lodash', 'critical'], ['cargo-audit:r', 'critical'], ['npm-audit:tar', 'high'], ['yarn-audit:y', 'high'],
    ['npm-audit:minimist', 'medium'], ['pnpm-audit:p', 'low'], ['pip-audit:q', 'unknown'],
  ])
  const unknown = await cli(['alerts', 'list', ...args, '--severity', 'unknown', '--json'])
  assert.deepEqual(JSON.parse(unknown.stdout).alerts.map((a) => a.id), ['pip-audit:q'])
})

test('alerts list --report refuses a bad value, an unknown scanner, a repeat and a missing file', async () => {
  const { write, cli } = offline()
  write('a.json', REPORT)
  const cases = [
    [['--report', 'npm-audit'], /--report must be <scanner>=<file>/],
    [['--report', 'npm-audit='], /--report must be <scanner>=<file>/],
    [['--report', 'bogus=a.json'], /--report names the unknown scanner "bogus"/],
    [['--report', 'npm-audit=a.json', '--report', 'npm-audit=a.json'], /--report gives npm-audit twice/],
    [['--report', 'npm-audit=missing.json'], /cannot read missing\.json/],
  ]
  for (const [args, message] of cases) {
    const result = await cli(['alerts', 'list', ...args, '--json'])
    assert.equal(result.code, 2, args.join(' '))
    const { error } = JSON.parse(result.stdout)
    assert.equal(error.code, 'INVALID_INPUT')
    assert.match(error.message, message)
  }
})

test('alerts list --report with a report that does not parse is incomplete', async () => {
  const { write, cli } = offline()
  write('bad.json', 'nope')
  const result = await cli(['alerts', 'list', '--report', 'npm-audit=bad.json', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).incomplete, true)
  assert.match(result.stderr, /warning: npm-audit failed: npm audit output is not valid JSON/)
})

test('alerts scan --report gives candidates offline', async () => {
  const { write, cli } = offline()
  write('npm-audit.json', REPORT)
  const result = await cli(['alerts', 'scan', '--report', 'npm-audit=npm-audit.json', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.absent, false)
  assert.equal(data.incomplete, false)
  assert.deepEqual(data.candidates.map((c) => c.id), ['npm-audit:lodash', 'npm-audit:tar', 'npm-audit:minimist'])
})
