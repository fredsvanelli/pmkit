// Opt-in live check of the Jira client against a Jira Cloud site (PMK-364): anonymous serverInfo, the session check with a
// classic and a scoped token, the AUTH and NOT_CONFIGURED answers, the rate-limit headers and a write round trip.
// Then discovery and the manifest (PMK-366), read-only: the space's style, work type levels, status categories, the field of
// each role, the license, configuration and board shapes, on the throwaway space and, when set, on a company-managed space
// (PMKIT_LIVE_JIRA_COMPANY_SPACE) and with a token without admin rights (PMKIT_LIVE_JIRA_LIMITED_EMAIL and _TOKEN).
// Then setup (PMK-368): the real CLI runs init --tracker jira in a temporary repository; Jira is only read.
// Then the issue flows (PMK-367): the real CLI creates, links, parents, branches, assigns and moves work items in the throwaway
// space, each answer checked against Jira's raw item, and deletes them.
// Then the board features of a team-managed throwaway space (PMK-393), read-only: cycles, estimation and releases follow the
// board's Sprints, Estimation and Releases features, and the real CLI's cycle list answers while Sprints is on.
// Then the sprint flows (PMK-370): the real CLI opens, fills and closes sprints on the throwaway space's sprint board, each answer
// checked against Jira's raw sprint and work items, and deletes every sprint and work item it made.
// Then the epic, status update and release flows (PMK-373): the real CLI creates, reads, edits and moves an epic, publishes a status
// update, and creates, fills and releases versions, each answer checked against Jira's raw answers. It turns the board's Releases
// feature on when off and off again, and deletes every work item and version it made.
// Then the time tracking flows (PMK-378): the real CLI logs time and reads the entries, history and metric events of a work item,
// against Jira's raw worklogs, search and changelog, edits and deletes a worklog through the raw client, and deletes the work item.
// Then the plans flows (PMK-381), read-only: on a site without Jira Premium, the raw Plans read answers 403 and the real CLI's
// jira plans list and get answer available false with the hint; on any edition but Free or Standard the test skips (the Premium
// checks are the EPC-14 follow-up PMK-399).
// Then the Jira Product Discovery flows (PMK-384), read-only: on a site without a Jira Product Discovery project, the real CLI's
// jira ideas list answers available false with the hint and jira ideas connect refuses a key that is not an idea; on a site with
// one the test skips (the votes field and delivery link checks wait on a site with Jira Product Discovery, see PMK-384).
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
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nodeTest from 'node:test'
import { isPmkitError } from '../errors.mjs'
import { addDays } from '../local/sprints.mjs'
import { adfToText, textToAdf } from './adf.mjs'
import { createJiraClient } from './client.mjs'
import { jiraCredential } from './credential.mjs'
import { categoryOfStatus, discoveryView, fetchDiscovery } from './discovery.mjs'
import { buildJiraCapabilities, sprintBoardHint } from './manifest.mjs'
import { IDEAS_HINT } from './ideas.mjs'
import { PLANS_HINT } from './plans.mjs'
import { requiredFields } from './transitions.mjs'

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

// A failing test prints its error, and a client error can name the site (a 403's next step, a redirect); the host stays out.
const hostless = (text) => (typeof text === 'string' && SITE ? text.replaceAll(SITE, '<site>').replaceAll(SITE.toLowerCase(), '<site>') : text)
function scrub(error) {
  if (!(error instanceof Error)) return error
  for (const key of ['message', 'stack', 'nextStep']) if (typeof error[key] === 'string') error[key] = hostless(error[key])
  // An assertion prints its actual and expected values too, and a CLI answer in them can name the site.
  for (const key of ['details', 'actual', 'expected']) {
    if (typeof error[key] === 'string') error[key] = hostless(error[key])
    else if (error[key] !== null && typeof error[key] === 'object') error[key] = JSON.parse(hostless(JSON.stringify(error[key])))
  }
  return error
}
const test = (name, options, fn) => nodeTest(name, options, async (t) => {
  try {
    return await fn(t)
  } catch (error) {
    throw scrub(error)
  }
})

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
  const keyOf = new Map(lists.flatMap((list) => list.statuses).map((status) => [String(status.id), status.statusCategory?.key]))
  for (const status of raw.statuses) assert.equal(categoryOfStatus(status.categoryKey), categoryOfStatus(keyOf.get(status.id)), `status ${status.id}`)
  assert.deepEqual(view.statuses.map((status) => status.category), raw.statuses.map((status) => categoryOfStatus(status.categoryKey)))
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
  const { raw } = await discoverSpace(SPACE)
  // Discovery reads boards only for a software space; a business space has none to check.
  const { items } = raw.space.type === 'software' ? await jira.paginate('/rest/agile/1.0/board', { query: { projectKeyOrId: SPACE } }) : { items: [] }
  for (const board of items) {
    assert.match(board.type, /^(scrum|kanban|simple)$/)
    const configuration = await jira.request('GET', `/rest/agile/1.0/board/${encodeURIComponent(board.id)}/configuration`)
    if (configuration.estimation) assert.equal(typeof configuration.estimation.field?.fieldId, 'string')
  }
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

// Setup (PMK-368). The CLI runs in a temporary repository with its own user store; the only writes are local.
const CLI = fileURLToPath(new URL('../../pmkit.mjs', import.meta.url))
const STATUS_ENGLISH = { backlog: ['backlog'], in_review: ['in review', 'review', 'code review'], canceled: ['canceled', 'cancelled', "won't do", 'declined'] }
const TYPE_ENGLISH = { feature: ['story', 'feature'], bug: ['bug'], task: ['task'], chore: ['chore', 'task'] }

/** The shown name of the first wanted English name an item carries (untranslated first), skipping `taken`. */
function englishMatch(wanted, items, taken = new Set()) {
  const free = items.filter((item) => !taken.has(item.name))
  for (const name of wanted) {
    const found = free.find((item) => item.untranslated?.toLowerCase() === name) ?? free.find((item) => item.name.toLowerCase() === name)
    if (found) return found.name
  }
  return 'none'
}

