// Opt-in live check of the Linear client against the sandbox workspace. It sends reads only, and `npm test`
// does not load it (the name does not end in .test.mjs).
//
//   set -a; . ./.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=<url key> node --test scripts/lib/linear/client-live.mjs
//
// PMKIT_LIVE_WORKSPACE is the URL key the key is expected to belong to. It stays out of the repository.
// Every test is skipped, with one reason, unless PMKIT_LIVE is 1, PMKIT_LIVE_WORKSPACE is set and
// LINEAR_API_KEY is usable.

import assert from 'node:assert/strict'
import test from 'node:test'
import { isPmkitError } from '../errors.mjs'
import { createLinearClient, isMutation } from './client.mjs'
import { linearCredential } from './credential.mjs'

const WORKSPACE = process.env.PMKIT_LIVE_WORKSPACE

function skipReason() {
  if (process.env.PMKIT_LIVE !== '1') return 'set PMKIT_LIVE=1 to run the live check'
  if (!WORKSPACE) return 'set PMKIT_LIVE_WORKSPACE to the sandbox workspace URL key'
  try {
    linearCredential(process.env)
  } catch (error) {
    return `LINEAR_API_KEY is not usable: ${error.message}`
  }
  return false
}

const skip = skipReason()
const KEY = skip ? undefined : linearCredential(process.env).authorization

/** Wraps the global fetch and refuses any mutation, so the check stays read-only. */
async function guardedFetch(url, init) {
  const { query } = JSON.parse(init.body)
  if (isMutation(query)) throw new Error('client-live is read-only: refusing to send a mutation')
  return globalThis.fetch(url, init)
}

const tracker = (workspace) => ({ system: 'linear', scope: { workspace } })
const client = (options = {}) =>
  createLinearClient({ env: process.env, tracker: tracker(WORKSPACE), fetch: guardedFetch, ...options })

function assertNoKey(error) {
  assert.ok(isPmkitError(error), `expected a PmkitError, got ${error}`)
  for (const text of [error.message, error.nextStep, JSON.stringify(error.details ?? null)]) {
    assert.ok(!text.includes(KEY), 'an error holds the key')
  }
}

const ISSUES =
  'query LiveIssues($first: Int!, $after: String) { issues(first: $first, after: $after) { pageInfo { hasNextPage endCursor } nodes { id } } }'

test('the session pins to the expected workspace', { skip }, async () => {
  const session = await client().session()
  assert.equal(session.pinned, true)
  assert.equal(session.workspace.urlKey, WORKSPACE)
  assert.ok(!JSON.stringify(session).includes(KEY))
})

test('a wrong workspace is AUTH', { skip }, async () => {
  const error = await client({ tracker: tracker('pmkit-no-such-workspace') }).session().catch((caught) => caught)
  assert.equal(error.code, 'AUTH')
  assertNoKey(error)
})

test('a key Linear does not know is AUTH', { skip }, async () => {
  const env = { LINEAR_API_KEY: `lin_api_${'x'.repeat(40)}` }
  const error = await client({ env }).session().catch((caught) => caught)
  assert.equal(error.code, 'AUTH')
  assert.equal(error.message, 'Linear rejected LINEAR_API_KEY')
  assertNoKey(error)
})

test('paginate returns two distinct issues and rateLimit fills in', { skip }, async () => {
  const linear = client()
  const { nodes } = await linear.paginate(ISSUES, {}, { select: (data) => data.issues, pageSize: 1, limit: 2 })
  assert.equal(nodes.length, 2)
  assert.notEqual(nodes[0].id, nodes[1].id)
  assert.equal(typeof linear.rateLimit().requests.limit, 'number')
  assert.ok(!JSON.stringify(linear.rateLimit()).includes(KEY))
})

test('an unknown field is UPSTREAM with GRAPHQL_VALIDATION_FAILED', { skip }, async () => {
  const error = await client().request('query LiveBad { viewer { noSuchField } }').catch((caught) => caught)
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.details.linear.errors[0].code, 'GRAPHQL_VALIDATION_FAILED')
  assertNoKey(error)
})

test('an unknown issue id is UPSTREAM with INPUT_ERROR', { skip }, async () => {
  const document = 'query LiveIssue { issue(id: "00000000-0000-4000-8000-000000000000") { id } }'
  const error = await client().request(document).catch((caught) => caught)
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.details.linear.errors[0].code, 'INPUT_ERROR')
  assertNoKey(error)
})
