import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { SEVERITIES, collectAlerts, isNpmMissingOnShell, parseNpmAudit } from './lib/alerts.mjs'
import { tempDir } from './test-helpers.mjs'

const REPORT_ONE = JSON.stringify({ vulnerabilities: { a: { name: 'a', severity: 'low', via: [], fixAvailable: false } } })

// A spawn stand-in that records each call and returns the given result.
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

test('on win32 exit 9009 means npm is missing, whatever the cmd.exe language', () => {
  const portuguese = "'npm.cmd' não é reconhecido como um comando interno ou externo"
  const german = "'npm.cmd' wird nicht als interner oder externer Befehl, Programm oder Batchdatei erkannt."
  for (const stderr of [portuguese, german]) {
    const { spawn } = fakeSpawn({ status: 9009, stdout: '', stderr })
    const found = collectAlerts(repoWithLockfile(), { platform: 'win32', spawn })
    assert.equal(found.warnings[0], 'npm-audit failed: npm is not installed or not on PATH')
  }
})

test('isNpmMissingOnShell accepts exit 9009 with any stderr, and no other non-zero exit without the text', () => {
  assert.equal(isNpmMissingOnShell({ status: 9009, stderr: '' }), true)
  assert.equal(isNpmMissingOnShell({ status: 9009, stderr: 'qualquer coisa' }), true)
  assert.equal(isNpmMissingOnShell({ status: 1, stderr: 'npm ERR! code E403' }), false)
})

const audit = (vulnerabilities) => JSON.stringify({ auditReportVersion: 2, vulnerabilities })

test('SEVERITIES lists the four levels, highest first', () => {
  assert.deepEqual(SEVERITIES, ['critical', 'high', 'medium', 'low'])
})

test('npm moderate maps to medium and info to low', () => {
  const { alerts, warnings } = parseNpmAudit(audit({
    a: { name: 'a', severity: 'moderate', via: [], fixAvailable: true },
    b: { name: 'b', severity: 'info', via: [], fixAvailable: false },
    c: { name: 'c', severity: 'critical', via: [], fixAvailable: false },
    d: { name: 'd', severity: 'high', via: [], fixAvailable: false },
  }))
  assert.deepEqual(Object.fromEntries(alerts.map((a) => [a.package, a.severity])), { a: 'medium', b: 'low', c: 'critical', d: 'high' })
  assert.deepEqual(warnings, [])
})

test('an unknown severity maps to low and adds a warning', () => {
  const { alerts, warnings } = parseNpmAudit(audit({ a: { name: 'a', severity: 'weird', via: [] } }))
  assert.equal(alerts[0].severity, 'low')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /a.*weird/)
})

test('the title and url come from the first advisory in via', () => {
  const { alerts } = parseNpmAudit(audit({
    lodash: { name: 'lodash', severity: 'high', fixAvailable: { name: 'lodash', version: '4.17.21' }, via: ['x', { source: 1, title: 'Prototype Pollution', url: 'https://example.com/advisories/1' }] },
  }))
  assert.deepEqual(alerts, [{
    id: 'npm-audit:lodash', scanner: 'npm-audit', package: 'lodash', title: 'Prototype Pollution', severity: 'high',
    url: 'https://example.com/advisories/1', fixAvailable: true, advisories: [{ title: 'Prototype Pollution', url: 'https://example.com/advisories/1' }],
  }])
})

test('a via with only package names gives the fallback title and no url', () => {
  const { alerts } = parseNpmAudit(audit({ a: { name: 'a', severity: 'low', via: ['b', 'c'], fixAvailable: false } }))
  assert.equal(alerts[0].title, 'vulnerable through b, c')
  assert.equal(alerts[0].url, null)
  assert.equal(alerts[0].fixAvailable, false)
})

test('invalid JSON, empty output and a missing vulnerabilities object throw', () => {
  assert.throws(() => parseNpmAudit('not json'), /not valid JSON/)
  assert.throws(() => parseNpmAudit('{}'), /vulnerabilities/)
  assert.throws(() => parseNpmAudit(''), /empty/)
})
