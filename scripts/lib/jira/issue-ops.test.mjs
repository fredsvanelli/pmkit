// Tests of the Jira Issues family (getIssue, searchIssues, createIssue, updateIssue, moveToCategory, assign, delete) over
// the stateful fake Jira, through the tracker that gives them their context.
import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch } from '../../fake-jira-api.mjs'
import { fakeJiraIssues } from '../../fake-jira-issues.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { createJiraTracker } from './tracker.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const NOW = () => new Date('2026-11-22T12:00:00Z')
const TYPES = { story: 'Story', bug: 'Bug', epic: 'Epic', subtask: 'Sub-task' }
const STATUS = {
  todo: { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
  doing: { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
  done: { id: '5', name: 'Done', statusCategory: { key: 'done' } },
}
const WORK_TYPE = { story: { id: '10001', name: 'Story' }, epic: { id: '10000', name: 'Epic' } }

/** A tracker over a fresh fake, its own user store and repository root. */
function setup({ requireResolution, pmkit = {}, routes = {}, context, sprints, versions } = {}) {
  const fake = fakeJiraIssues({ requireResolution, sprints, versions })
  const fetch = fakeJiraFetch({ ...fake.routes, ...routes })
  const at = context ?? { root: tempDir(), env: { ...FAKE_ENV, ...userStoreEnv().env } }
  const config = { root: at.root, pmkit: { version: 1, tracker: TRACKER, mappings: { types: TYPES }, ...pmkit } }
  const tracker = createJiraTracker(config, { env: at.env, now: NOW, fetch })
  return { fake, fetch, tracker, context: at }
}

/** Puts `count` Story items into the fake's state directly, one second apart, with `fields` over the defaults. */
function seed(state, count = 1, fields = {}) {
  const keys = []
  for (let index = 0; index < count; index += 1) {
    const number = state.next.item++
    const time = new Date(Date.parse('2026-11-01T00:00:00Z') + number * 1000).toISOString().replace('Z', '+0000')
    const key = `ENG-${number}`
    state.items[key] = {
      id: String(10000 + number), key,
      fields: {
        summary: `Item ${number}`, description: null, status: STATUS.todo, issuetype: WORK_TYPE.story, priority: null, assignee: null,
        labels: [], parent: null, duedate: null, resolution: null, creator: { accountId: 'acc-1' }, created: time, updated: time,
        ...(typeof fields === 'function' ? fields(number) : fields),
      },
    }
    keys.push(key)
  }
  return keys
}

const callsTo = (fetch, method, path) => fetch.calls.filter((call) => call.method === method && new URL(call.url).pathname === path)
const blocks = (state, a, b) => state.links.push({ id: String(state.next.link++), typeId: '10000', inward: a, outward: b })
const ME = 'acc-1'

test('getIssue reads a work item; a malformed or unknown key is NOT_FOUND', async () => {
  const { fake, fetch, tracker } = setup()
  seed(fake.state, 1, { summary: 'First', labels: ['b', 'a'] })
  const issue = await tracker.getIssue('eng-1')
  assert.equal(issue.id, 'ENG-1')
  assert.equal(issue.title, 'First')
  assert.deepEqual(issue.status, { name: 'To Do', category: 'todo' })
  assert.equal(issue.type, 'story')
  assert.deepEqual(issue.labels, ['a', 'b'])
  const issueCalls = fetch.calls.length
  await assert.rejects(tracker.getIssue('not a key'), { code: 'NOT_FOUND', message: 'issue not a key does not exist' })
  assert.equal(fetch.calls.length, issueCalls, 'a malformed key sends no request')
  await assert.rejects(tracker.getIssue('ENG-99'), { code: 'NOT_FOUND', message: 'issue ENG-99 does not exist' })
})

test('createIssue posts the fields; a dry run sends nothing', async () => {
  const { fake, tracker } = setup()
  const dry = await tracker.createIssue({ title: 'First', labels: ['x'], priority: 'high' }, ME, { dryRun: true })
  assert.equal(dry.before, null)
  assert.equal(dry.after.title, 'First')
  assert.deepEqual(fake.writes(), [])
  const made = await tracker.createIssue({ title: 'First', labels: ['x'], priority: 'high', assignee: 'me' }, ME)
  assert.equal(made.after.id, 'ENG-1')
  assert.equal(made.after.priority, 'high')
  assert.equal(made.after.assignee, ME)
  assert.deepEqual(fake.writes().map((write) => `${write.method} ${write.path}`), ['POST /rest/api/3/issue'])
})

test('createIssue with a status moves the new item with a transition', async () => {
  const { fake, tracker } = setup()
  const made = await tracker.createIssue({ title: 'First', status: 'in_progress' }, ME)
  assert.deepEqual(made.after.status, { name: 'In Progress', category: 'in_progress' })
  assert.deepEqual(fake.writes().map((write) => `${write.method} ${write.path}`), ['POST /rest/api/3/issue', 'POST /rest/api/3/issue/ENG-1/transitions'])
  const dry = await tracker.createIssue({ title: 'Second', status: 'in_progress' }, ME, { dryRun: true })
  assert.deepEqual(dry.after.status, { name: 'In Progress', category: 'in_progress' })
  assert.equal(fake.writes().length, 2)
})

test('a create whose move fails is UPSTREAM naming the created key', async () => {
  const { fake, tracker } = setup()
  await assert.rejects(tracker.createIssue({ title: 'First', status: 'done' }, ME), (error) => {
    assert.equal(error.code, 'UPSTREAM')
    assert.match(error.message, /^Jira created ENG-1, but the move to done failed: the transition to Done needs Resolution$/)
    assert.equal(error.nextStep, 'pmkit issues move ENG-1 done --field resolution=<value>')
    assert.equal(error.details.created, 'ENG-1')
    assert.deepEqual(error.details.requiredFields, [{ id: 'resolution', name: 'Resolution', type: 'resolution', allowed: ['Done', "Won't Do"] }])
    return true
  })
  assert.ok(fake.state.items['ENG-1'])
})

test('a write as another member is refused before any write', async () => {
  const { fake, tracker } = setup()
  await assert.rejects(tracker.createIssue({ title: 'First' }, 'acc-2'), {
    code: 'INVALID_INPUT',
    message: 'Jira records every write as the owner of JIRA_API_TOKEN (Test User)',
    nextStep: 'Drop --as, or use a token created by that member',
  })
  seed(fake.state)
  await assert.rejects(tracker.updateIssue('ENG-1', { title: 'x' }, 'acc-2'), { code: 'INVALID_INPUT' })
  await assert.rejects(tracker.moveToCategory('ENG-1', 'done', 'acc-2'), { code: 'INVALID_INPUT' })
  await assert.rejects(tracker.assign('ENG-1', 'me', 'acc-2'), { code: 'INVALID_INPUT' })
  await assert.rejects(tracker.delete('ENG-1', 'acc-2'), { code: 'INVALID_INPUT' })
  assert.deepEqual(fake.writes(), [])
})

test('updateIssue sends only the changed fields, and nothing when nothing changes', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 1, { summary: 'First' })
  const same = await tracker.updateIssue('ENG-1', { title: 'First' }, ME)
  assert.deepEqual(same.after, same.before)
  const dry = await tracker.updateIssue('ENG-1', { title: 'Renamed' }, ME, { dryRun: true })
  assert.equal(dry.after.title, 'Renamed')
  assert.deepEqual(fake.writes(), [])
  const done = await tracker.updateIssue('ENG-1', { title: 'Renamed' }, ME)
  assert.equal(done.after.title, 'Renamed')
  assert.deepEqual(fake.writes(), [{ method: 'PUT', path: '/rest/api/3/issue/ENG-1', body: { fields: { summary: 'Renamed' } } }])
})

