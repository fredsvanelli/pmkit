// PMK-222: `issues link --remove` with several targets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hashTree, makeRepo } from './test-helpers.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pmkit.mjs')
const ENV = { ...process.env, PMKIT_USER: 'fred', PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }

const run = (cwd, args) => spawnSync(process.execPath, [CLI, ...args], { cwd, env: ENV, encoding: 'utf8' })
const json = (cwd, args) => {
  const result = run(cwd, [...args, '--json'])
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

/** A repo with four new issues: the first blocks the next three. */
function withLinks(fn) {
  const root = makeRepo('basic')
  try {
    const ids = ['A', 'B', 'C', 'D'].map((title) => json(root, ['issues', 'create', '--title', title]).after.id)
    for (const other of ids.slice(1)) json(root, ['issues', 'link', ids[0], other, '--kind', 'blocks'])
    fn(root, ids)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const blockedBy = (root, id) => json(root, ['issues', 'get', id]).blockedBy

test('link --remove with several targets removes each link, and the dry run returns one result per target and writes nothing', () => {
  withLinks((root, [a, b, c]) => {
    const before = hashTree(root)
    const dry = json(root, ['issues', 'link', a, b, c, '--kind', 'blocks', '--remove', '--dry-run'])
    assert.deepEqual(dry.results.map((item) => item.to), [b, c])
    assert.equal(hashTree(root), before)
    const done = json(root, ['issues', 'link', a, b, c, '--kind', 'blocks', '--remove'])
    assert.deepEqual(done.results.map((item) => item.to), [b, c])
    assert.deepEqual(blockedBy(root, b), [])
    assert.deepEqual(blockedBy(root, c), [])
    assert.deepEqual(json(root, ['issues', 'get', a]).blocks.length, 1)
  })
})

test('one target keeps the single-target JSON', () => {
  withLinks((root, [a, b]) => {
    const done = json(root, ['issues', 'link', a, b, '--kind', 'blocks', '--remove'])
    assert.equal(done.results, undefined)
    assert.equal(done.before.id, a)
    assert.equal(done.after.id, a)
  })
})

test('several targets need --remove, a repeated target is refused, and both write nothing', () => {
  withLinks((root, [a, b, c]) => {
    const before = hashTree(root)
    for (const args of [[a, b, c, '--kind', 'related'], [a, b, b, '--kind', 'blocks', '--remove'], [a, b, a, '--kind', 'blocks', '--remove']]) {
      const result = run(root, ['issues', 'link', ...args, '--json'])
      assert.equal(result.status, 2, result.stdout)
      assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT')
    }
    assert.equal(run(root, ['issues', 'link', a, '--kind', 'blocks']).status, 2)
    assert.equal(hashTree(root), before)
  })
})

test('a failure partway stops, keeps what was written, and lists applied, failed and remaining', () => {
  withLinks((root, [a, b, , d]) => {
    const result = run(root, ['issues', 'link', a, b, 'ISS-ZZZZ', d, '--kind', 'blocks', '--remove', '--json'])
    assert.equal(result.status, 2, result.stdout)
    const body = JSON.parse(result.stdout)
    assert.equal(body.error.code, 'NOT_FOUND')
    assert.match(body.error.message, /^ISS-ZZZZ failed after 1 of 3 unlinks: /)
    assert.deepEqual(body.result.applied, [b])
    assert.equal(body.result.failed.to, 'ISS-ZZZZ')
    assert.equal(body.result.failed.code, 'NOT_FOUND')
    assert.deepEqual(body.result.remaining, [d])
    assert.deepEqual(blockedBy(root, b), [])
    assert.deepEqual(blockedBy(root, d), [a])
  })
})

test('a dry run that fails partway says nothing was written', () => {
  withLinks((root, [a, b, , d]) => {
    const before = hashTree(root)
    const result = run(root, ['issues', 'link', a, b, 'ISS-ZZZZ', d, '--kind', 'blocks', '--remove', '--dry-run', '--json'])
    assert.equal(result.status, 2, result.stdout)
    const body = JSON.parse(result.stdout)
    assert.deepEqual(body.result.applied, [b])
    assert.match(body.error.nextStep, /^Nothing was written \(dry run\)/)
    assert.doesNotMatch(body.error.nextStep, /are unlinked/)
    const text = run(root, ['issues', 'link', a, b, 'ISS-ZZZZ', d, '--kind', 'blocks', '--remove', '--dry-run'])
    assert.match(text.stdout + text.stderr, /would unlink: /)
    assert.doesNotMatch(text.stdout + text.stderr, /applied: /)
    assert.equal(hashTree(root), before)
  })
})
