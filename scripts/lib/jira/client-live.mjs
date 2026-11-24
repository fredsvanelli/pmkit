// Opt-in live check of the Jira client against a Jira Cloud site (PMK-364): anonymous serverInfo, the session check with a
// classic and a scoped token, the AUTH and NOT_CONFIGURED answers, the rate-limit headers and a write round trip.
// `npm test` does not load it (the name does not end in .test.mjs), and scripts/run-tests.mjs strips PMKIT_LIVE from its child.
//
//   PMKIT_LIVE=1 PMKIT_LIVE_JIRA_SITE=<host> [PMKIT_LIVE_JIRA_SPACE=<key>] [PMKIT_LIVE_JIRA_SCOPED_TOKEN=<token>] \
//     node --test scripts/lib/jira/client-live.mjs
//
// with JIRA_EMAIL and JIRA_API_TOKEN exported as for any Jira run (ADR 0013). The site host and the space key stay out of the
// repository. Every test is skipped, with its reason, unless PMKIT_LIVE is 1, PMKIT_LIVE_JIRA_SITE is set and the credential reads.
// The write test writes only to PMKIT_LIVE_JIRA_SPACE, a throwaway space, and deletes what it created. No 429 is provoked: a
// burst on a real site is not worth it, and client.test.mjs covers the mapping on the fake (PMK-364 interview, Q3).

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { isPmkitError } from '../errors.mjs'
import { createJiraClient } from './client.mjs'
import { jiraCredential } from './credential.mjs'

const env = process.env
const SITE = env.PMKIT_LIVE_JIRA_SITE
const SPACE = env.PMKIT_LIVE_JIRA_SPACE
const SCOPED = env.PMKIT_LIVE_JIRA_SCOPED_TOKEN

function skipReason() {
  if (env.PMKIT_LIVE !== '1') return 'set PMKIT_LIVE=1 to run the live check'
  if (!SITE) return 'set PMKIT_LIVE_JIRA_SITE to the Jira Cloud site host'
  try {
    jiraCredential(env)
  } catch (error) {
    return `JIRA_EMAIL and JIRA_API_TOKEN are not usable: ${error.message}`
  }
  return false
}

const skip = skipReason()
const AUTHORIZATION = skip ? undefined : jiraCredential(env).authorization
// The email and the token come back out of the header, so credential.mjs stays their only reader (ADR 0013).
const PAIR = skip ? '' : Buffer.from(AUTHORIZATION.slice(6), 'base64').toString('utf8')
const SECRETS = skip ? [] : [PAIR.slice(0, PAIR.indexOf(':')), PAIR.slice(PAIR.indexOf(':') + 1), AUTHORIZATION, AUTHORIZATION.slice(6), SCOPED].filter(Boolean)

const tracker = (site = SITE) => ({ system: 'jira', scope: { site, space: SPACE ?? 'NONE' } })
const client = (options = {}) => createJiraClient({ env, tracker: tracker(), ...options })
const randomHex = (bytes) => randomBytes(bytes).toString('hex')

function assertNoSecret(text) {
  for (const secret of SECRETS) assert.ok(!String(text).includes(secret), 'a credential reached the output')
}

/** The PmkitError a promise rejects with, checked for the credential. */
async function failure(promise) {
  try {
    await promise
  } catch (error) {
    assert.ok(isPmkitError(error), `expected a PmkitError, got ${error}`)
    for (const text of [error.message, error.nextStep, JSON.stringify(error.details ?? null)]) assertNoSecret(text)
    return error
  }
  assert.fail('did not throw')
}

test('anonymous serverInfo says Cloud', { skip }, async (t) => {
  const response = await globalThis.fetch(`https://${SITE}/rest/api/3/serverInfo`, { headers: { Accept: 'application/json' } })
  assert.equal(response.status, 200)
  const info = await response.json()
  assert.equal(info.deploymentType, 'Cloud')
  t.diagnostic(`deploymentType ${info.deploymentType}`)
})