/** A temporary git repository on main with its own user store, and the CLI run in it; each answer is checked for the credential. */
function liveRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-live-'))
  const repo = path.join(root, 'repo')
  fs.mkdirSync(repo)
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  const exec = (...args) => {
    const result = spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: repo, env: { ...env, PMKIT_HOME: path.join(root, 'home') }, encoding: 'utf8' })
    assertNoSecret(`${result.stdout}${result.stderr}`)
    return result
  }
  const cli = (...args) => {
    const result = exec(...args)
    assert.equal(result.status, 0, hostless(`the CLI's ${args.slice(0, 2).join(' ')} exited ${result.status}: ${result.stdout.slice(0, 400)}`))
    const parsed = JSON.parse(result.stdout)
    return parsed.data ?? parsed
  }
  /** The CLI's error answer to a run that must fail. */
  const refused = (...args) => {
    const result = exec(...args)
    assert.notEqual(result.status, 0, `the CLI's ${args.slice(0, 2).join(' ')} succeeded`)
    return JSON.parse(result.stdout).error
  }
  return { root, repo, cli, refused, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

const INIT = () => ['init', '--tracker', 'jira', '--git-host', 'none', '--site', SITE]
const FLAG = { status: '--status', fields: '--field', types: '--type-label' }
/** The init flags that accept every recommendation of a proposal. */
const acceptAll = (proposal) => proposal.questions.flatMap((question) => {
  const [, group, key] = question.path.split('.')
  return [FLAG[group], `${key}=${question.recommended}`]
})

test('setup on the throwaway space', { skip: NEEDS_SPACE }, async (t) => {
  const { repo, cli, cleanup } = liveRepo()
  const init = INIT()
  try {
    // AC 1: the spaces the token's owner can browse.
    const first = cli(...init, '--dry-run')
    const spaceQuestion = first.questions.find((question) => question.path === 'tracker.scope.space')
    assert.ok(spaceQuestion?.candidates.includes(SPACE), 'the space question does not list the throwaway space')

    // AC 2 and 3: the candidates and the recommendations, against the space's own discovery.
    const { raw } = await discoverSpace(SPACE)
    const proposal = cli(...init, '--space', SPACE, '--dry-run')
    const at = (key) => proposal.questions.find((question) => question.path === key)
    const applied = (key) => proposal.applied.find((item) => item.path === key)
    const ids = (fit) => raw.fields.filter(fit).map((field) => field.id).sort()
    const offered = (key) => (at(key)?.candidates ?? (applied(key) ? [applied(key).value] : [])).slice().sort()
    assert.deepEqual(offered('mappings.fields.estimate'), ids((field) => (field.type === 'number' && field.customType !== null) || field.id === 'timeoriginalestimate'))
    assert.deepEqual(offered('mappings.fields.acceptance_criteria'), ids((field) => field.type === 'string' && field.customType !== null))
    if (raw.board?.estimationField) assert.equal(at('mappings.fields.estimate')?.recommended ?? applied('mappings.fields.estimate').value, raw.board.estimationField)
    // The English names come from Jira's own answers, not from pmkit's discovery: statuses carry untranslatedName in the space's
    // statuses list, and work types in GET /issuetype/project.
    const jira = client()
    const lists = await jira.request('GET', `/rest/api/3/project/${encodeURIComponent(SPACE)}/statuses`)
    const statuses = [...new Map(lists.flatMap((list) => list.statuses).map((status) => [status.id, { name: status.name, untranslated: status.untranslatedName }])).values()]
    const takenStatus = new Set()
    for (const [key, wanted] of Object.entries(STATUS_ENGLISH)) {
      const expected = englishMatch(wanted, statuses, takenStatus)
      takenStatus.add(expected)
      assert.equal(at(`mappings.status.${key}`).recommended, expected, `mappings.status.${key}`)
    }
    const project = await jira.request('GET', `/rest/api/3/project/${encodeURIComponent(SPACE)}`)
    const types = await jira.request('GET', '/rest/api/3/issuetype/project', { query: { projectId: project.id } })
    const standard = types.filter((type) => type.hierarchyLevel === 0).map((type) => ({ name: type.name, untranslated: type.untranslatedName }))
    // Discovery takes a work type's English name from the statuses list (PMK-368, Q1); it must agree with Jira's untranslatedName.
    for (const type of types) {
      const found = raw.workTypes.find((item) => item.id === String(type.id))
      if (found && type.untranslatedName) assert.equal(found.untranslated, type.untranslatedName, `work type ${type.id}`)
    }
    const takenType = new Set()
    for (const [key, wanted] of Object.entries(TYPE_ENGLISH)) {
      const expected = englishMatch(wanted, standard, takenType)
      takenType.add(expected)
      assert.equal(at(`mappings.types.${key}`).recommended, expected, `mappings.types.${key}`)
    }

    // AC 3: every recommendation accepted writes a config that validate and discover accept.
    const written = cli(...init, '--space', SPACE, ...acceptAll(proposal))
    assert.deepEqual(written.questions, [])
    assert.deepEqual(cli('validate').problems, [])
    const discovered = cli('discover')
    assert.equal(discovered.space.key, SPACE)

    // AC 1: a held space the site lacks is asked again.
    const file = path.join(repo, '.pmkit', 'config.yaml')
    const missing = `PMKITX${randomHex(3).toUpperCase()}`
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(`space: ${SPACE}`, `space: ${missing}`))
    const again = cli('init', '--tracker', 'jira', '--update', '--dry-run')
    assert.equal(again.questions[0]?.path, 'tracker.scope.space')
    assert.equal(again.questions[0].broken?.was, missing)

    const recommended = proposal.questions.map((question) => `${question.path.replace('mappings.', '')}=${question.recommended}`)
    t.diagnostic(`${spaceQuestion.candidates.length} spaces; ${recommended.join(', ')}; applied ${proposal.applied.map((item) => item.path.replace('mappings.', '')).join(' ') || 'none'}; discover warnings ${discovered.warnings.length}`)
  } finally {
    cleanup()
  }
})

// Board features (PMK-393). Read-only: the CLI writes only its temporary repository.
const FEATURE = { sprints: 'jsw.agility.sprints', estimation: 'jsw.agility.estimation', releases: 'jsw.agility.releases' }

test('a team-managed space\'s capabilities follow its board features', { skip: NEEDS_SPACE }, async (t) => {
  const { jira, raw } = await discoverSpace(SPACE)
  if (raw.space.style !== 'team-managed' || !raw.board) return t.skip('the throwaway space is not a team-managed software space with a board')
  // Jira's own answer, read apart from discovery.
  const { features } = await jira.request('GET', `/rest/agile/1.0/board/${encodeURIComponent(raw.board.id)}/features`)
  const on = Object.fromEntries(Object.entries(FEATURE).map(([key, id]) => [key, features.some((item) => item.feature === id && item.state === 'ENABLED')]))
  assert.deepEqual(raw.board.features, on)
  const entries = buildJiraCapabilities(raw, {})
  const at = (id) => entries.find((item) => item.id === id)
  const sprintField = raw.fields.some((field) => field.customType === SPRINT)
  if (on.sprints && sprintField) assert.equal(at('cycles').path, 'native')
  if (!on.sprints) assert.deepEqual(at('cycles'), { id: 'cycles', path: 'absent', enableHint: sprintBoardHint(raw) })
  assert.equal(at('releases').path, on.releases ? 'native' : 'absent')
  if (!on.estimation) assert.equal(at('estimation').path, 'absent')
  if (on.sprints && sprintField) {
    // The real CLI on a repository set up on the space reads the board's sprints instead of refusing.
    const { cli, cleanup } = liveRepo()
    try {
      const proposal = cli(...INIT(), '--space', SPACE, '--dry-run')
      cli(...INIT(), '--space', SPACE, ...acceptAll(proposal))
      const sprints = cli('cycle', 'list')
      assert.ok(Array.isArray(sprints))
      t.diagnostic(`cycle list: ${sprints.length} sprints`)
    } finally {
      cleanup()
    }
  }
  t.diagnostic(`board ${raw.board.type}; features ${Object.entries(on).map(([key, value]) => `${key} ${value ? 'on' : 'off'}`).join(', ')}; cycles ${at('cycles').path}, estimation ${at('estimation').path}, releases ${at('releases').path}`)
})