test('updateIssue refuses an assignee, which issues assign owns, with no stale hint and no refresh', async () => {
  const { fake, fetch, tracker } = setup()
  seed(fake.state)
  await assert.rejects(tracker.updateIssue('ENG-1', { assignee: 'stranger' }, ME), (error) => {
    assert.equal(error.code, 'INVALID_INPUT')
    assert.equal(error.message, 'assignee cannot be set here')
    assert.equal(error.nextStep, 'pmkit issues assign')
    assert.equal(error.details?.stale, undefined)
    return true
  })
  assert.equal(callsTo(fetch, 'GET', '/rest/api/3/project/ENG').length, 1)
  assert.deepEqual(fake.writes(), [])
})

test('updateIssue writes the pmkit.branch property once, and the same name sends nothing', async () => {
  const { fake, tracker } = setup()
  seed(fake.state)
  const set = await tracker.updateIssue('ENG-1', { branch: 'pmk-1-first' }, ME)
  assert.equal(set.after.branch, 'pmk-1-first')
  assert.deepEqual(fake.writes(), [{ method: 'PUT', path: '/rest/api/3/issue/ENG-1/properties/pmkit.branch', body: 'pmk-1-first' }])
  const again = await tracker.updateIssue('ENG-1', { branch: 'pmk-1-first' }, ME)
  assert.deepEqual(again.after, again.before)
  assert.equal(fake.writes().length, 1)
  const cleared = await tracker.updateIssue('ENG-1', { branch: null }, ME)
  assert.equal(cleared.after.branch, undefined)
  assert.deepEqual(fake.writes()[1], { method: 'DELETE', path: '/rest/api/3/issue/ENG-1/properties/pmkit.branch', body: undefined })
})