async function checkSession(t, sessionEnv) {
  const session = await createJiraClient({ env: sessionEnv, tracker: tracker() }).session()
  assert.equal(session.source, 'JIRA_API_TOKEN')
  assert.equal(session.site, SITE.toLowerCase())
  assert.ok(typeof session.viewer.accountId === 'string' && session.viewer.accountId !== '', 'no viewer account id')
  t.diagnostic('session: source JIRA_API_TOKEN, viewer set')
}

test('the token passes the session check on the site host', { skip }, (t) => checkSession(t, env))

test(
  'a scoped token passes the session check on the site host',
  { skip: skip || (!SCOPED && 'set PMKIT_LIVE_JIRA_SCOPED_TOKEN to a scoped API token to check it on the site host') },
  (t) => checkSession(t, { ...env, JIRA_API_TOKEN: SCOPED }),
)

test('a wrong token is AUTH', { skip }, async (t) => {
  const error = await failure(createJiraClient({ env: { ...env, JIRA_API_TOKEN: `ATATT${randomHex(20)}` }, tracker: tracker() }).session())
  assert.equal(error.code, 'AUTH')
  assert.match(error.message, /may have expired/)
  t.diagnostic(`${error.code}: ${error.message}`)
})

test('an unknown site is NOT_CONFIGURED', { skip }, async (t) => {
  const site = `pmkit-live-${randomHex(6)}.atlassian.net`
  const error = await failure(createJiraClient({ env, tracker: tracker(site) }).session())
  assert.equal(error.code, 'NOT_CONFIGURED')
  t.diagnostic(`${error.code}: ${error.message}`)
})

test('a normal answer carries the rate-limit headers', { skip }, async (t) => {
  // The session check first, so the token reaches only a host that said it is Jira Cloud, as in the client.
  await client().session()
  const response = await globalThis.fetch(`https://${SITE}/rest/api/3/myself`, {
    headers: { Accept: 'application/json', Authorization: AUTHORIZATION },
    redirect: 'manual',
  })
  await response.arrayBuffer()
  assert.equal(response.status, 200)
  const limit = response.headers.get('x-ratelimit-limit')
  const remaining = response.headers.get('x-ratelimit-remaining')
  assert.match(limit ?? '', /^\d+$/)
  assert.match(remaining ?? '', /^\d+$/)
  t.diagnostic(`x-ratelimit-limit ${limit}, x-ratelimit-remaining ${remaining}`)
})

test(
  'a work item round trip in the throwaway space',
  { skip: skip || (!SPACE && 'set PMKIT_LIVE_JIRA_SPACE to the key of a throwaway space to check a write') },
  async (t) => {
    const jira = client()
    const space = await jira.request('GET', `/rest/api/3/project/${encodeURIComponent(SPACE)}`)
    const types = space.issueTypes ?? []
    const type = types.find((item) => item.hierarchyLevel === 0) ?? types.find((item) => item.subtask !== true)
    assert.ok(type, `space ${SPACE} has no work type to create`)
    const created = await jira.request('POST', '/rest/api/3/issue', {
      body: { fields: { project: { key: SPACE }, issuetype: { id: type.id }, summary: 'pmkit-live client check' } },
    })
    const path = `/rest/api/3/issue/${encodeURIComponent(created.key)}`
    // Printed first, so a delete that fails leaves the key of the work item to remove by hand.
    t.diagnostic(`created ${created.key}`)
    try {
      const read = await jira.request('GET', path, { query: { fields: 'summary' } })
      assert.equal(read.fields.summary, 'pmkit-live client check')
    } finally {
      assert.equal(await jira.request('DELETE', path), null)
      t.diagnostic(`deleted the work item of type ${type.name}`)
    }
    assert.equal((await failure(jira.request('GET', path))).code, 'NOT_FOUND')
  },
)
