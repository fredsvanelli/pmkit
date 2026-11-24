// Opt-in live check of the Jira client against a Jira Cloud site (PMK-364): anonymous serverInfo, the session check with a
// classic and a scoped token, the AUTH and NOT_CONFIGURED answers, the rate-limit headers and a write round trip.
// Then discovery and the manifest (PMK-366), read-only: the space's style, work type levels, status categories, the field of
// each role, the license, configuration and board shapes, on the throwaway space and, when set, on a company-managed space
// (PMKIT_LIVE_JIRA_COMPANY_SPACE) and with a token without admin rights (PMKIT_LIVE_JIRA_LIMITED_EMAIL and _TOKEN).
// Then setup (PMK-368): the real CLI runs init --tracker jira in a temporary repository; Jira is only read.
// Then the issue flows (PMK-367): the real CLI creates, links, parents, branches, assigns and moves work items in the throwaway
// space, each answer checked against Jira's raw item, and deletes them.
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
import { createJiraClient } from './client.mjs'
import { jiraCredential } from './credential.mjs'
import { categoryOfStatus, discoveryView, fetchDiscovery } from './discovery.mjs'
import { buildJiraCapabilities } from './manifest.mjs'
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
  const cli = (...args) => {
    const result = spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: repo, env: { ...env, PMKIT_HOME: path.join(root, 'home') }, encoding: 'utf8' })
    assertNoSecret(`${result.stdout}${result.stderr}`)
    assert.equal(result.status, 0, hostless(`the CLI's ${args.slice(0, 2).join(' ')} exited ${result.status}: ${result.stdout.slice(0, 400)}`))
    const parsed = JSON.parse(result.stdout)
    return parsed.data ?? parsed
  }
  return { root, repo, cli, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
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

// Issue flows (PMK-367). The CLI writes to the throwaway space only; every work item it makes is deleted in the finally.
/** The value fn returns once it stops throwing, retried for up to 10 s: Jira's search index trails a write. */
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
    // Printed at once, so a delete that fails leaves the key of the work item to remove by hand.
    t.diagnostic(`created ${key}`)
    return key
  }
  const { root, repo, cli, cleanup } = liveRepo()
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
    const a = made(cli('issues', 'create', '--title', `pmkit live ${run} ${word}`, '--type', 'feature', '--criteria-file', criteria).after.id)
    const b = made(cli('issues', 'create', '--title', `pmkit live ${run} blocked`, '--type', 'bug').after.id)
    const c = made(cli('issues', 'create', '--title', `pmkit live ${run} copy`, '--type', 'task').after.id)
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
    const epic = made(cli('epic', 'create', '--title', `pmkit live ${run} epic`).after.id)
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
    // Anything a failed step left behind, found by the run's word, as well as what the test recorded.
    const { items: strays } = await jira.paginate('/rest/api/3/search/jql', { query: { jql: `project = ${SPACE} AND summary ~ "${run}"`, fields: 'summary' }, key: 'issues' })
    const keys = [...new Set([...created, ...strays.map((item) => item.key)])].reverse()
    for (const key of keys) await jira.request('DELETE', `/rest/api/3/issue/${encodeURIComponent(key)}`, { query: { deleteSubtasks: 'true' } })
    for (const key of keys) assert.equal((await failure(raw(key, 'summary'))).code, 'NOT_FOUND')
    t.diagnostic(`deleted ${keys.length} work items`)
  }
})