// Issue flows (PMK-367). The CLI writes to the throwaway space only; every work item it makes is deleted in the finally.
/** The value fn returns once it stops throwing, tried 10 times 1 s apart: Jira's search index trails a write. */
async function eventually(fn) {
  for (let tries = 1; ; tries += 1) {
    try {
      return await fn()
    } catch (error) {
      if (tries >= 10) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}

const linksOf = (item) => item.fields.issuelinks.map((link) => ({ type: link.type.name, inward: link.inwardIssue?.key, outward: link.outwardIssue?.key }))
const taskStates = (item) => (item.fields.description?.content ?? []).filter((node) => node.type === 'taskList').flatMap((list) => list.content.map((task) => task.attrs.state))

test('issue flows on the throwaway space', { skip: NEEDS_SPACE }, async (t) => {
  const jira = client()
  const raw = (key, fields) => jira.request('GET', `/rest/api/3/issue/${encodeURIComponent(key)}`, { query: { fields } })
  const run = `pmkit${randomHex(4)}`
  const word = `word${randomHex(4)}`
  const created = []
  const made = (key) => {
    created.push(key)
    // Printed with the test's result, so a delete that fails leaves the key of the work item to remove by hand.
    t.diagnostic(`created ${key}`)
    return key
  }
  const { root, repo, cli, cleanup } = liveRepo()
  let left = []
  try {
    const proposal = cli(...INIT(), '--space', SPACE, '--dry-run')
    cli(...INIT(), '--space', SPACE, ...acceptAll(proposal))
    const config = path.join(repo, '.pmkit', 'config.yaml')
    const text = fs.readFileSync(config, 'utf8')
    const hosted = text.replace(/^git_host:\n {2}system: none$/m, 'git_host:\n  system: github\n  repo: acme/widgets\n  default_branch: main')
    assert.notEqual(hosted, text, 'the config has no git_host none block to replace')
    fs.writeFileSync(config, hosted)
    const git = (...args) => assert.equal(spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x.dev', ...args], { cwd: repo }).status, 0, `git ${args[0]}`)
    git('add', '-A')
    git('commit', '-qm', 'init')
    const criteria = path.join(root, 'criteria.txt')
    fs.writeFileSync(criteria, '- It ships\n- A test covers it\n')

    // AC 2: a description with acceptance criteria is an ADF task list, and a checked criterion round-trips.
    const a = made(cli('issues', 'create', '--title', `pmkit-live ${run} ${word}`, '--type', 'feature', '--criteria-file', criteria).after.id)
    const b = made(cli('issues', 'create', '--title', `pmkit-live ${run} blocked`, '--type', 'bug').after.id)
    const c = made(cli('issues', 'create', '--title', `pmkit-live ${run} copy`, '--type', 'task').after.id)
    assert.deepEqual(taskStates(await raw(a, 'description')), ['TODO', 'TODO'])
    assert.deepEqual(cli('issues', 'get', a).acceptanceCriteria.map((item) => item.done), [false, false])
    cli('issues', 'update', a, '--check', '1')
    assert.deepEqual(taskStates(await raw(a, 'description')), ['DONE', 'TODO'])
    assert.deepEqual(cli('issues', 'get', a).acceptanceCriteria.map((item) => [item.text, item.done]), [['It ships', true], ['A test covers it', false]])

    // AC 1: A blocks B on the site, and related and duplicate read back as pmkit shows them.
    assert.deepEqual(cli('issues', 'link', a, b, '--kind', 'blocks').after.blocks, [b])
    assert.deepEqual(linksOf(await raw(a, 'issuelinks')), [{ type: 'Blocks', inward: undefined, outward: b }])
    assert.deepEqual(linksOf(await raw(b, 'issuelinks')), [{ type: 'Blocks', inward: a, outward: undefined }])
    assert.deepEqual(cli('issues', 'get', b).blockedBy, [a])
    await eventually(() => {
      const ids = cli('issues', 'list', '--blocked').issues.map((issue) => issue.id)
      assert.ok(ids.includes(b) && !ids.includes(a), 'list --blocked does not list B alone of the two')
    })
    cli('issues', 'link', a, c, '--kind', 'related')
    assert.deepEqual([cli('issues', 'get', a).related, cli('issues', 'get', c).related], [[c], [a]])
    assert.deepEqual(cli('issues', 'link', c, a, '--kind', 'duplicate').after.duplicateOf, [a])
    assert.ok(linksOf(await raw(c, 'issuelinks')).some((link) => link.type === 'Duplicate' && link.outward === a), 'C does not duplicate A on the site')
    assert.deepEqual([cli('issues', 'get', c).duplicateOf, cli('issues', 'get', a).duplicateOf], [[a], []])

    // AC 2: a parent set, then cleared. A team-managed space takes only an epic as a standard work item's parent.
    const epic = made(cli('epic', 'create', '--title', `pmkit-live ${run} epic`).after.id)
    assert.equal(cli('issues', 'parent', b, epic).after.parent, epic)
    assert.equal((await raw(b, 'parent')).fields.parent?.key, epic)
    assert.equal(cli('issues', 'parent', b, 'none').after.parent, undefined)
    assert.equal((await raw(b, 'summary,parent')).fields.parent, undefined)

    // AC 3 and 5: the branch keeps the key upper case, is the pmkit.branch property, and search reads it back.
    const { branch } = cli('issues', 'branch', a)
    assert.ok(branch.startsWith(`${a}-`), `the branch does not start with ${a}-`)
    assert.equal((await jira.request('GET', `/rest/api/3/issue/${encodeURIComponent(a)}/properties/pmkit.branch`)).value, branch)
    await eventually(() => assert.equal(cli('issues', 'list').issues.find((issue) => issue.id === a)?.branch, branch))

    // AC 3: text ~ finds the word in the title, and only there.
    await eventually(() => assert.deepEqual(cli('issues', 'list', '--text', word).issues.map((issue) => issue.id), [a]))

    // AC 3: the assignable-users read has the shape the members come from, and assign takes the viewer from it.
    const viewer = (await jira.session()).viewer.accountId
    assert.equal(cli('issues', 'assign', a, 'me').after.assignee, viewer)
    const users = await jira.request('GET', '/rest/api/3/user/assignable/search', { query: { project: SPACE, maxResults: 50 } })
    assert.ok(users.length > 0, 'no assignable user')
    for (const user of users) for (const key of ['accountId', 'displayName', 'accountType']) assert.equal(typeof user[key], 'string', key)

    // AC 4: the dry run lists the transition's required fields (none on a team-managed space), and the move goes through.
    cli('issues', 'move', a, 'in_progress')
    const dry = cli('issues', 'move', a, 'done', '--dry-run')
    const { transitions } = await jira.request('GET', `/rest/api/3/issue/${encodeURIComponent(a)}/transitions`, { query: { expand: 'transitions.fields' } })
    const toDone = transitions.find((transition) => transition.to?.name === dry.after.status.name)
    assert.ok(toDone, 'no transition reaches the status the dry run names')
    assert.deepEqual(dry.requiredFields, requiredFields(toDone))
    cli('issues', 'move', a, 'done')
    assert.equal((await raw(a, 'status')).fields.status.statusCategory.key, 'done')

    // AC 3: the changelog in search/jql feeds the metrics.
    const today = new Date().toISOString().slice(0, 10)
    await eventually(() => assert.ok(cli('metrics', 'cycle-time', '--since', today).issues.some((entry) => entry.issue === a), 'cycle-time does not list A'))
    const [searched] = (await jira.request('GET', '/rest/api/3/search/jql', { query: { jql: `key = ${a}`, fields: 'summary', expand: 'changelog' } })).issues
    assert.ok(searched.changelog.histories.length > 0, 'the search carries no changelog')

    t.diagnostic(`${created.length} work items; blocks, related, duplicate, parent set and cleared, branch ${branch.replace(a, '<key>')}, required fields on the move to done ${dry.requiredFields.length}`)
  } finally {
    cleanup()
    left = await removeAll(jira, created, run, t)
  }
  // After the finally, so a failed step keeps its own error.
  assert.deepEqual(left, [], 'work items left in the throwaway space')
})

/**
 * Deletes the recorded work items in creation order (a child before its epic), then any other the run's word finds, and returns
 * what is still there or could not be searched. It never throws, so one failure does not stop the rest.
 */
async function removeAll(jira, created, run, t) {
  const left = []
  const remove = async (key) => {
    try {
      await jira.request('DELETE', `/rest/api/3/issue/${encodeURIComponent(key)}`, { query: { deleteSubtasks: 'true' } })
    } catch (error) {
      if (error?.code !== 'NOT_FOUND') {
        left.push(key)
        return
      }
    }
    try {
      await jira.request('GET', `/rest/api/3/issue/${encodeURIComponent(key)}`, { query: { fields: 'summary' } })
      left.push(key)
    } catch (error) {
      if (error?.code !== 'NOT_FOUND') left.push(key)
    }
  }
  for (const key of created) await remove(key)
  try {
    const { items } = await jira.paginate('/rest/api/3/search/jql', { query: { jql: `project = ${SPACE} AND summary ~ "${run}"`, fields: 'summary' }, key: 'issues' })
    for (const key of items.map((item) => item.key).filter((key) => !created.includes(key))) await remove(key)
  } catch {
    left.push('the search for strays failed')
  }
  t.diagnostic(left.length === 0 ? `deleted ${created.length} work items` : `left to delete by hand: ${left.join(', ')}`)
  return left
}

// Sprint flows (PMK-370). The CLI writes to the throwaway space only; every sprint and work item it makes is deleted in the finally,
// and so is any sprint of the board the run finds that was not there before it (Jira can make one).
test('sprint flows on the throwaway space', { skip: NEEDS_SPACE }, async (t) => {
  const { jira, raw } = await discoverSpace(SPACE)
  if (buildJiraCapabilities(raw, {}).find((entry) => entry.id === 'cycles').path !== 'native') return t.skip('the throwaway space has no sprints')
  const board = raw.board.id
  const boardSprints = async () => (await jira.paginate(`/rest/agile/1.0/board/${encodeURIComponent(board)}/sprint`, { query: { state: 'future,active,closed' }, key: 'values' })).items
  const rawSprint = (id) => jira.request('GET', `/rest/agile/1.0/sprint/${encodeURIComponent(id)}`)
  const rawItem = (key, fields, query = {}) => jira.request('GET', `/rest/api/3/issue/${encodeURIComponent(key)}`, { query: { fields, ...query } })
  const before = new Set((await boardSprints()).map((sprint) => sprint.id))
  const run = `pmkit${randomHex(4)}`
  const today = new Date().toISOString().slice(0, 10)
  const created = []
  const made = (key) => {
    created.push(key)
    t.diagnostic(`created ${key}`)
    return key
  }
  const { cli, refused, cleanup } = liveRepo()
  let left = []
  try {
    const proposal = cli(...INIT(), '--space', SPACE, '--dry-run')
    cli(...INIT(), '--space', SPACE, ...acceptAll(proposal))
    const sprintField = cli('discover').fields.sprint?.id
    assert.ok(sprintField, 'setup mapped no sprint field')

    // AC 1: the dry run sends nothing; the real run creates the sprint and starts it.
    const dry = cli('cycle', 'open', '--start', today, '--goal', run, '--name', `pmkit-live ${run}`, '--dry-run')
    assert.deepEqual([dry.after.id, dry.after.state], [null, 'active'])
    assert.deepEqual((await boardSprints()).filter((sprint) => !before.has(sprint.id)), [])
    const first = cli('cycle', 'open', '--start', today, '--goal', run, '--name', `pmkit-live ${run}`).after
    t.diagnostic(`created sprint ${first.id}`)
    assert.deepEqual([first.state, first.start, first.end, first.goal], ['active', today, addDays(today, 13), run])
    // AC 3: the dates reach Jira at 12:00 UTC exactly.
    const opened = await rawSprint(first.id)
    assert.deepEqual([opened.state, opened.startDate, opened.endDate, opened.originBoardId], ['active', `${today}T12:00:00.000Z`, `${addDays(today, 13)}T12:00:00.000Z`, board])
    const second = cli('cycle', 'open', '--start', addDays(today, 14), '--name', `pmkit-live ${run} next`).after
    t.diagnostic(`created sprint ${second.id}`)
    assert.equal(second.state, 'planned')

    // Two work items into the active sprint.
    const a = made(cli('issues', 'create', '--title', `pmkit-live ${run} unfinished`, '--type', 'feature').after.id)
    const b = made(cli('issues', 'create', '--title', `pmkit-live ${run} finished`, '--type', 'feature').after.id)
    const added = cli('cycle', 'add', a, b, '--to', first.id)
    assert.deepEqual(added.map((entry) => entry.after.sprint), [first.id, first.id])
    assert.deepEqual((await rawItem(a, sprintField)).fields[sprintField].map((sprint) => sprint.id), [Number(first.id)])
    await eventually(() => assert.deepEqual(cli('issues', 'list', '--sprint', 'current').issues.map((issue) => issue.id).sort(), [a, b].sort()))

    // AC 6: the Sprint changelog item holds sprint ids, and pmkit reads it as a sprint event.
    const histories = (await rawItem(a, 'summary', { expand: 'changelog' })).changelog.histories
    const change = histories.flatMap((history) => history.items).find((item) => item.fieldId === sprintField)
    assert.ok(change, 'no Sprint changelog item')
    assert.deepEqual([change.from || null, change.to], [null, first.id])
    const event = cli('issues', 'get', a, '--history').history.find((entry) => entry.field === 'sprint')
    assert.deepEqual([event?.from, event?.to], [null, first.id])

    // AC 5: Jira answers 204 to a subtask's move and does nothing; pmkit says so instead of reporting the move.
    const types = await jira.request('GET', '/rest/api/3/issuetype/project', { query: { projectId: raw.space.id } })
    const subtaskType = types.find((type) => type.hierarchyLevel === -1)
    const parent = made(cli('issues', 'create', '--title', `pmkit-live ${run} parent`, '--type', 'feature').after.id)
    const sub = made((await jira.request('POST', '/rest/api/3/issue', { body: { fields: { project: { key: SPACE }, issuetype: { id: subtaskType.id }, parent: { key: parent }, summary: `pmkit-live ${run} subtask` } } })).key)
    const error = refused('cycle', 'add', sub, '--to', first.id)
    assert.deepEqual([error.code, error.nextStep], ['CONFLICT', `pmkit cycle add ${parent} --to ${first.id}`])
    assert.equal((await rawItem(sub, sprintField)).fields[sprintField], null)

    // AC 1 and 2: close with A unfinished; the dry run sends nothing.
    cli('issues', 'move', b, 'done')
    // The unfinished list is a search, which trails B's move to done; the dry run can be retried, the close cannot.
    await eventually(() => assert.deepEqual(cli('cycle', 'close', first.id, '--dry-run').unfinished.map((issue) => issue.id), [a]))
    assert.equal((await rawSprint(first.id)).state, 'active')
    const closed = cli('cycle', 'close', first.id)
    assert.deepEqual([closed.sprint.state, typeof closed.sprint.closed, closed.unfinished.map((issue) => issue.id)], ['closed', 'string', [a]])
    const done = await rawSprint(first.id)
    assert.deepEqual([done.state, typeof done.completeDate], ['closed', 'string'])

    // AC 2: A stays in the closed sprint only (not carried to the planned one), Jira's backlog shows it, and pmkit reads it as no sprint (ADR 0016).
    assert.deepEqual((await rawItem(a, sprintField)).fields[sprintField].map((sprint) => [sprint.id, sprint.state]), [[Number(first.id), 'closed']])
    // The board's backlog is a search too, so it trails the close.
    await eventually(async () => {
      const backlog = (await jira.paginate(`/rest/agile/1.0/board/${encodeURIComponent(board)}/backlog`, { query: { fields: 'summary' }, key: 'issues' })).items.map((item) => item.key)
      assert.ok(backlog.includes(a), 'the board backlog does not show A')
    })
    await eventually(() => {
      const ids = cli('issues', 'list', '--sprint', 'none').issues.map((issue) => issue.id)
      assert.ok(ids.includes(a) && !ids.includes(b), '--sprint none does not list A alone of the two')
    })
    assert.equal(cli('issues', 'get', b).sprint, first.id)
    assert.equal(cli('issues', 'get', a).sprint, undefined)

    t.diagnostic(`sprints ${first.id} (opened active, closed) and ${second.id} (planned); dates at 12:00 UTC; unfinished item left in the closed sprint and shown in the backlog; subtask move refused CONFLICT`)
  } finally {
    cleanup()
    left = await removeAll(jira, created, run, t)
    for (const sprint of await boardSprints().catch(() => [])) {
      if (before.has(sprint.id)) continue
      try {
        await jira.request('DELETE', `/rest/agile/1.0/sprint/${encodeURIComponent(sprint.id)}`)
      } catch {
        left.push(`sprint ${sprint.id}`)
      }
    }
    const stray = (await boardSprints().catch(() => [{ id: 'unread' }])).filter((sprint) => !before.has(sprint.id))
    left.push(...stray.map((sprint) => `sprint ${sprint.id}`).filter((name) => !left.includes(name)))
    t.diagnostic(stray.length === 0 ? 'deleted the run\'s sprints' : `sprints left to delete by hand: ${stray.map((sprint) => sprint.id).join(', ')}`)
  }
  assert.deepEqual(left, [], 'work items or sprints left in the throwaway space')
})

// Epic, status update and release flows (PMK-373). The CLI writes to the throwaway space only. Every work item and version it makes
// is deleted in the finally, and the Releases feature, when the run turned it on, is turned off again.
test('epic, status update and release flows on the throwaway space', { skip: NEEDS_SPACE }, async (t) => {
  const { jira, raw } = await discoverSpace(SPACE)
  const epicType = raw.workTypes.find((type) => type.level === 'epic')
  if (!epicType) return t.skip('the throwaway space has no epic work type')
  const versionsPath = `/rest/api/3/project/${encodeURIComponent(SPACE)}/version`
  const rawVersions = async () => (await jira.paginate(versionsPath, { key: 'values' })).items
  const rawItem = (key, fields) => jira.request('GET', `/rest/api/3/issue/${encodeURIComponent(key)}`, { query: { fields } })
  const before = new Set((await rawVersions()).map((version) => version.id))
  const board = raw.board?.id
  const toggleReleases = (enabling) => jira.request('PUT', `/rest/agile/1.0/board/${encodeURIComponent(board)}/features`, { body: { boardId: board, feature: FEATURE.releases, enabling } })
  const run = `pmkit${randomHex(4)}`
  const today = new Date().toISOString().slice(0, 10)
  const target = addDays(today, 30)
  const created = []
  const made = (key) => {
    created.push(key)
    t.diagnostic(`created ${key}`)
    return key
  }
  const madeVersion = (version) => {
    t.diagnostic(`created version ${version.id}`)
    return version
  }
  const { root, cli, refused, cleanup } = liveRepo()
  const file = (name, text) => {
    const at = path.join(root, name)
    fs.writeFileSync(at, text)
    return at
  }
  let left = []
  let toggled = false
  try {
    if (raw.board?.features?.releases === false) {
      await toggleReleases(true)
      toggled = true
      t.diagnostic('turned Releases on for the run')
    }
    const proposal = cli(...INIT(), '--space', SPACE, '--dry-run')
    cli(...INIT(), '--space', SPACE, ...acceptAll(proposal))
    const capabilities = cli('capabilities').capabilities
    const entry = (id) => capabilities.find((item) => item.id === id)
    assert.deepEqual([entry('deliverables').path, entry('releases').path, entry('status_update').path, entry('status_update').detail], ['native', 'native', 'derived', { source: 'comment' }])
    const startField = cli('discover').fields.start_date?.id
    assert.ok(startField, 'setup mapped no start date field')

    // AC 1: create (the dry run sends nothing), read, list, progress, update and move an epic.
    const create = ['epic', 'create', '--title-file', file('epic.txt', `pmkit-live ${run} epic`), '--start', today, '--target', target, '--description-file', file('epic.md', 'Bill every customer monthly.')]
    const dry = cli(...create, '--dry-run')
    assert.equal(dry.after.id, null)
    const epic = cli(...create).after
    made(epic.id)
    assert.equal(dry.after.status.name, epic.status.name, 'the dry run names another first status')
    assert.deepEqual([epic.start, epic.target, epic.description], [today, target, 'Bill every customer monthly.'])
    assert.ok(epic.url.endsWith(`/browse/${epic.id}`), 'the epic url is not the browse page')
    const rawEpic = await rawItem(epic.id, `issuetype,duedate,${startField}`)
    assert.deepEqual([String(rawEpic.fields.issuetype.id), rawEpic.fields.duedate, rawEpic.fields[startField]], [epicType.id, target, today])

    const x = made(cli('issues', 'create', '--title', `pmkit-live ${run} child`, '--type', 'feature').after.id)
    assert.equal(cli('issues', 'parent', x, epic.id).after.parent, epic.id)
    assert.equal((await rawItem(x, 'parent')).fields.parent?.key, epic.id)
    await eventually(() => {
      const ids = cli('issues', 'list').issues.map((issue) => issue.id)
      assert.ok(ids.includes(x) && !ids.includes(epic.id), 'issues list does not list the child alone of the two')
    })
    await eventually(() => assert.ok(cli('epic', 'list').some((item) => item.id === epic.id), 'epic list does not list the epic'))
    assert.deepEqual(cli('epic', 'get', epic.id), epic)
    await eventually(() => {
      const progress = cli('epic', 'progress', epic.id)
      assert.deepEqual([progress.total, progress.done, progress.open], [1, 0, [x]])
    })
    const renamed = `pmkit-live ${run} epic v2`
    assert.equal(cli('epic', 'update', epic.id, '--title', renamed).after.title, renamed)
    assert.equal((await rawItem(epic.id, 'summary')).fields.summary, renamed)

    // AC 2: the status update is a comment whose property Jira keeps and returns with expand=properties; a plain comment is no update.
    const update = cli('epic', 'update-status', epic.id, '--health', 'at_risk', '--body-file', file('update.md', 'The payment provider is late.')).after
    assert.deepEqual([update.health, update.author, update.body], ['at_risk', (await jira.session()).viewer.accountId, 'The payment provider is late.'])
    const commentsPath = `/rest/api/3/issue/${encodeURIComponent(epic.id)}/comment`
    const [comment] = (await jira.request('GET', commentsPath, { query: { expand: 'properties' } })).comments
    assert.deepEqual(comment.properties, [{ key: 'pmkit.statusUpdate', value: { health: 'at_risk' } }])
    assert.match(adfToText(comment.body), /^Status update: At risk/)
    await jira.request('POST', commentsPath, { body: { body: textToAdf('pmkit-live plain comment') } })
    assert.deepEqual(cli('epic', 'updates', epic.id).map((item) => [item.health, item.body]), [['at_risk', 'The payment provider is late.']])
    assert.equal(cli('epic', 'get', epic.id).health, 'at_risk')

    cli('epic', 'move', epic.id, 'in_progress')
    assert.equal((await rawItem(epic.id, 'status')).fields.status.statusCategory.key, 'indeterminate')
    cli('epic', 'move', epic.id, 'done')
    assert.equal((await rawItem(epic.id, 'status')).fields.status.statusCategory.key, 'done')
    assert.equal(cli('epic', 'get', epic.id).health, undefined)

    // AC 3: release create (the dry run sends nothing), list and get, over Jira's version.
    const name = `pmkit-live-${run}`
    assert.equal(cli('release', 'create', name, '--target', target, '--dry-run').after.id, name)
    assert.deepEqual((await rawVersions()).filter((version) => !before.has(version.id)), [])
    const release = cli('release', 'create', name, '--target', target).after
    assert.deepEqual(release, { id: name, name, target, state: 'planned', description: '' })
    const version = madeVersion((await rawVersions()).find((item) => item.name === name))
    assert.deepEqual([version.releaseDate, version.released, version.archived], [target, false, false])
    assert.ok(cli('release', 'list').some((item) => item.id === name), 'release list does not list the release')
    assert.deepEqual(cli('release', 'get', name), release)

    // AC 4: Jira's fixVersion = "<id>" also matches a version named like the id; release issues keeps only the release's own.
    const alike = madeVersion(await jira.request('POST', '/rest/api/3/version', { body: { name: version.id, projectId: raw.space.id } }))
    const y = made(cli('issues', 'create', '--title', `pmkit-live ${run} alike`, '--type', 'feature', '--release', alike.name).after.id)
    assert.equal(cli('issues', 'update', x, '--release', name).after.release, name)
    assert.deepEqual((await rawItem(x, 'fixVersions')).fields.fixVersions.map((item) => item.id), [version.id])
    await eventually(async () => {
      const { issues } = await jira.request('GET', '/rest/api/3/search/jql', { query: { jql: `project = ${SPACE} AND fixVersion = "${version.id}"`, fields: 'summary' } })
      assert.deepEqual(issues.map((item) => item.key).sort(), [x, y].sort())
    })
    assert.deepEqual(cli('release', 'issues', name).map((issue) => issue.id), [x])

    // AC 5: a name taken in another case, or by an archived version, is CONFLICT and adds no version.
    const upper = refused('release', 'create', name.toUpperCase())
    assert.deepEqual([upper.code, upper.message], ['CONFLICT', `release ${name.toUpperCase()} is taken by version ${name}, which differs only in case`])
    const old = madeVersion(await jira.request('POST', '/rest/api/3/version', { body: { name: `${name}-old`, projectId: raw.space.id } }))
    await jira.request('PUT', `/rest/api/3/issue/${encodeURIComponent(y)}`, { body: { fields: { fixVersions: [{ id: alike.id }, { id: old.id }] } } })
    await jira.request('PUT', `/rest/api/3/version/${encodeURIComponent(old.id)}`, { body: { archived: true } })
    const archived = refused('release', 'create', old.name)
    assert.deepEqual([archived.code, archived.message], ['CONFLICT', `release ${old.name} is taken by archived version ${old.name}`])
    assert.equal((await rawVersions()).filter((item) => !before.has(item.id)).length, 3)

    // AC 6: Jira keeps an archived fix version on any write; pmkit shows only the live one.
    const fixIds = async (key) => (await rawItem(key, 'fixVersions')).fields.fixVersions.map((item) => item.id).sort()
    const shown = cli('issues', 'get', y)
    assert.deepEqual([shown.release, shown.releases], [alike.name, undefined])
    assert.equal(cli('issues', 'update', y, '--release', 'none').after.release, undefined)
    assert.deepEqual(await fixIds(y), [old.id])
    cli('issues', 'update', y, '--release', alike.name)
    assert.deepEqual(await fixIds(y), [alike.id, old.id].sort())

    // AC 3: the version list pages (archived versions included), and release list leaves the archived one out.
    const paged = (await jira.paginate(versionsPath, { key: 'values', pageSize: 1 })).items
    assert.deepEqual(paged.map((item) => item.id), (await rawVersions()).map((item) => item.id))
    assert.ok(paged.some((item) => item.id === old.id && item.archived), 'the paged list does not hold the archived version')
    assert.ok(!cli('release', 'list').some((item) => item.id === old.name), 'release list shows the archived version')

    // AC 3: mark released (the dry run sends nothing) is PUT released with today's date.
    assert.equal(cli('release', 'mark-released', name, '--dry-run').after.state, 'released')
    const versionPath = `/rest/api/3/version/${encodeURIComponent(version.id)}`
    assert.equal((await jira.request('GET', versionPath)).released, false)
    const marked = cli('release', 'mark-released', name)
    assert.deepEqual([marked.after.state, marked.after.released, marked.unfinished.map((issue) => issue.id)], ['released', `${today}T12:00:00Z`, [x]])
    const released = await jira.request('GET', versionPath)
    assert.deepEqual([released.released, released.releaseDate], [true, today])

    t.diagnostic(`epic created, listed, updated, moved to done; status update kept its property; ${paged.length} versions paged one by one; name-alike left out of release issues; case and archived names refused CONFLICT; archived fix version kept`)
  } finally {
    cleanup()
    left = await removeAll(jira, created, run, t)
    for (const version of await rawVersions().catch(() => [])) {
      if (before.has(version.id)) continue
      try {
        await jira.request('DELETE', `/rest/api/3/version/${encodeURIComponent(version.id)}`)
      } catch {
        left.push(`version ${version.id}`)
      }
    }
    const stray = (await rawVersions().catch(() => [{ id: 'unread' }])).filter((version) => !before.has(version.id))
    left.push(...stray.map((version) => `version ${version.id}`).filter((item) => !left.includes(item)))
    if (toggled) {
      try {
        await toggleReleases(false)
        const { features } = await jira.request('GET', `/rest/agile/1.0/board/${encodeURIComponent(board)}/features`)
        if (features.some((item) => item.feature === FEATURE.releases && item.state === 'ENABLED')) left.push('the Releases feature')
      } catch {
        left.push('the Releases feature')
      }
    }
    t.diagnostic(stray.length === 0 ? 'deleted the run\'s versions' : `versions left to delete by hand: ${stray.map((version) => version.id).join(', ')}`)
    if (toggled) t.diagnostic(left.includes('the Releases feature') ? 'Releases is still on: turn it off by hand' : 'turned Releases off again')
  }
  assert.deepEqual(left, [], 'work items, versions or the Releases feature left changed in the throwaway space')
})

// Time tracking flows (PMK-378). The CLI writes to the throwaway space only, and every work item it makes is deleted in the finally.
test('time tracking flows on the throwaway space', { skip: NEEDS_SPACE }, async (t) => {
  const jira = client()
  if ((await jira.request('GET', '/rest/api/3/configuration')).timeTrackingEnabled !== true) return t.skip('the site has time tracking off')
  const viewer = (await jira.session()).viewer.accountId
  const run = `pmkit${randomHex(4)}`
  const created = []
  const { cli, refused, cleanup } = liveRepo()
  let left = []
  try {
    const proposal = cli(...INIT(), '--space', SPACE, '--dry-run')
    cli(...INIT(), '--space', SPACE, ...acceptAll(proposal))
    assert.equal(cli('capabilities').capabilities.find((entry) => entry.id === 'time_tracking').path, 'native')
    const x = cli('issues', 'create', '--title', `pmkit-live ${run} timed`, '--type', 'feature').after.id
    created.push(x)
    t.diagnostic(`created ${x}`)
    const worklogPath = `/rest/api/3/issue/${encodeURIComponent(x)}/worklog`
    const rawWorklogs = async (pageSize) => (await jira.paginate(worklogPath, { key: 'worklogs', pageSize })).items

    // AC 1: the dry run sends nothing; each real run is a worklog of whole minutes by the viewer, started now.
    assert.equal(cli('issues', 'log-time', x, '1h30', '--dry-run').minutes, 90)
    assert.equal((await jira.request('GET', worklogPath)).total, 0)
    const sent = Date.now()
    assert.equal(cli('issues', 'log-time', x, '1h30').minutes, 90)
    assert.equal(cli('issues', 'log-time', x, '45m').minutes, 45)
    const logged = await rawWorklogs()
    assert.deepEqual(logged.map((worklog) => [worklog.timeSpentSeconds, worklog.author.accountId]), [[5400, viewer], [2700, viewer]])
    // Jira answers started in the token owner's zone (+hhmm); the instant is the one sent.
    for (const worklog of logged) assert.ok(Math.abs(Date.parse(worklog.started.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')) - sent) < 60_000, 'started is not now')
    assert.equal(refused('issues', 'log-time', x, '0').code, 'INVALID_INPUT')
    const listed = cli('issues', 'time-entries', x)
    assert.deepEqual([listed.entries.map((entry) => [entry.minutes, entry.by]), listed.total, listed.totalTime, listed.byPerson.length], [[[90, viewer], [45, viewer]], 135, '2h15', 1])

    // AC 1 and 2: GET worklog pages; a search carries 20 worklogs and the total, and the metric events read the rest.
    for (let n = 0; n < 20; n += 1) await jira.request('POST', worklogPath, { body: { timeSpentSeconds: 60, started: new Date().toISOString().replace('Z', '+0000') } })
    assert.equal((await rawWorklogs(5)).length, 22)
    await eventually(async () => {
      const { issues } = await jira.request('GET', '/rest/api/3/search/jql', { query: { jql: `key = ${x}`, fields: 'worklog' } })
      const { worklog } = issues[0].fields
      assert.deepEqual([worklog.maxResults, worklog.total, worklog.worklogs.length], [20, 22, 20])
    })
    assert.equal(cli('issues', 'time-entries', x).total, 155)
    const today = new Date().toISOString().slice(0, 10)
    await eventually(() => assert.equal(cli('events', '--since', today).filter((event) => event.issue === x && event.op === 'log_time').length, 22))

    // AC 3: the time a worklog adds is its log_time event only.
    const timeEvents = (history) => history.filter((event) => event.op === 'log_time').map((event) => event.minutes)
    const counted = (history) => history.filter((event) => /^jira:(timespent|Worklog)/.test(String(event.field)))
    let history = cli('issues', 'get', x, '--history').history
    assert.equal(timeEvents(history).length, 22)
    assert.deepEqual(counted(history), [])

    // AC 5: a worklog edited or deleted in Jira writes no item shown as a jira: update.
    const [, , edited, deleted] = await rawWorklogs()
    await jira.request('PUT', `${worklogPath}/${encodeURIComponent(edited.id)}`, { body: { timeSpentSeconds: 1800 } })
    await jira.request('DELETE', `${worklogPath}/${encodeURIComponent(deleted.id)}`)
    const changelog = (await jira.paginate(`/rest/api/3/issue/${encodeURIComponent(x)}/changelog`, { key: 'values' })).items
    assert.ok(changelog.some((entry) => entry.items.some((item) => item.field === 'WorklogTimeSpent')), 'the delete wrote no WorklogTimeSpent item')
    history = cli('issues', 'get', x, '--history').history
    assert.deepEqual([timeEvents(history).length, timeEvents(history).filter((minutes) => minutes === 30).length], [21, 1])
    // Any other jira: item Jira writes on an edit or a delete would show here; the remaining estimate is the only one kept (Q2).
    assert.deepEqual([...new Set(history.filter((event) => String(event.field).startsWith('jira:')).map((event) => event.field))], ['jira:timeestimate'])

    t.diagnostic('worklogs logged, paged and capped at 20 in a search; metric events read all 22; edit and delete add no jira: update')
  } finally {
    cleanup()
    left = await removeAll(jira, created, run, t)
  }
  assert.deepEqual(left, [], 'work items left in the throwaway space')
})

// Plans (PMK-381), read-only. Every Plans read needs Jira Premium or Enterprise; on another edition Jira answers 403 naming the
// Administer Jira permission even to an admin, so pmkit cannot tell the two causes apart and its one hint names both.
test('jira plans answer available false on a site without Premium', { skip: NEEDS_SPACE }, async (t) => {
  const jira = client()
  const { applications = [] } = await jira.request('GET', '/rest/api/3/instance/license')
  const edition = applications.find((app) => app.id === 'jira-software')?.plan
  // Only an edition known to lack Plans can show the off path: on any other a 403 could be a missing permission on Premium.
  if (!['FREE', 'STANDARD'].includes(edition)) return t.skip(`the site's Jira edition is ${edition ?? 'unknown'}: the Premium checks are the EPC-14 follow-up PMK-399`)
  const refusal = await failure(jira.request('GET', '/rest/api/3/plans/plan'))
  assert.deepEqual([refusal.code, refusal.details?.jira?.status], ['AUTH', 403])

  const { cli, refused, cleanup } = liveRepo()
  try {
    const proposal = cli(...INIT(), '--space', SPACE, '--dry-run')
    cli(...INIT(), '--space', SPACE, ...acceptAll(proposal))
    const off = (answer) => [answer.available, answer.reason, answer.enableHint, answer.site === SITE.toLowerCase()]
    for (const flags of [[], ['--archived', '--trashed', '--limit', '1']]) {
      const list = cli('jira', 'plans', 'list', ...flags)
      assert.deepEqual([...off(list), list.plans, list.hasMore], [false, 'premium', PLANS_HINT, true, [], false])
    }
    assert.deepEqual(off(cli('jira', 'plans', 'get', '1')), [false, 'premium', PLANS_HINT, true])
    assert.equal(refused('jira', 'plans', 'get', 'abc').code, 'INVALID_INPUT')
    t.diagnostic(`license ${edition}; the Plans list answers 403; jira plans list and get answer available false`)
  } finally {
    cleanup()
  }
})

// Jira Product Discovery (PMK-384), read-only. The owner's site has no Jira Product Discovery installed: no project, no Polaris
// link type and no jira.polaris field, so only the off path can be checked.
test('jira ideas answer available false on a site without Jira Product Discovery', { skip: NEEDS_SPACE }, async (t) => {
  const { items: projects } = await client().paginate('/rest/api/3/project/search', { key: 'values' })
  if (projects.some((project) => project.projectTypeKey === 'product_discovery')) {
    return t.skip('the site has a Jira Product Discovery project: the votes field and delivery link checks are not written yet (PMK-384)')
  }
  const { cli, refused, cleanup } = liveRepo()
  try {
    const proposal = cli(...INIT(), '--space', SPACE, '--dry-run')
    cli(...INIT(), '--space', SPACE, ...acceptAll(proposal))
    const hint = IDEAS_HINT(SITE.toLowerCase())
    for (const flags of [[], ['--limit', '1']]) {
      const list = cli('jira', 'ideas', 'list', ...flags)
      assert.deepEqual([list.available, list.reason, list.enableHint, list.site === SITE.toLowerCase(), list.ideas, list.hasMore], [false, 'no_discovery_project', hint, true, [], false])
    }
    const named = refused('jira', 'ideas', 'list', '--project', SPACE)
    assert.deepEqual([named.code, named.nextStep], ['NOT_FOUND', hint])
    assert.equal(refused('jira', 'ideas', 'connect', `${SPACE}-1`, `${SPACE}-2`, '--dry-run').code, 'NOT_FOUND')
    t.diagnostic(`${projects.length} projects, none Product Discovery; jira ideas list answers available false; --project and connect answer NOT_FOUND`)
  } finally {
    cleanup()
  }
})
