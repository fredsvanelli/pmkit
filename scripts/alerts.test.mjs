import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { SEVERITIES, collectAlerts, cvssScore, cvssSeverity, isNpmMissingOnShell, parseCargoAudit, parseNpmAudit, parsePipAudit, parsePnpmAudit, parseYarnAudit } from './lib/alerts.mjs'
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

test('SEVERITIES lists the four levels, highest first, then unknown', () => {
  assert.deepEqual(SEVERITIES, ['critical', 'high', 'medium', 'low', 'unknown'])
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

test('a valid audit report is never a missing npm, whatever the exit code and stderr say', () => {
  const stderr = "'npm.cmd' is not recognized as an internal or external command"
  assert.equal(isNpmMissingOnShell({ status: 1, stdout: REPORT_ONE, stderr }), false)
  assert.equal(isNpmMissingOnShell({ status: 9009, stdout: REPORT_ONE, stderr }), false)
  assert.equal(isNpmMissingOnShell({ status: 1, stdout: '  \n', stderr }), true)
  const { spawn } = fakeSpawn({ status: 1, stdout: REPORT_ONE, stderr })
  const found = collectAlerts(repoWithLockfile(), { platform: 'win32', spawn })
  assert.deepEqual(found.warnings, [])
  assert.equal(found.alerts.length, 1)
})

test('the title and url come from the advisory with the severity of the alert', () => {
  const via = [
    { title: 'ReDoS', url: 'https://example.com/redos', severity: 'low' },
    { title: 'RCE', url: 'https://example.com/rce', severity: 'critical' },
  ]
  const [alert] = parseNpmAudit(audit({ x: { name: 'x', severity: 'critical', via, fixAvailable: false } })).alerts
  assert.equal(alert.title, 'RCE')
  assert.equal(alert.url, 'https://example.com/rce')
  assert.equal(alert.advisories.length, 2)
})

test('with no advisory of the alert severity the most severe one gives the title, the first on a tie', () => {
  const via = [{ title: 'A', severity: 'low' }, { title: 'B', severity: 'moderate' }, { title: 'C', severity: 'moderate' }]
  const [alert] = parseNpmAudit(audit({ x: { name: 'x', severity: 'critical', via, fixAvailable: false } })).alerts
  assert.equal(alert.title, 'B')
})

test('the empty-output error carries npm stderr, collapsed and cut', () => {
  assert.throws(() => parseNpmAudit('', 'npm ERR! code E403\nnpm ERR! 403 Forbidden'), /^Error: npm audit printed empty output: npm ERR! code E403 npm ERR! 403 Forbidden$/)
  assert.throws(() => parseNpmAudit('', ' \n '), (e) => e.message === 'npm audit printed empty output')
  assert.throws(() => parseNpmAudit('', 'x'.repeat(500)), (e) => e.message.length === 'npm audit printed empty output: '.length + 300)
})

test('collectAlerts warns with the stderr of an npm that printed nothing', () => {
  const { spawn } = fakeSpawn({ status: 1, stdout: '', stderr: 'npm ERR! code E403' })
  const found = collectAlerts(repoWithLockfile(), { platform: 'linux', spawn })
  assert.equal(found.warnings[0], 'npm-audit failed: npm audit printed empty output: npm ERR! code E403')
})

// ---- yarn and pnpm (PMK-208) ----

const yarnLine = (module_name, severity, title, extra = {}) => JSON.stringify({ type: 'auditAdvisory', data: { resolution: { id: 1, path: `x>${module_name}` }, advisory: { module_name, severity, title, url: `https://example.com/${title}`, patched_versions: '>=2.0.0', ...extra } } })
const YARN_SUMMARY = JSON.stringify({ type: 'auditSummary', data: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 1, critical: 0 } } })

