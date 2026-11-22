import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch, jiraSiteRoutes } from '../../fake-jira-api.mjs'
import { textToAdf } from './adf.mjs'
import { createJiraClient } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { makeContext } from './issues.mjs'
import { fieldValues, pickTarget, pickTransition, requiredFields } from './transitions.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

async function context(status = {}) {
  const fetch = fakeJiraFetch({ ...jiraSiteRoutes() })
  const client = createJiraClient({ env: FAKE_ENV, tracker: TRACKER, fetch, sleep: async () => {} })
  const raw = await fetchDiscovery(client, { space: 'ENG', now: () => new Date('2026-11-22T12:00:00Z') })
  return makeContext(raw, { tracker: TRACKER, mappings: { types: { story: 'Story', bug: 'Bug' }, status } }, await client.session())
}

const item = (type = { id: '10001', name: 'Story' }) => ({ key: 'ENG-1', fields: { status: { id: '1', name: 'To Do' }, issuetype: type } })
const BUG = { id: '10002', name: 'Bug' }

test('pickTarget takes the first status of the work type in the category', async () => {
  const target = pickTarget({ item: item(), category: 'in_progress', context: await context() })
  assert.deepEqual(target, { id: '3', name: 'In Progress' })
})

test('pickTarget lets a mapped status win over the category order', async () => {
  const target = pickTarget({ item: item(), category: 'in_progress', context: await context({ in_progress: 'Review' }) })
  assert.deepEqual(target, { id: '4', name: 'Review' })
})

test('pickTarget ignores a mapped status the work type does not have', async () => {
  const target = pickTarget({ item: item(BUG), category: 'in_progress', context: await context({ in_progress: 'Review' }) })
  assert.deepEqual(target, { id: '3', name: 'In Progress' })
})

test('pickTarget takes a named status of the category, by name or id', async () => {
  const c = await context({ in_progress: 'Review' })
  assert.deepEqual(pickTarget({ item: item(), category: 'in_progress', status: 'in progress', context: c }), { id: '3', name: 'In Progress' })
  assert.deepEqual(pickTarget({ item: item(), category: 'in_progress', status: '4', context: c }), { id: '4', name: 'Review' })
})

test('pickTarget rejects a status outside the category and lists the ones inside', async () => {
  const c = await context({ in_progress: 'Review' })
  assert.throws(
    () => pickTarget({ item: item(), category: 'in_progress', status: 'Done', context: c }),
    (error) => error.code === 'INVALID_INPUT' && /In Progress/.test(error.message) && /Review/.test(error.message),
  )
})

test('pickTarget points to setup when the category has no status', async () => {
  const c = await context()
  assert.throws(
    () => pickTarget({ item: item(), category: 'in_review', context: c }),
    (error) => error.code === 'NOT_SUPPORTED' && error.nextStep === '/pmkit:setup' && /work type Story in space ENG has no status in the in_review category/.test(error.message),
  )
})

const transition = (id, to, fields = {}) => ({ id, name: `to ${to.name}`, to, fields })
const TRANSITIONS = [transition('11', { id: '5', name: 'Done' }), transition('21', { id: '3', name: 'In Progress' })]

test('pickTransition finds the transition to the target', () => {
  assert.equal(pickTransition(TRANSITIONS, { id: '3', name: 'In Progress' }, item()).id, '21')
})

test('pickTransition names the reachable statuses when there is none', () => {
  assert.throws(
    () => pickTransition(TRANSITIONS, { id: '4', name: 'Review' }, item()),
    (error) => error.code === 'INVALID_INPUT'
      && error.message === "Jira's workflow has no transition from To Do to Review for ENG-1"
      && error.nextStep === 'Move it to one of: Done, In Progress',
  )
})

const resolution = { required: true, hasDefaultValue: false, name: 'Resolution', schema: { type: 'resolution' }, allowedValues: [{ id: '10000', name: 'Done' }, { id: '10001', name: "Won't Do" }] }
const withFields = (fields) => transition('11', { id: '5', name: 'Done' }, fields)
const CTX = { key: 'ENG-1', category: 'done', target: 'Done' }

