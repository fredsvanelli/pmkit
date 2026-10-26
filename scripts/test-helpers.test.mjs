import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { fakeGh } from './fake-gh.mjs'
import { hashTree, makeRepo, removeTempDirs, tempDir } from './test-helpers.mjs'

const leakyFixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'leaky.fixture.mjs')

test('tempDir makes a folder under os.tmpdir() with the prefix', () => {
  const dir = tempDir('pmkit-x-')
  assert.ok(fs.existsSync(dir))
  assert.equal(path.dirname(dir), os.tmpdir())
  assert.ok(path.basename(dir).startsWith('pmkit-x-'))
})

test('removeTempDirs removes every recorded folder and tolerates one already gone', () => {
  const a = tempDir()
  const b = tempDir()
  fs.rmSync(a, { recursive: true })
  assert.doesNotThrow(() => removeTempDirs())
  assert.ok(!fs.existsSync(a))
  assert.ok(!fs.existsSync(b))
  assert.doesNotThrow(() => removeTempDirs())
})

test('makeRepo and fakeGh folders are registered', () => {
  const root = makeRepo()
  const { dir } = fakeGh({})
  removeTempDirs()
  assert.ok(!fs.existsSync(root))
  assert.ok(!fs.existsSync(dir))
})

test('a folder is removed after a test that throws', () => {
  const out = path.join(tempDir('pmkit-out-'), 'leaky-path')
  // NODE_TEST_CONTEXT marks a process as a child of a test run. Without removing it the fixture would not report its failure.
  const { NODE_TEST_CONTEXT, ...env } = process.env
  const result = spawnSync(process.execPath, ['--test', leakyFixture], {
    encoding: 'utf8',
    env: { ...env, LEAKY_OUT: out, TMPDIR: tempDir('pmkit-tmp-') },
  })
  assert.equal(result.status, 1)
  const leaked = fs.readFileSync(out, 'utf8')
  assert.ok(leaked.length > 0)
  assert.ok(!fs.existsSync(leaked))
})

test('hashTree skips the named top-level entries', () => {
  const dir = tempDir('pmkit-hash-')
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
})
