import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { findLeaks, finish } from './run-tests.mjs'
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
