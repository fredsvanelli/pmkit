import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { childEnv, findLeaks, finish } from './run-tests.mjs'
import { tempDir } from './test-helpers.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function privateDir(...entries) {
  const dir = tempDir('pmkit-leaks-')
  for (const name of entries) fs.mkdirSync(path.join(dir, name))
  return dir
}

test('findLeaks returns nothing for an empty folder', () => {
  assert.deepEqual(findLeaks(privateDir()), [])
})

test('findLeaks names what is left', () => {
  assert.deepEqual(findLeaks(privateDir('pmkit-x')), ['pmkit-x'])
})

test('finish returns the exit code and removes the private folder', () => {
  const stderr = process.stderr.write
  process.stderr.write = () => true
  try {
    for (const [entries, status, expected] of [[[], 0, 0], [[], 3, 3], [['pmkit-x'], 0, 1]]) {
      const dir = privateDir(...entries)
      assert.equal(finish(dir, status), expected)
      assert.equal(fs.existsSync(dir), false)
    }
  } finally {
    process.stderr.write = stderr
  }
})

test('package.json test script runs the runner', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.mjs')
})

test('childEnv drops the Linear key and the live gate and points the temp folders at the private folder', () => {
  const env = childEnv({ LINEAR_API_KEY: 'k', PMKIT_LIVE: '1', PATH: 'p' }, '/tmp/x')
  assert.equal('LINEAR_API_KEY' in env, false)
  assert.equal('PMKIT_LIVE' in env, false)
  assert.equal(env.PATH, 'p')
  assert.equal(env.TMPDIR, '/tmp/x')
  assert.equal(env.TMP, '/tmp/x')
  assert.equal(env.TEMP, '/tmp/x')
})