test('yarn audit: advisories of one package fold into one alert with the highest severity', () => {
  const out = [yarnLine('minimist', 'moderate', 'Pollution'), yarnLine('minimist', 'high', 'RCE'), YARN_SUMMARY].join('\n')
  const { alerts, warnings } = parseYarnAudit(out)
  assert.deepEqual(warnings, [])
  assert.deepEqual(alerts, [{
    id: 'yarn-audit:minimist', scanner: 'yarn-audit', package: 'minimist', title: 'RCE', severity: 'high', url: 'https://example.com/RCE', fixAvailable: true,
    advisories: [{ title: 'Pollution', url: 'https://example.com/Pollution' }, { title: 'RCE', url: 'https://example.com/RCE' }],
  }])
})

test('yarn audit: the same advisory on two paths is one advisory', () => {
  const out = [yarnLine('a', 'low', 'X'), yarnLine('a', 'low', 'X'), YARN_SUMMARY].join('\n')
  assert.equal(parseYarnAudit(out).alerts[0].advisories.length, 1)
})

test('yarn audit: CRLF lines, no patched version and an empty report', () => {
  const out = [yarnLine('a', 'info', 'X', { patched_versions: '<0.0.0' }), YARN_SUMMARY].join('\r\n')
  const [alert] = parseYarnAudit(out).alerts
  assert.equal(alert.severity, 'low')
  assert.equal(alert.fixAvailable, false)
  assert.deepEqual(parseYarnAudit(YARN_SUMMARY), { alerts: [], warnings: [] })
})

test('yarn audit: an error line, no summary and empty output throw', () => {
  assert.throws(() => parseYarnAudit(JSON.stringify({ type: 'error', data: 'An unexpected error occurred' })), /^Error: yarn audit failed: An unexpected error occurred$/)
  assert.throws(() => parseYarnAudit('Usage Error: Couldn\'t find a script named "audit".'), /yarn audit printed no audit report/)
  assert.throws(() => parseYarnAudit('', 'boom'), /^Error: yarn audit printed empty output: boom$/)
})

test('pnpm audit: advisories group by package', () => {
  const advisory = (id, module_name, severity, title, patched = '>=1.0.1') => ({ id, module_name, severity, title, url: `https://example.com/${id}`, patched_versions: patched })
  const out = JSON.stringify({ actions: [], advisories: { 1: advisory(1, 'lodash', 'critical', 'RCE'), 2: advisory(2, 'lodash', 'low', 'ReDoS'), 3: advisory(3, 'tar', 'moderate', 'Traversal', '<0.0.0') }, metadata: {} })
  const { alerts } = parsePnpmAudit(out)
  assert.deepEqual(alerts.map((a) => [a.id, a.severity, a.title, a.fixAvailable, a.advisories.length]), [
    ['pnpm-audit:lodash', 'critical', 'RCE', true, 2], ['pnpm-audit:tar', 'medium', 'Traversal', false, 1],
  ])
})

test('pnpm audit: an error report and bad output throw', () => {
  assert.throws(() => parsePnpmAudit(JSON.stringify({ error: { code: 'ERR_PNPM_AUDIT_NO_LOCKFILE', message: 'No pnpm-lock.yaml found' } })), /^Error: pnpm audit failed \(ERR_PNPM_AUDIT_NO_LOCKFILE\): No pnpm-lock.yaml found$/)
  assert.throws(() => parsePnpmAudit('{}'), /pnpm audit output has no advisories object/)
  assert.throws(() => parsePnpmAudit('nope'), /pnpm audit output is not valid JSON/)
})

test('an unknown yarn or pnpm severity is low with a warning', () => {
  const { alerts, warnings } = parseYarnAudit([yarnLine('a', 'weird', 'X'), YARN_SUMMARY].join('\n'))
  assert.equal(alerts[0].severity, 'low')
  assert.match(warnings[0], /^yarn-audit: a has the unknown severity "weird", treated as low$/)
})

