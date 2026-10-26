import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hashTree } from './test-helpers.mjs'

test('hashTree skips the named top-level entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-hash-'))
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one')
    fs.mkdirSync(path.join(dir, '.git'))
    fs.writeFileSync(path.join(dir, '.git', 'x'), 'first')
    const all = hashTree(dir)
    const skipGit = hashTree(dir, ['.git'])
    fs.writeFileSync(path.join(dir, '.git', 'x'), 'second')
    assert.notEqual(hashTree(dir), all)
    assert.equal(hashTree(dir, ['.git']), skipGit)
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two')
    assert.notEqual(hashTree(dir, ['.git']), skipGit)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