test('moveToCategory to done lists Resolution in a dry run and needs it in a real run', async () => {
  const { fake, tracker } = setup()
  seed(fake.state)
  const dry = await tracker.moveToCategory('ENG-1', 'done', ME, { dryRun: true })
  assert.deepEqual(dry.after.status, { name: 'Done', category: 'done' })
  assert.deepEqual(dry.requiredFields, [{ id: 'resolution', name: 'Resolution', type: 'resolution', allowed: ['Done', "Won't Do"] }])
  await assert.rejects(tracker.moveToCategory('ENG-1', 'done', ME), (error) => {
    assert.equal(error.code, 'INVALID_INPUT')
    assert.equal(error.message, 'the transition to Done needs Resolution')
    assert.equal(error.nextStep, 'pmkit issues move ENG-1 done --field resolution=<value>')
    assert.equal(error.details.requiredFields[0].id, 'resolution')
    return true
  })
  assert.deepEqual(fake.writes(), [])
  const moved = await tracker.moveToCategory('ENG-1', 'done', ME, { fields: { resolution: 'Done' } })
  assert.deepEqual(moved.after.status, { name: 'Done', category: 'done' })
  assert.deepEqual(fake.writes(), [{ method: 'POST', path: '/rest/api/3/issue/ENG-1/transitions', body: { transition: { id: 't5' }, fields: { resolution: { id: '10000' } } } }])
})

test('moveToCategory sends nothing when the item is at the target already', async () => {
  const { fake, tracker } = setup()
  seed(fake.state)
  const result = await tracker.moveToCategory('ENG-1', 'todo', ME)
  assert.deepEqual(result.after, result.before)
  const dryAtTarget = await tracker.moveToCategory('ENG-1', 'todo', ME, { dryRun: true })
  assert.deepEqual(dryAtTarget.after, dryAtTarget.before)
  assert.deepEqual(dryAtTarget.requiredFields, [])
  const dry = await tracker.moveToCategory('ENG-1', 'in_progress', ME, { dryRun: true })
  assert.deepEqual(dry.requiredFields, [])
  assert.deepEqual(fake.writes(), [])
  await assert.rejects(tracker.moveToCategory('ENG-1', 'nowhere', ME), { code: 'INVALID_INPUT' })
})

test('a move with no transition to the target sends nothing and names the reachable statuses', async () => {
  const transitions = { 'GET /rest/api/3/issue/{key}/transitions': { json: { transitions: [{ id: 't3', name: 'Start', to: STATUS.doing, fields: {} }] } } }
  const { fake, tracker } = setup({ routes: transitions })
  seed(fake.state)
  await assert.rejects(tracker.moveToCategory('ENG-1', 'done', ME), {
    code: 'INVALID_INPUT', message: "Jira's workflow has no transition from To Do to Done for ENG-1", nextStep: 'Move it to one of: In Progress',
  })
  assert.deepEqual(fake.writes(), [])
})