test('yarn and pnpm run through the shell on win32, with their .cmd shims', () => {
  for (const [lockfile, command] of [['yarn.lock', 'yarn.cmd'], ['pnpm-lock.yaml', 'pnpm.cmd']]) {
    const root = tempDir('pmkit-shim-')
    fs.writeFileSync(path.join(root, lockfile), '\n')
    const { spawn, calls } = fakeSpawn({ stdout: '', status: 1 })
    collectAlerts(root, { platform: 'win32', spawn })
    assert.equal(calls[0].command, command)
    assert.deepEqual(calls[0].args, ['audit', '--json'])
    assert.equal(calls[0].options.shell, true)
  }
})

// ---- pip-audit (PMK-208) ----

const PIP = { dependencies: [
  { name: 'django', version: '3.2', vulns: [{ id: 'PYSEC-2023-1', aliases: ['CVE-2023-0001'], fix_versions: ['3.2.1'], description: 'long text' }, { id: 'GHSA-xxxx', aliases: [], fix_versions: [] }] },
  { name: 'ok', version: '1.0', vulns: [] },
], fixes: [] }

test('pip-audit: one alert per package, severity unknown, an OSV link and the ID with its aliases', () => {
  const { alerts, warnings, incomplete } = parsePipAudit(JSON.stringify(PIP))
  assert.deepEqual(warnings, [])
  assert.equal(incomplete, false)
  assert.deepEqual(alerts, [{
    id: 'pip-audit:django', scanner: 'pip-audit', package: 'django', title: 'PYSEC-2023-1 (CVE-2023-0001)', severity: 'unknown',
    url: 'https://osv.dev/vulnerability/PYSEC-2023-1', fixAvailable: false,
    advisories: [{ title: 'PYSEC-2023-1 (CVE-2023-0001)', url: 'https://osv.dev/vulnerability/PYSEC-2023-1' }, { title: 'GHSA-xxxx', url: 'https://osv.dev/vulnerability/GHSA-xxxx' }],
  }])
})

test('pip-audit: the older top-level array reads the same', () => {
  assert.deepEqual(parsePipAudit(JSON.stringify(PIP.dependencies)).alerts, parsePipAudit(JSON.stringify(PIP)).alerts)
})

test('pip-audit: a fix for every advisory is a fix', () => {
  const out = JSON.stringify({ dependencies: [{ name: 'a', vulns: [{ id: 'X-1', fix_versions: ['2'] }] }] })
  assert.equal(parsePipAudit(out).alerts[0].fixAvailable, true)
})

test('pip-audit: a skipped dependency makes the result incomplete with a warning', () => {
  const out = JSON.stringify({ dependencies: [{ name: 'private-lib', skip_reason: 'Dependency not found on PyPI and could not be audited' }, ...PIP.dependencies] })
  const { alerts, warnings, incomplete } = parsePipAudit(out)
  assert.equal(alerts.length, 1)
  assert.equal(incomplete, true)
  assert.deepEqual(warnings, ['pip-audit did not audit private-lib: Dependency not found on PyPI and could not be audited'])
})

test('pip-audit: bad output throws', () => {
  assert.throws(() => parsePipAudit('nope'), /pip-audit output is not valid JSON/)
  assert.throws(() => parsePipAudit('{}'), /pip-audit output has no dependencies list/)
  assert.throws(() => parsePipAudit('', 'No module named pip_audit'), /^Error: pip-audit printed empty output: No module named pip_audit$/)
})

test('pip-audit runs on requirements.txt without the shell, even on win32, and a skip marks the scanner incomplete', () => {
  const root = tempDir('pmkit-pip-')
  fs.writeFileSync(path.join(root, 'requirements.txt'), 'django==3.2\n')
  const stdout = JSON.stringify({ dependencies: [{ name: 'x', skip_reason: 'editable' }] })
  const { spawn, calls } = fakeSpawn({ stdout, status: 0 })
  const found = collectAlerts(root, { platform: 'win32', spawn })
  assert.equal(calls[0].command, 'pip-audit')
  assert.deepEqual(calls[0].args, ['-r', 'requirements.txt', '-f', 'json', '--progress-spinner', 'off'])
  assert.equal(calls[0].options.shell, false)
  assert.deepEqual(found.scanners.find((scanner) => scanner.id === 'pip-audit'), { id: 'pip-audit', detected: true, alerts: 0, incomplete: true })
})

