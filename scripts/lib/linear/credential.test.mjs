import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PmkitError } from '../errors.mjs'
import { linearCredential } from './credential.mjs'

const FAKE = 'lin_api_TESTKEYTESTKEYTESTKEY'

function authError(env) {
  try {
    linearCredential(env)
  } catch (error) {
    return error
  }
  assert.fail('linearCredential did not throw')
}

test('linearCredential returns the key as the Authorization value', () => {
  assert.deepEqual(linearCredential({ LINEAR_API_KEY: FAKE }), { authorization: FAKE, source: 'LINEAR_API_KEY' })
})

test('a missing or empty key throws AUTH with /pmkit:setup', () => {
  for (const env of [{}, { LINEAR_API_KEY: '' }]) {
    const error = authError(env)
    assert.ok(error instanceof PmkitError)
    assert.equal(error.code, 'AUTH')
    assert.equal(error.message, 'LINEAR_API_KEY is not set')
    assert.equal(error.nextStep, '/pmkit:setup')
  }
})

test('a key that is not bare throws AUTH and the error holds no part of it', () => {
  for (const value of [`Bearer ${FAKE}`, `${FAKE}\n`, ` ${FAKE}`, `${FAKE}\t`, `${FAKE}é`]) {
    const error = authError({ LINEAR_API_KEY: value })
    assert.equal(error.code, 'AUTH')
    assert.equal(error.message, 'LINEAR_API_KEY is not a bare Linear key')
    assert.equal(error.nextStep, 'Export the key as Linear shows it, with no quotes, spaces or Bearer prefix')
    for (const text of [error.message, error.nextStep]) {
      assert.ok(!text.includes('TESTKEY'))
      assert.ok(!text.includes(value))
    }
  }
})

test('a value without the lin_api_ prefix passes', () => {
  assert.equal(linearCredential({ LINEAR_API_KEY: 'abc123' }).authorization, 'abc123')
})

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, found)
    else if (entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs')) found.push(full)
  }
  return found
}

test('only credential.mjs reads LINEAR_API_KEY from an env', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const matches = walk(path.join(root, 'scripts'))
    .filter((file) => /env(\.LINEAR_API_KEY|\[['"]LINEAR_API_KEY['"]\])/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
  assert.deepEqual(matches, ['scripts/lib/linear/credential.mjs'])
})
