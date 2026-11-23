import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, fakeJiraFetch, jiraSiteRoutes } from '../../fake-jira-api.mjs'
import { createJiraClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { SPACE_PATH, proposeJiraSetup, proposeSpace } from './setup.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const TYPES = ['feature', 'bug', 'task', 'chore']
const CRITERIA = { id: 'customfield_10050', name: 'Acceptance criteria', custom: true, schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } }

async function rawOf({ extraStatuses = false, extraFields = [] } = {}) {
  const routes = jiraSiteRoutes({ extraStatuses })
  routes['GET /rest/api/3/field'] = { json: [...routes['GET /rest/api/3/field'].json, ...extraFields] }
  const fetch = fakeJiraFetch(routes)
  const client = createJiraClient({ env: FAKE_ENV, tracker: { scope: { site: 'acme.atlassian.net', space: 'ENG' } }, fetch, sleep: async () => {} })
  return fetchDiscovery(client, { space: 'ENG' })
}

const questionAt = (result, path) => result.questions.find((question) => question.path === path)
const statusQuestions = (result) => result.questions.filter((question) => question.path.startsWith('mappings.status.'))
const refused = (fn, check = {}) => assert.throws(fn, (error) => error.code === 'INVALID_INPUT' && Object.entries(check).every(([key, test]) => test(error[key])))

test('first run asks backlog, in_review and canceled, never blocked', async () => {
  const extra = proposeJiraSetup(await rawOf({ extraStatuses: true }), {}, {}, TYPES)
  assert.deepEqual(statusQuestions(extra).map((question) => question.path), ['mappings.status.backlog', 'mappings.status.in_review', 'mappings.status.canceled'])
  assert.deepEqual(statusQuestions(extra).map((question) => question.recommended), ['Backlog', 'Review', 'Canceled'])
  for (const question of statusQuestions(extra)) {
    assert.equal(question.candidates[0], question.recommended)
    assert.equal(question.candidates.length, 7)
  }
  const plain = proposeJiraSetup(await rawOf(), {}, {}, TYPES)
  assert.deepEqual(statusQuestions(plain).map((question) => question.recommended), ['none', 'Review', 'none'])
  assert.deepEqual(questionAt(plain, 'mappings.status.backlog').candidates, ['To Do', 'In Progress', 'Review', 'Done'])
  assert.deepEqual(questionAt(plain, 'mappings.status.in_review').candidates, ['Review', 'To Do', 'In Progress', 'Done'])
  assert.equal(questionAt(plain, 'mappings.status.in_review').flag, '--status in_review=<value>')
  assert.equal(questionAt(plain, 'mappings.status.in_review').none, 'No status means in review')
  assert.deepEqual(plain.values.status, {})
})

test('--status blocked is refused', async () => {
  const raw = await rawOf()
  refused(() => proposeJiraSetup(raw, {}, { status: { blocked: 'Review' } }, TYPES), { message: (m) => m === '--status blocked is not something setup maps' })
})

test('a held blocked is kept', async () => {
  const result = proposeJiraSetup(await rawOf(), { status: { blocked: 'Review' } }, {}, TYPES)
  assert.equal(questionAt(result, 'mappings.status.blocked'), undefined)
  assert.equal(result.values.status.blocked, undefined)
  assert.deepEqual(result.broken, [])
})

test('one status cannot answer two keys', async () => {
  const raw = await rawOf()
  refused(() => proposeJiraSetup(raw, {}, { status: { in_review: 'Review', canceled: 'Review' } }, TYPES))
})

test('an unknown status answer lists the candidates', async () => {
  const raw = await rawOf()
  refused(() => proposeJiraSetup(raw, {}, { status: { in_review: 'Nope' } }, TYPES), {
    nextStep: (step) => step.startsWith('Pass one of: To Do, In Progress, Review, Done') && step.endsWith('none'),
  })
})

test('estimate on a company-managed space', async () => {
  const question = questionAt(proposeJiraSetup(await rawOf(), {}, {}, TYPES), 'mappings.fields.estimate')
  assert.equal(question.recommended, 'customfield_10016')
  assert.deepEqual(question.candidates, ['customfield_10016', 'timeoriginalestimate'])
  assert.equal(question.titles.customfield_10016, 'Story Points')
  assert.equal(question.flag, '--field estimate=<value>')
  assert.equal(question.none, 'No field holds the estimate')
})

test('acceptance criteria with no candidate is a note', async () => {
  const bare = proposeJiraSetup(await rawOf(), {}, {}, TYPES)
  assert.equal(questionAt(bare, 'mappings.fields.acceptance_criteria'), undefined)
  assert.ok(bare.notes.includes('the site has no field for the acceptance criteria'))
  assert.equal(bare.values.fields.acceptance_criteria, undefined)
  const one = proposeJiraSetup(await rawOf({ extraFields: [CRITERIA] }), {}, {}, TYPES)
  assert.equal(questionAt(one, 'mappings.fields.acceptance_criteria'), undefined)
  assert.deepEqual(one.applied, [{ path: 'mappings.fields.acceptance_criteria', value: 'customfield_10050', reason: 'the site offers only this field' }])
  assert.equal(one.values.fields.acceptance_criteria, 'customfield_10050')
})