// ---- cargo audit (PMK-208) ----

test('cvssSeverity rates a CVSS 3 base score and leaves the rest unknown', () => {
  const cases = {
    'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H': 'critical', // 9.8
    'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H': 'high', // 7.5
    'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N': 'medium', // 5.3
    'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N': 'low', // 3.7
    'CVSS:3.0/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H': 'critical', // 9.9
    'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N': 'medium', // 5.5
    'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N': 'medium', // 6.1
    'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N': 'low', // 0.0
    'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N': 'unknown',
    'CVSS:3.1/AV:N': 'unknown',
  }
  for (const [vector, severity] of Object.entries(cases)) assert.equal(cvssSeverity(vector), severity, vector)
  assert.equal(cvssSeverity(null), 'unknown')
  assert.equal(cvssScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N'), 6.1)
  assert.equal(cvssScore('CVSS:3.0/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H'), 9.9)
})

const cargoEntry = (pkg, id, cvss, patched = ['>=1.0.1'], url = null) => ({
  advisory: { id, package: pkg, title: `${id} title`, url, cvss, informational: null },
  versions: { patched, unaffected: [] }, package: { name: pkg, version: '1.0.0' },
})

test('cargo audit: advisories group by crate, severity from CVSS, RustSec link when there is no url', () => {
  const out = JSON.stringify({ vulnerabilities: { found: true, count: 3, list: [
    cargoEntry('smallvec', 'RUSTSEC-2021-0003', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'),
    cargoEntry('smallvec', 'RUSTSEC-2019-0009', null, []),
    cargoEntry('time', 'RUSTSEC-2020-0071', null, ['>=0.2.23'], 'https://github.com/time-rs/time/issues/293'),
  ] }, warnings: {} })
  const { alerts, warnings } = parseCargoAudit(out)
  assert.deepEqual(warnings, [])
  assert.deepEqual(alerts.map((a) => [a.id, a.severity, a.title, a.url, a.fixAvailable, a.advisories.length]), [
    ['cargo-audit:smallvec', 'critical', 'RUSTSEC-2021-0003 title', 'https://rustsec.org/advisories/RUSTSEC-2021-0003.html', false, 2],
    ['cargo-audit:time', 'unknown', 'RUSTSEC-2020-0071 title', 'https://github.com/time-rs/time/issues/293', true, 1],
  ])
})

test('cargo audit: no vulnerabilities, a missing cargo-audit and bad output', () => {
  assert.deepEqual(parseCargoAudit(JSON.stringify({ vulnerabilities: { found: false, count: 0, list: [] } })), { alerts: [], warnings: [] })
  assert.throws(() => parseCargoAudit('', 'error: no such command: `audit`'), /^Error: cargo audit printed empty output: error: no such command: `audit`$/)
  assert.throws(() => parseCargoAudit('{}'), /cargo audit output has no vulnerabilities list/)
  assert.throws(() => parseCargoAudit('nope'), /cargo audit output is not valid JSON/)
})

test('cargo audit runs on Cargo.lock without the shell', () => {
  const root = tempDir('pmkit-cargo-')
  fs.writeFileSync(path.join(root, 'Cargo.lock'), '\n')
  const { spawn, calls } = fakeSpawn({ stdout: JSON.stringify({ vulnerabilities: { list: [] } }), status: 0 })
  const found = collectAlerts(root, { platform: 'win32', spawn })
  assert.equal(calls[0].command, 'cargo')
  assert.deepEqual(calls[0].args, ['audit', '--json'])
  assert.equal(calls[0].options.shell, false)
  assert.deepEqual(found.warnings, [])
})