test('assign sets the assignee, me and null included, and sends nothing when unchanged', async () => {
  const { fake, tracker } = setup()
  seed(fake.state)
  const dry = await tracker.assign('ENG-1', 'acc-2', ME, { dryRun: true })
  assert.equal(dry.after.assignee, 'acc-2')
  assert.deepEqual(fake.writes(), [])
  assert.equal((await tracker.assign('ENG-1', 'me', ME)).after.assignee, ME)
  const unchanged = await tracker.assign('ENG-1', ME, ME)
  assert.deepEqual(unchanged.after, unchanged.before)
  assert.equal((await tracker.assign('ENG-1', null, ME)).after.assignee, undefined)
  assert.deepEqual(fake.writes().map((write) => write.body), [{ accountId: ME }, { accountId: null }])
  await assert.rejects(tracker.assign('ENG-1', 'stranger', ME), { code: 'INVALID_INPUT' })
})

test('delete refuses while another item is blocked by it, and deletes otherwise', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 2)
  blocks(fake.state, 'ENG-1', 'ENG-2')
  await assert.rejects(tracker.delete('ENG-1', ME), (error) => {
    assert.equal(error.code, 'CONFLICT')
    assert.deepEqual(error.details.references, [{ id: 'ENG-2', kind: 'blockedBy' }])
    return true
  })
  const dry = await tracker.delete('ENG-2', ME, { dryRun: true })
  assert.equal(dry.after, null)
  assert.deepEqual(fake.writes(), [])
  await tracker.delete('ENG-2', ME)
  assert.deepEqual(fake.writes().map((write) => `${write.method} ${write.path}`), ['DELETE /rest/api/3/issue/ENG-2'])
  assert.equal(fake.state.items['ENG-2'], undefined)
})

test('delete refuses while the item has children', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 1, { issuetype: WORK_TYPE.epic })
  seed(fake.state, 1, { parent: { key: 'ENG-1' } })
  await assert.rejects(tracker.delete('ENG-1', ME), (error) => error.code === 'CONFLICT' && error.details.references[0].kind === 'parent')
  assert.deepEqual(fake.writes(), [])
})

test('searchIssues pages 100 at a time and reports hasMore when the page cap cuts the read', async () => {
  const { fake, fetch, tracker } = setup()
  seed(fake.state, 1001)
  const all = await tracker.searchIssues({})
  assert.equal(all.issues.length, 1000)
  assert.equal(all.hasMore, true)
  assert.deepEqual(all.problems, [])
  assert.equal(all.issues[0].id, 'ENG-1')
  const before = callsTo(fetch, 'GET', '/rest/api/3/search/jql').length
  const some = await tracker.searchIssues({ limit: 150 })
  assert.equal(some.issues.length, 150)
  assert.equal(some.hasMore, false)
  assert.equal(callsTo(fetch, 'GET', '/rest/api/3/search/jql').length - before, 2)
})

