import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PmkitError } from '../errors.mjs'
import { bitbucketCredential } from './credential.mjs'

const TOKEN = 'ATATTBBTESTTOKENTESTTOKEN'
const BARE_STEP = 'Export the token as Atlassian shows it, with no quotes, spaces or Bearer prefix'

function authError(env) {
  try {
    bitbucketCredential(env)
  } catch (error) {
    return error
  }
  assert.fail('bitbucketCredential did not throw')
}

test('bitbucketCredential returns a Bearer header of the token', () => {
  assert.deepEqual(bitbucketCredential({ BITBUCKET_TOKEN: TOKEN }), { authorization: `Bearer ${TOKEN}`, source: 'BITBUCKET_TOKEN' })
})

test('a missing or empty BITBUCKET_TOKEN throws AUTH with /pmkit:setup', () => {
  for (const env of [{}, { BITBUCKET_TOKEN: '' }]) {
    const error = authError(env)
    assert.ok(error instanceof PmkitError)
    assert.equal(error.code, 'AUTH')
    assert.equal(error.message, 'BITBUCKET_TOKEN is not set')
    assert.equal(error.nextStep, '/pmkit:setup')
  }
})

test('a token that is not bare throws AUTH and the error holds no part of it', () => {
  for (const token of ['Bearer x', '"x"', `Bearer ${TOKEN}`, `"${TOKEN}"`, `${TOKEN} x`, `${TOKEN}\n`, ` ${TOKEN}`, `${TOKEN}é`, 42]) {
    const error = authError({ BITBUCKET_TOKEN: token })
    assert.ok(error instanceof PmkitError)
    assert.equal(error.code, 'AUTH')
    assert.equal(error.message, 'BITBUCKET_TOKEN is not a bare Bitbucket token')
    assert.equal(error.nextStep, BARE_STEP)
    for (const text of [error.message, error.nextStep, JSON.stringify(error.details ?? {})]) assert.ok(!text.includes('TESTTOKEN'))
  }
})

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, found)
    else if (entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs')) found.push(full)
  }
  return found
}

test('only credential.mjs reads BITBUCKET_TOKEN from an env', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const matches = walk(path.join(root, 'scripts'))
    .filter((file) => /env(\.BITBUCKET_TOKEN|\[['"]BITBUCKET_TOKEN['"]\])/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
  assert.deepEqual(matches, ['scripts/lib/bitbucket/credential.mjs'])
})
