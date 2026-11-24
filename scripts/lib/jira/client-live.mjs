// Opt-in live check of the Jira client against a Jira Cloud site (PMK-364): anonymous serverInfo, the session check with a
// classic and a scoped token, the AUTH and NOT_CONFIGURED answers, the rate-limit headers and a write round trip.
// Then discovery and the manifest (PMK-366), read-only: the space's style, work type levels, status categories, the field of
// each role, the license, configuration and board shapes, on the throwaway space and, when set, on a company-managed space
// (PMKIT_LIVE_JIRA_COMPANY_SPACE) and with a token without admin rights (PMKIT_LIVE_JIRA_LIMITED_EMAIL and _TOKEN).
// `npm test` does not load it (the name does not end in .test.mjs), and scripts/run-tests.mjs strips PMKIT_LIVE from its child.
//
//   PMKIT_LIVE=1 PMKIT_LIVE_JIRA_SITE=<host> [PMKIT_LIVE_JIRA_SPACE=<key>] [PMKIT_LIVE_JIRA_SCOPED_TOKEN=<token>] \
//     [PMKIT_LIVE_JIRA_COMPANY_SPACE=<key>] [PMKIT_LIVE_JIRA_LIMITED_EMAIL=<email> PMKIT_LIVE_JIRA_LIMITED_TOKEN=<token>] \
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
import { categoryOfStatus, discoveryView, fetchDiscovery } from './discovery.mjs'
import { buildJiraCapabilities } from './manifest.mjs'

const env = process.env
const SITE = env.PMKIT_LIVE_JIRA_SITE
const SPACE = env.PMKIT_LIVE_JIRA_SPACE
const SCOPED = env.PMKIT_LIVE_JIRA_SCOPED_TOKEN
const COMPANY = env.PMKIT_LIVE_JIRA_COMPANY_SPACE
const LIMITED = env.PMKIT_LIVE_JIRA_LIMITED_EMAIL && env.PMKIT_LIVE_JIRA_LIMITED_TOKEN
  ? { ...env, JIRA_EMAIL: env.PMKIT_LIVE_JIRA_LIMITED_EMAIL, JIRA_API_TOKEN: env.PMKIT_LIVE_JIRA_LIMITED_TOKEN }
  : null

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
const SECRETS = skip ? [] : [PAIR.slice(0, PAIR.indexOf(':')), PAIR.slice(PAIR.indexOf(':') + 1), AUTHORIZATION, AUTHORIZATION.slice(6), SCOPED, LIMITED?.JIRA_EMAIL, LIMITED?.JIRA_API_TOKEN].filter(Boolean)

const tracker = (site = SITE, space = SPACE ?? 'NONE') => ({ system: 'jira', scope: { site, space } })
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
  assert.ok(session.site === SITE.toLowerCase(), 'the session names another site')
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

// Discovery and the manifest (PMK-366). Read-only. The reads go through fetchDiscovery, not the tracker, so no cache is written.
const NEEDS_SPACE = skip || (!SPACE && 'set PMKIT_LIVE_JIRA_SPACE to the key of a space to check discovery')
const LEVEL_OF = { '-1': 'subtask', 0: 'standard', 1: 'epic' }
const STORY_POINTS = 'com.pyxis.greenhopper.jira:jsw-story-points'
const SPRINT = 'com.pyxis.greenhopper.jira:gh-sprint'

async function discoverSpace(space, sessionEnv = env) {
  const jira = createJiraClient({ env: sessionEnv, tracker: tracker(SITE, space) })
  const raw = await fetchDiscovery(jira, { space })
  const view = discoveryView(raw, {}, { session: await jira.session() })
  return { jira, raw, view }
}

/** Checks the discovered style, work type levels and status categories against Jira's own answers for the space. */
async function checkSpace(t, space, style) {
  const { jira, raw, view } = await discoverSpace(space)
  assert.equal(Object.keys(view)[0], 'auth')
  const project = await jira.request('GET', `/rest/api/3/project/${encodeURIComponent(space)}`)
  assert.equal(view.space.style, project.style === 'next-gen' || project.simplified === true ? 'team-managed' : 'company-managed')
  if (style) assert.equal(view.space.style, style)
  const own = (project.issueTypes ?? []).filter((type) => !type.scope?.project?.id || String(type.scope.project.id) === String(project.id))
  assert.deepEqual(raw.workTypes.map((type) => [type.id, type.level]), own.map((type) => [String(type.id), LEVEL_OF[type.hierarchyLevel] ?? String(type.hierarchyLevel)]))
  const lists = await jira.request('GET', `/rest/api/3/project/${encodeURIComponent(space)}/statuses`)
  const categoryOf = new Map(lists.flatMap((list) => list.statuses).map((status) => [status.name, categoryOfStatus(status.statusCategory?.key)]))
  for (const status of view.statuses) assert.equal(status.category, categoryOf.get(status.name), `status ${status.name}`)
  t.diagnostic(`${view.space.style}, levels ${[...new Set(raw.workTypes.map((type) => type.level))].join(' ')}, ${view.statuses.length} statuses, categories ${[...new Set(view.statuses.map((status) => status.category))].join(' ')}`)
  return { jira, raw, view }
}