const AGILE = 'https://acme.atlassian.net/rest/agile/1.0'
const post = (fetch, path, body) => fetch(`${AGILE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const SPRINT = { id: 1, state: 'active', name: 'Sprint 1', startDate: '2026-11-09T12:00:00.000Z', endDate: '2026-11-20T12:00:00.000Z' }

test('searchIssues by sprint: current is the active sprint, none keeps the unfinished item of a closed sprint, current is empty without an active sprint, an unknown id is INVALID_INPUT', async () => {
  const { fake, fetch, tracker } = setup({ sprints: [SPRINT] })
  const [open, done, never] = [seed(fake.state)[0], seed(fake.state, 1, { status: STATUS.done })[0], seed(fake.state)[0]]
  await post(fetch, '/sprint/1/issue', { issues: [open, done] })
  assert.deepEqual((await tracker.searchIssues({ sprint: '1' })).issues.map((issue) => issue.id), [open, done])
  assert.deepEqual((await tracker.searchIssues({ sprint: 'current' })).issues.map((issue) => issue.id), [open, done])
  assert.equal((await tracker.getIssue(open)).sprint, '1')
  await post(fetch, '/sprint/1', { state: 'closed' })
  assert.deepEqual((await tracker.searchIssues({ sprint: 'none' })).issues.map((issue) => issue.id), [open, never])
  assert.equal((await tracker.getIssue(done)).sprint, '1')
  assert.deepEqual((await tracker.searchIssues({ sprint: 'current' })).issues, [])
  await assert.rejects(tracker.searchIssues({ sprint: '999' }), { code: 'INVALID_INPUT' })
})

test('searchIssues keeps a case-free substring of the title or the description', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 3, (number) => ({ summary: ['Apple pie', 'Banana', 'Cherry'][number - 1] }))
  const found = await tracker.searchIssues({ text: 'APPLE' })
  assert.deepEqual(found.issues.map((issue) => issue.id), ['ENG-1'])
})

test('searchIssues blocked keeps items with an open blocker, and false drops them', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 3)
  seed(fake.state, 1, { status: STATUS.done })
  blocks(fake.state, 'ENG-1', 'ENG-2')
  blocks(fake.state, 'ENG-4', 'ENG-3')
  assert.deepEqual((await tracker.searchIssues({ blocked: true })).issues.map((issue) => issue.id), ['ENG-2'])
  assert.deepEqual((await tracker.searchIssues({ blocked: false })).issues.map((issue) => issue.id), ['ENG-1', 'ENG-3', 'ENG-4'])
})

test('searchIssues sorts on the client and cuts to the limit', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 3, (number) => ({ priority: [null, { id: '1', name: 'Highest' }, { id: '4', name: 'Low' }][number - 1] }))
  const found = await tracker.searchIssues({ sort: 'priority', limit: 2 })
  assert.deepEqual(found.issues.map((issue) => issue.id), ['ENG-2', 'ENG-3'])
  await assert.rejects(tracker.searchIssues({ updatedAfter: 'yesterday' }), { code: 'INVALID_INPUT' })
  await assert.rejects(tracker.searchIssues({ types: ['nope'] }), { code: 'INVALID_INPUT' })
  assert.deepEqual(await tracker.searchIssues({ limit: 0 }), { issues: [], problems: [], hasMore: false })
})

test('searchIssues compares updatedAfter to the instant', async () => {
  const { fake, tracker } = setup()
  seed(fake.state, 3)
  const found = await tracker.searchIssues({ updatedAfter: '2026-11-01T00:00:02Z' })
  assert.deepEqual(found.issues.map((issue) => issue.id), ['ENG-3'])
})

test("an epic's children come from one parent in (...) search; searchIssues no longer returns epics (ADR 0017)", async () => {
  const { fake, fetch, tracker } = setup()
  seed(fake.state, 2, { issuetype: WORK_TYPE.epic })
  seed(fake.state, 1, { parent: { key: 'ENG-1' } })
  seed(fake.state, 1, { parent: { key: 'ENG-2' } })
  const found = await tracker.searchIssues({})
  assert.deepEqual(found.issues.map((issue) => issue.id), ['ENG-3', 'ENG-4'])
  assert.deepEqual(found.issues.map((issue) => issue.children), [[], []])
  const before = callsTo(fetch, 'GET', '/rest/api/3/search/jql').length
  assert.deepEqual((await tracker.getIssue('ENG-1')).children, ['ENG-3'])
  const searches = callsTo(fetch, 'GET', '/rest/api/3/search/jql').slice(before)
  assert.equal(searches.length, 1)
  assert.equal(new URL(searches[0].url).searchParams.get('jql'), 'parent in ("ENG-1")')
})

test('a status the fresh discovery lacks reads with its Jira category, with no second discovery', async () => {
  const { fake, fetch, tracker } = setup()
  seed(fake.state, 1, { status: { id: '9', name: 'Shipped', statusCategory: { key: 'done' } } })
  assert.deepEqual((await tracker.getIssue('ENG-1')).status, { name: 'Shipped', category: 'done' })
  assert.equal(callsTo(fetch, 'GET', '/rest/api/3/project/ENG/statuses').length, 1)
})

test('a status a cached discovery lacks refreshes the discovery once', async () => {
  const first = setup()
  await first.tracker.discover({ refresh: true })
  const shipped = { id: '9', name: 'Shipped', statusCategory: { key: 'indeterminate' } }
  const statuses = { json: [{ id: '10001', name: 'Story', subtask: false, statuses: [STATUS.todo, shipped, STATUS.done] }] }
  const second = setup({ context: first.context, routes: { 'GET /rest/api/3/project/ENG/statuses': statuses } })
  seed(second.fake.state, 1, { status: { ...shipped, statusCategory: { key: 'done' } } })
  assert.deepEqual((await second.tracker.getIssue('ENG-1')).status, { name: 'Shipped', category: 'in_progress' })
  assert.equal(callsTo(second.fetch, 'GET', '/rest/api/3/project/ENG/statuses').length, 1)
})

test('reading a work item of another space does not refresh a cached discovery', async () => {
  const first = setup()
  await first.tracker.discover({ refresh: true })
  const second = setup({ context: first.context })
  const [key] = seed(second.fake.state, 1, { status: { id: '9', name: 'Elsewhere', statusCategory: { key: 'done' } } })
  const item = second.fake.state.items[key]
  delete second.fake.state.items[key]
  item.key = 'OPS-1'
  second.fake.state.items['OPS-1'] = item
  assert.equal((await second.tracker.getIssue('OPS-1')).status.name, 'Elsewhere')
  assert.equal(callsTo(second.fetch, 'GET', '/rest/api/3/project/ENG/statuses').length, 0)
})

const FUTURE = { id: 2, state: 'future', name: 'Sprint 2' }
const CLOSED = { id: 3, state: 'closed', name: 'Sprint 3', completeDate: '2026-11-08T12:00:00.000Z' }
const agileWrites = (fake) => fake.writes().map((write) => `${write.method} ${write.path}`).filter((line) => line.includes('/agile/'))

test('createIssue with a sprint moves the new item into it before the status move', async () => {
  const { fake, tracker } = setup({ sprints: [SPRINT] })
  const dry = await tracker.createIssue({ title: 'First', sprint: '1' }, ME, { dryRun: true })
  assert.equal(dry.after.sprint, '1')
  assert.deepEqual(fake.writes(), [])
  const made = await tracker.createIssue({ title: 'First', sprint: '1', status: 'in_progress' }, ME)
  assert.equal(made.after.sprint, '1')
  assert.equal((await tracker.getIssue('ENG-1')).sprint, '1')
  assert.deepEqual(fake.writes().map((write) => `${write.method} ${write.path}`), ['POST /rest/api/3/issue', 'POST /rest/agile/1.0/sprint/1/issue', 'POST /rest/api/3/issue/ENG-1/transitions'])
  assert.equal((await tracker.createIssue({ title: 'Second', sprint: null }, ME)).after.sprint, undefined)
  assert.equal(agileWrites(fake).length, 1)
})

test('createIssue with a sprint that moves wrongly is UPSTREAM naming the created key', async () => {
  const { fake, tracker } = setup({ sprints: [SPRINT], routes: { 'POST /rest/agile/1.0/sprint/1/issue': { status: 500, json: {} } } })
  await assert.rejects(tracker.createIssue({ title: 'First', sprint: '1' }, ME), (error) => error.code === 'UPSTREAM' && error.details.created === 'ENG-1' && error.nextStep === 'pmkit cycle add ENG-1 --to 1')
  assert.equal(fake.writes().length, 1)
})

test('updateIssue moves an item between sprints and to none; an unchanged sprint sends nothing', async () => {
  const { fake, tracker } = setup({ sprints: [SPRINT, FUTURE] })
  const [key] = seed(fake.state)
  assert.deepEqual(fake.writes(), [])
  await tracker.updateIssue(key, { sprint: null }, ME)
  assert.deepEqual(fake.writes(), [])
  const dry = await tracker.updateIssue(key, { sprint: '1' }, ME, { dryRun: true })
  assert.equal(dry.after.sprint, '1')
  assert.deepEqual(fake.writes(), [])
  assert.equal((await tracker.updateIssue(key, { sprint: 'current', title: 'Renamed' }, ME)).after.sprint, '1')
  assert.deepEqual(fake.writes().map((write) => `${write.method} ${write.path}`), ['PUT /rest/api/3/issue/ENG-1', 'POST /rest/agile/1.0/sprint/1/issue'])
  const count = fake.writes().length
  await tracker.updateIssue(key, { sprint: '1' }, ME)
  assert.equal(fake.writes().length, count)
  assert.equal((await tracker.updateIssue(key, { sprint: '2' }, ME)).after.sprint, '2')
  const after = await tracker.updateIssue(key, { sprint: null }, ME)
  assert.equal(after.after.sprint, undefined)
  assert.deepEqual(fake.writes().at(-1), { method: 'POST', path: '/rest/agile/1.0/backlog/issue', body: { issues: [key] } })
})

test('updateIssue to a closed or unknown sprint, or current with none active, sends nothing', async () => {
  const { fake, tracker } = setup({ sprints: [CLOSED, FUTURE] })
  const [key] = seed(fake.state)
  await assert.rejects(tracker.updateIssue(key, { sprint: '3' }, ME), { code: 'CONFLICT' })
  await assert.rejects(tracker.updateIssue(key, { sprint: '99' }, ME), { code: 'INVALID_INPUT' })
  await assert.rejects(tracker.updateIssue(key, { sprint: 'current' }, ME), { code: 'INVALID_INPUT', message: 'there is no active sprint', nextStep: 'pmkit cycle list' })
  assert.deepEqual(fake.writes(), [])
})

test('updateIssue whose sprint move fails after the field write is UPSTREAM with the next step', async () => {
  const { fake, tracker } = setup({ sprints: [SPRINT], routes: { 'POST /rest/agile/1.0/sprint/1/issue': { status: 500, json: {} } } })
  const [key] = seed(fake.state)
  await assert.rejects(tracker.updateIssue(key, { sprint: '1', title: 'Renamed' }, ME), (error) => error.code === 'UPSTREAM' && error.message.startsWith('Jira updated ENG-1, but moving it to sprint 1 failed') && error.nextStep === 'pmkit cycle add ENG-1 --to 1')
})

test('the string none is not a sprint value in a write', async () => {
  const { fake, tracker } = setup({ sprints: [SPRINT] })
  const [key] = seed(fake.state)
  await assert.rejects(tracker.createIssue({ title: 'First', sprint: 'none' }, ME), { code: 'INVALID_INPUT' })
  await assert.rejects(tracker.updateIssue(key, { sprint: 'none' }, ME), { code: 'INVALID_INPUT' })
  assert.deepEqual(fake.writes(), [])
})

const VERSIONS = [{ id: '10200', name: '2.0' }, { id: '10201', name: 'Release "A"' }, { id: '10202', name: 'old', archived: true }]
const versionCalls = (fetch) => callsTo(fetch, 'GET', '/rest/api/3/project/ENG/version').length

test('updateIssue sets the release as fixVersions, refuses an unknown one and clears it with null', async () => {
  const { fake, fetch, tracker } = setup({ versions: VERSIONS })
  const [key] = seed(fake.state)
  await tracker.updateIssue(key, { title: 'Renamed' }, ME)
  assert.equal(versionCalls(fetch), 0, 'a patch without a release reads no versions')
  const set = await tracker.updateIssue(key, { release: '2.0' }, ME)
  assert.equal(set.after.release, '2.0')
  const put = callsTo(fetch, 'PUT', `/rest/api/3/issue/${key}`).at(-1)
  assert.deepEqual(JSON.parse(put.body), { fields: { fixVersions: [{ id: '10200' }] } })
  await assert.rejects(tracker.updateIssue(key, { release: 'nope' }, ME), { code: 'INVALID_INPUT', message: 'release nope does not exist', nextStep: 'pmkit release list' })
  await assert.rejects(tracker.updateIssue(key, { release: 'old' }, ME), { code: 'INVALID_INPUT' })
  const writes = fake.writes().length
  assert.deepEqual((await tracker.updateIssue(key, { release: '2.0' }, ME)).after.release, '2.0')
  assert.equal(fake.writes().length, writes, 'the same release sends nothing')
  const cleared = await tracker.updateIssue(key, { release: null }, ME)
  assert.equal(cleared.after.release, undefined)
  assert.deepEqual(JSON.parse(callsTo(fetch, 'PUT', `/rest/api/3/issue/${key}`).at(-1).body), { fields: { fixVersions: [] } })
})

test('createIssue with a release sets fixVersions', async () => {
  const { fake, tracker } = setup({ versions: VERSIONS })
  const made = await tracker.createIssue({ title: 'First', release: 'Release "A"' }, ME)
  assert.equal(made.after.release, 'Release "A"')
  assert.deepEqual(fake.state.items[made.after.id].fields.fixVersions.map((version) => version.id), ['10201'])
})

test('a milestone value is NOT_SUPPORTED: Jira has no milestones', async () => {
  const { fake, tracker } = setup()
  const [key] = seed(fake.state)
  await assert.rejects(tracker.updateIssue(key, { milestone: 'm1' }, ME), { code: 'NOT_SUPPORTED', message: 'Jira has no milestones', nextStep: 'Use a release (version) or an epic' })
  await assert.rejects(tracker.createIssue({ title: 'x', milestone: 'm1' }, ME), { code: 'NOT_SUPPORTED', message: 'Jira has no milestones' })
  assert.deepEqual((await tracker.updateIssue(key, { milestone: null }, ME)).after, (await tracker.getIssue(key)))
  assert.deepEqual(fake.writes(), [])
})

test('searchIssues by release sends the version id in JQL; an unknown name returns no issues', async () => {
  const { fake, fetch, tracker } = setup({ versions: VERSIONS })
  const [inTwo, inA] = [seed(fake.state, 1, { fixVersions: [{ id: '10200' }] })[0], seed(fake.state, 1, { fixVersions: [{ id: '10201' }] })[0]]
  seed(fake.state)
  assert.deepEqual((await tracker.searchIssues({ release: '2.0' })).issues.map((issue) => issue.id), [inTwo])
  assert.deepEqual((await tracker.searchIssues({ release: 'Release "A"' })).issues.map((issue) => issue.id), [inA])
  const jql = new URL(callsTo(fetch, 'GET', '/rest/api/3/search/jql').at(-1).url).searchParams.get('jql')
  assert.match(jql, /fixVersion = "10201"/)
  assert.doesNotMatch(jql, /Release/)
  const searches = callsTo(fetch, 'GET', '/rest/api/3/search/jql').length
  assert.deepEqual(await tracker.searchIssues({ release: 'nope' }), { issues: [], problems: [], hasMore: false })
  assert.deepEqual(await tracker.searchIssues({ release: 'old' }), { issues: [], problems: [], hasMore: false })
  assert.equal(callsTo(fetch, 'GET', '/rest/api/3/search/jql').length, searches, 'an unknown release sends no search')
  const before = versionCalls(fetch)
  await tracker.searchIssues({})
  assert.equal(versionCalls(fetch), before, 'a search without a release reads no versions')
})

test('searchIssues leaves an epic out, even one in a sprint, and getIssue still reads it (ADR 0017)', async () => {
  const { fake, fetch, tracker } = setup({ sprints: [SPRINT] })
  const [story] = seed(fake.state)
  const [epic] = seed(fake.state, 1, { issuetype: WORK_TYPE.epic })
  await post(fetch, '/sprint/1/issue', { issues: [story, epic] })
  assert.deepEqual((await tracker.searchIssues({})).issues.map((issue) => issue.id), [story])
  assert.deepEqual((await tracker.searchIssues({ sprint: '1' })).issues.map((issue) => issue.id), [story])
  assert.equal((await tracker.getIssue(epic)).id, epic)
})
