import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { makeRepo, tempDir } from './test-helpers.mjs'

// A fake npm that prints the canned stdout of PMKIT_FAKE_NPM_OUT and exits with PMKIT_FAKE_NPM_STATUS.
const FAKE_NPM = `#!/usr/bin/env node
process.stdout.write(process.env.PMKIT_FAKE_NPM_OUT ?? '')
process.exit(Number(process.env.PMKIT_FAKE_NPM_STATUS ?? 0))
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

function setup({ lockfile = true, out = REPORT, status = 1, path: pathDir = fakeNpm() } = {}) {
  const root = makeRepo('basic')
  if (lockfile) fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n')
  const env = {
    ...process.env, PATH: `${pathDir}${path.delimiter}${process.env.PATH}`, PMKIT_FAKE_NPM_OUT: out, PMKIT_FAKE_NPM_STATUS: String(status),
    GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1',
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
  const result = await setup({ lockfile: false })([])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'no scanners found in this repository (looked for: npm-audit needs package-lock.json)')
  const data = JSON.parse((await setup({ lockfile: false })(['--json'])).stdout)
  assert.deepEqual(data, { scanners: [{ id: 'npm-audit', detected: false, alerts: 0 }], alerts: [] })
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
