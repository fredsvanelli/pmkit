import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PmkitError } from '../errors.mjs'
import { jiraCredential } from './credential.mjs'

const EMAIL = 'pmkit-test@example.com'
const TOKEN = 'ATATTTESTTOKENTESTTOKENTESTTOKEN'
const BARE_STEP = 'Export the value as Atlassian shows it, with no quotes, spaces or Basic prefix'

function authError(env) {
  try {
    jiraCredential(env)
  } catch (error) {
    return error
  }
  assert.fail('jiraCredential did not throw')
}

test('jiraCredential returns a Basic header of email:token', () => {
  assert.deepEqual(jiraCredential({ JIRA_EMAIL: EMAIL, JIRA_API_TOKEN: TOKEN }), {
    authorization: `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`, 'utf8').toString('base64')}`,
    source: 'JIRA_API_TOKEN',
  })
})

test('a missing or empty variable throws AUTH with /pmkit:setup, the email first', () => {
  const cases = [
    [{}, 'JIRA_EMAIL is not set'],
    [{ JIRA_EMAIL: '', JIRA_API_TOKEN: TOKEN }, 'JIRA_EMAIL is not set'],
    [{ JIRA_EMAIL: EMAIL }, 'JIRA_API_TOKEN is not set'],
    [{ JIRA_EMAIL: EMAIL, JIRA_API_TOKEN: '' }, 'JIRA_API_TOKEN is not set'],
  ]
  for (const [env, message] of cases) {
    const error = authError(env)
    assert.ok(error instanceof PmkitError)
    assert.equal(error.code, 'AUTH')
    assert.equal(error.message, message)
    assert.equal(error.nextStep, '/pmkit:setup')
  }
})

test('a value that is not bare throws AUTH and the error holds no part of it', () => {
  const cases = [
    ...['a b@example.com', 'nobody', `${EMAIL}\n`, ` ${EMAIL}`].map((email) => [{ JIRA_EMAIL: email, JIRA_API_TOKEN: TOKEN }, 'JIRA_EMAIL is not a bare email address']),
    ...[`${TOKEN} x`, `${TOKEN}\n`, `${TOKEN}\t`, `Basic ${TOKEN}`, `${TOKEN}é`].map((token) => [{ JIRA_EMAIL: EMAIL, JIRA_API_TOKEN: token }, 'JIRA_API_TOKEN is not a bare Jira API token']),
  ]
  for (const [env, message] of cases) {
    const error = authError(env)
    assert.equal(error.code, 'AUTH')
    assert.equal(error.message, message)
    assert.equal(error.nextStep, BARE_STEP)
    for (const text of [error.message, error.nextStep]) {
      assert.ok(!text.includes('TESTTOKEN'))
      assert.ok(!text.includes('pmkit-test'))
    }
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

test('only credential.mjs reads JIRA_EMAIL or JIRA_API_TOKEN from an env', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const matches = walk(path.join(root, 'scripts'))
    .filter((file) => /env(\.JIRA_(EMAIL|API_TOKEN)|\[['"]JIRA_(EMAIL|API_TOKEN)['"]\])/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
  assert.deepEqual(matches, ['scripts/lib/jira/credential.mjs'])
})