test('no other field role is asked', async () => {
  const raw = await rawOf()
  const result = proposeJiraSetup(raw, {}, {}, TYPES)
  for (const role of ['priority', 'assignee', 'target_date', 'start_date', 'time_spent', 'sprint']) {
    assert.equal(questionAt(result, `mappings.fields.${role}`), undefined)
  }
  refused(() => proposeJiraSetup(raw, {}, { fields: { priority: 'priority' } }, TYPES))
})

test('types offer the standard work types', async () => {
  const result = proposeJiraSetup(await rawOf(), {}, {}, TYPES)
  const recommended = { feature: 'Story', bug: 'Bug', task: 'none', chore: 'none' }
  for (const type of TYPES) {
    const question = questionAt(result, `mappings.types.${type}`)
    assert.deepEqual([...question.candidates].sort(), ['Bug', 'Story'])
    assert.equal(question.recommended, recommended[type])
    assert.equal(question.none, 'No work type stands for this type')
  }
  assert.deepEqual(questionAt(result, 'mappings.types.bug').candidates, ['Bug', 'Story'])
  assert.equal(result.values.types, undefined)
})

test('two types cannot share a work type', async () => {
  const raw = await rawOf()
  refused(() => proposeJiraSetup(raw, {}, { types: { feature: 'Story', task: 'Story', bug: 'Bug', chore: 'none' } }, TYPES))
})

test('all answered', async () => {
  const answers = {
    status: { backlog: 'none', in_review: 'Review', canceled: 'none' },
    fields: { estimate: 'customfield_10016' },
    types: { feature: 'Story', bug: 'Bug', task: 'none', chore: 'none' },
  }
  const result = proposeJiraSetup(await rawOf(), {}, answers, TYPES)
  assert.deepEqual(result.questions, [])
  assert.deepEqual(result.values, { status: { backlog: 'none', in_review: 'Review', canceled: 'none' }, fields: { estimate: 'customfield_10016' }, types: { feature: 'Story', bug: 'Bug' } })
})

test('a held mapping that broke is asked again', async () => {
  const result = proposeJiraSetup(await rawOf(), { status: { in_review: 'Gone' } }, {}, TYPES)
  assert.equal(questionAt(result, 'mappings.status.in_review').broken.was, 'Gone')
  assert.equal(result.broken.length, 1)
  assert.equal(result.broken[0].path, 'mappings.status.in_review')
})

test('held types are kept and a held type that broke is asked again', async () => {
  const raw = await rawOf()
  const kept = proposeJiraSetup(raw, { types: { feature: 'Story' } }, {}, TYPES)
  assert.equal(questionAt(kept, 'mappings.types.feature'), undefined)
  assert.deepEqual(kept.values.types, { feature: 'Story' })
  const broke = proposeJiraSetup(raw, { types: { feature: 'Gone' } }, {}, TYPES)
  assert.deepEqual(broke.questions.filter((question) => question.path.startsWith('mappings.types.')).map((question) => question.path), ['mappings.types.feature'])
  assert.equal(questionAt(broke, 'mappings.types.feature').broken.was, 'Gone')
})

test('proposeSpace', () => {
  const spaces = [{ key: 'ENG', name: 'Engineering' }, { key: 'OPS', name: 'Operations' }]
  const { question, broken } = proposeSpace({ spaces })
  assert.deepEqual(question, { path: SPACE_PATH, flag: '--space <KEY>', candidates: ['ENG', 'OPS'], titles: { ENG: 'Engineering', OPS: 'Operations' }, recommended: null, none: null })
  assert.deepEqual(broken, [])
  assert.equal(proposeSpace({ spaces: spaces.slice(0, 1) }).question.recommended, 'ENG')
  assert.deepEqual(proposeSpace({ answer: 'OPS', spaces }), { value: 'OPS' })
  assert.deepEqual(proposeSpace({ held: 'ENG', spaces }), { value: 'ENG' })
  const missing = proposeSpace({ held: 'OLD', heldMissing: true, spaces, site: 'acme.atlassian.net' })
  const problem = "tracker.scope.space names OLD, which acme.atlassian.net does not have or the token's owner cannot browse"
  assert.deepEqual(missing.question.broken, { was: 'OLD', problem })
  assert.deepEqual(missing.broken, [{ path: SPACE_PATH, value: 'OLD', problem }])
  refused(() => proposeSpace({ answer: 'NOPE', spaces }), { message: (m) => m === '--space NOPE is not a space of this site', nextStep: (s) => s === 'Pass one of: ENG, OPS' })
})