/** Each role found is a field its rule names; each role left null has no such field among the space's fields. */
function checkRoles(t, raw, view) {
  const english = (field) => [field.untranslated, field.name].filter(Boolean).map((name) => name.toLowerCase())
  const named = (...names) => (field) => english(field).some((name) => names.includes(name))
  const system = (id) => (field) => field.system === id || field.id === id
  const rules = {
    estimate: (field) => field.id === raw.board?.estimationField || field.customType === STORY_POINTS || named('story point estimate', 'story points')(field),
    priority: system('priority'),
    target_date: system('duedate'),
    start_date: named('start date'),
    assignee: system('assignee'),
    acceptance_criteria: named('acceptance criteria'),
    time_spent: system('timespent'),
    sprint: (field) => field.customType === SPRINT,
  }
  for (const [role, rule] of Object.entries(rules)) {
    const found = view.fields[role]
    if (found) assert.ok(rule(raw.fields.find((field) => field.id === found.id)), `${role} is ${found.id}, which its rule does not name`)
    else assert.ok(!raw.fields.some(rule), `${role} is null, but the site has a field its rule names`)
  }
  t.diagnostic(`roles: ${Object.entries(view.fields).map(([role, field]) => `${role} ${field?.id ?? 'none'}`).join(', ')}`)
}

test('discover the throwaway space: style, work type levels and status categories', { skip: NEEDS_SPACE }, (t) => checkSpace(t, SPACE))

test('the field-role rules find the site\'s fields in the throwaway space', { skip: NEEDS_SPACE }, async (t) => {
  const { raw, view } = await discoverSpace(SPACE)
  checkRoles(t, raw, view)
})

test('the license, configuration and board reads have the documented shapes', { skip: NEEDS_SPACE }, async (t) => {
  const jira = client()
  const license = await jira.request('GET', '/rest/api/3/instance/license')
  assert.ok(Array.isArray(license.applications))
  const software = license.applications.find((app) => app.id === 'jira-software')
  if (software) assert.match(software.plan, /^(FREE|PAID|UNLICENSED)$/)
  const config = await jira.request('GET', '/rest/api/3/configuration')
  for (const key of ['issueLinkingEnabled', 'subTasksEnabled', 'timeTrackingEnabled']) assert.equal(typeof config[key], 'boolean', key)
  const { items } = await jira.paginate('/rest/agile/1.0/board', { query: { projectKeyOrId: SPACE } })
  for (const board of items) {
    assert.match(board.type, /^(scrum|kanban|simple)$/)
    const configuration = await jira.request('GET', `/rest/agile/1.0/board/${encodeURIComponent(board.id)}/configuration`)
    if (configuration.estimation) assert.equal(typeof configuration.estimation.field?.fieldId, 'string')
  }
  const { raw } = await discoverSpace(SPACE)
  assert.deepEqual(raw.license, { software: software ? software.plan.toLowerCase() : 'unlicensed' })
  t.diagnostic(`license ${software?.plan ?? 'no jira-software'}, boards ${items.map((board) => board.type).join(' ') || 'none'}, board estimation ${raw.board?.estimationField ? 'set' : 'none'}`)
})

test('capabilities on the throwaway space', { skip: NEEDS_SPACE }, async (t) => {
  const { raw, view } = await discoverSpace(SPACE)
  const entries = buildJiraCapabilities(raw, {})
  assert.equal(entries.length, 20)
  assert.ok(view.plan.software !== undefined)
  t.diagnostic(entries.map((entry) => `${entry.id} ${entry.path}`).join(', '))
})

test(
  'discover a company-managed space',
  { skip: skip || (!COMPANY && 'set PMKIT_LIVE_JIRA_COMPANY_SPACE to the key of a company-managed space') },
  async (t) => {
    const { raw, view } = await checkSpace(t, COMPANY, 'company-managed')
    checkRoles(t, raw, view)
  },
)

test(
  'a token without admin rights discovers with warnings',
  { skip: skip || NEEDS_SPACE || (!LIMITED && 'set PMKIT_LIVE_JIRA_LIMITED_EMAIL and PMKIT_LIVE_JIRA_LIMITED_TOKEN to a user without admin rights') },
  async (t) => {
    const jira = createJiraClient({ env: LIMITED, tracker: tracker() })
    const { permissions } = await jira.request('GET', '/rest/api/3/mypermissions', { query: { permissions: 'ADMINISTER' } })
    assert.equal(permissions.ADMINISTER.havePermission, false, 'the limited token is a Jira admin')
    const { view } = await discoverSpace(SPACE, LIMITED)
    for (const warning of view.warnings) assertNoSecret(warning)
    t.diagnostic(`${view.warnings.length} warnings`)
  },
)
