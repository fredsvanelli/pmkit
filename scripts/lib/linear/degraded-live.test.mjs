// Offline checks of the live degraded-path script. Nothing here opens a socket or loads a key.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEGRADED_ALLOWLIST, LIVE_ROWS, REQUEST_CAP, checkRow, fillArgv } from './degraded-live.mjs'
import { SUITE_ALLOWLIST } from './sandbox.mjs'

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'degraded-live.mjs')

test('without PMKIT_LIVE the script skips with one reason and sends nothing', () => {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME }
  const done = spawnSync(process.execPath, ['--test', SCRIPT], { env, encoding: 'utf8' })
  assert.equal(done.status, 0, done.stdout + done.stderr)
  assert.match(done.stdout, /set PMKIT_LIVE=1 to run the live check/)
  assert.match(done.stdout, /# skipped 1/)
})

test('the allowlist holds issueCreate, issueUpdate, issueDelete and projectDelete, taken from the suite rules', () => {
  assert.deepEqual(Object.keys(DEGRADED_ALLOWLIST).sort(), ['issueCreate', 'issueDelete', 'issueUpdate', 'projectDelete'])
  for (const [root, rule] of Object.entries(DEGRADED_ALLOWLIST)) assert.equal(rule, SUITE_ALLOWLIST[root])
})

test('the request cap is 300', () => assert.equal(REQUEST_CAP, 300))

test('the live rows are a countable list, each with an argv and an expected exit code', () => {
  assert.equal(LIVE_ROWS.length, 26)
  for (const row of LIVE_ROWS) {
    assert.ok(Array.isArray(row.argv) && row.argv.length > 0)
    assert.ok([0, 2].includes(row.code))
    assert.ok(row.noNote || row.note || row.noteStarts || row.refusal, row.argv.join(' '))
  }
})

test('fillArgv replaces the seeded identifiers and the body path', () => {
  assert.deepEqual(fillArgv(['issues', 'get', '{A}', '{BODY}'], { A: 'PKT-1', BODY: '/b.md' }), ['issues', 'get', 'PKT-1', '/b.md'])
})

test('checkRow accepts the expected note and rejects an extra one', () => {
  const row = { argv: ['events'], code: 0, note: 'note: events computed from Linear issue history' }
  checkRow(row, { code: 0, stdout: '', stderr: 'note: events computed from Linear issue history\n' })
  assert.throws(() => checkRow(row, { code: 0, stdout: '', stderr: 'note: a\nnote: b\n' }))
  assert.throws(() => checkRow({ argv: ['x'], code: 2, refusal: 'NOT_SUPPORTED' }, { code: 2, stdout: '{"error":{"code":"OTHER"}}', stderr: '' }))
})