test('requiredFields lists required fields without a default, with allowed names', () => {
  const t = withFields({ resolution, note: { required: true, hasDefaultValue: true, name: 'Note', schema: { type: 'string' } }, labels: { required: false, hasDefaultValue: false, name: 'Labels', schema: { type: 'array' } } })
  assert.deepEqual(requiredFields(t), [{ id: 'resolution', name: 'Resolution', type: 'resolution', allowed: ['Done', "Won't Do"] }])
  assert.deepEqual(requiredFields(withFields({})), [])
  assert.deepEqual(requiredFields({ id: '1' }), [])
})

test('fieldValues sends an allowed value as its id, by name, value or id', () => {
  const t = withFields({ resolution })
  assert.deepEqual(fieldValues(requiredFields(t), t, { resolution: 'done' }, CTX), { resolution: { id: '10000' } })
  assert.deepEqual(fieldValues(requiredFields(t), t, { resolution: '10001' }, CTX), { resolution: { id: '10001' } })
  const opt = withFields({ pick: { required: true, name: 'Pick', schema: { type: 'option' }, allowedValues: [{ id: '7', value: 'Seven' }] } })
  assert.deepEqual(fieldValues(requiredFields(opt), opt, { pick: 'Seven' }, CTX), { pick: { id: '7' } })
})

test('fieldValues sends an array field as a list of ids', () => {
  const t = withFields({ fix: { required: true, name: 'Fix', schema: { type: 'array', items: 'version' }, allowedValues: [{ id: '9', name: 'v1' }] } })
  assert.deepEqual(fieldValues(requiredFields(t), t, { fix: 'v1' }, CTX), { fix: [{ id: '9' }] })
})

test('fieldValues rejects a value the field does not allow', () => {
  const t = withFields({ resolution })
  assert.throws(() => fieldValues(requiredFields(t), t, { resolution: 'Maybe' }, CTX), (e) => e.code === 'INVALID_INPUT' && /Done, Won't Do/.test(e.message))
})

test('fieldValues converts numbers, dates and text', () => {
  const t = withFields({
    n: { required: true, name: 'N', schema: { type: 'number' } },
    d: { required: true, name: 'D', schema: { type: 'date' } },
    s: { required: true, name: 'S', schema: { type: 'string' } },
    a: { required: true, name: 'A', schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } },
  })
  const given = { n: '2.5', d: '2026-11-22', s: 'hi', a: 'long' }
  assert.deepEqual(fieldValues(requiredFields(t), t, given, CTX), { n: 2.5, d: '2026-11-22', s: 'hi', a: textToAdf('long') })
  assert.throws(() => fieldValues(requiredFields(t), t, { ...given, n: 'x' }, CTX), (e) => e.code === 'INVALID_INPUT')
  assert.throws(() => fieldValues(requiredFields(t), t, { ...given, d: '22/11/2026' }, CTX), (e) => e.code === 'INVALID_INPUT')
})

test('fieldValues converts a value for an optional field of the transition', () => {
  const t = withFields({ resolution, labels: { required: false, name: 'Note', schema: { type: 'string' } } })
  assert.deepEqual(fieldValues(requiredFields(t), t, { resolution: 'Done', labels: 'x' }, CTX), { resolution: { id: '10000' }, labels: 'x' })
})

test('fieldValues refuses a field type pmkit cannot fill', () => {
  const t = withFields({ who: { required: true, name: 'Reviewer', schema: { type: 'user' } } })
  assert.throws(
    () => fieldValues(requiredFields(t), t, { who: 'me' }, CTX),
    (e) => e.code === 'NOT_SUPPORTED' && e.message === 'pmkit cannot fill Reviewer (user); move ENG-1 in Jira',
  )
})

test('fieldValues rejects a value for a field the transition does not have', () => {
  const t = withFields({ resolution })
  assert.throws(() => fieldValues(requiredFields(t), t, { resolution: 'Done', nope: 'x' }, CTX), (e) => e.code === 'INVALID_INPUT' && /nope/.test(e.message))
})

test('fieldValues asks for every missing required field', () => {
  const t = withFields({ resolution, fix: { required: true, name: 'Fix', schema: { type: 'string' } } })
  assert.throws(
    () => fieldValues(requiredFields(t), t, { fix: 'x' }, CTX),
    (e) => e.code === 'INVALID_INPUT'
      && e.message === 'the transition to Done needs Resolution'
      && e.nextStep === 'pmkit issues move ENG-1 done --field resolution=<value>'
      && e.details.requiredFields[0].id === 'resolution',
  )
})
