import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { isId } from './lib/ids.mjs'
import { hashTree, makeRepo } from './test-helpers.mjs'
import { CUSTOMER_PREFIX, parseCustomer, serializeCustomer, sortCustomers } from './lib/local/customers.mjs'
import { REQUEST_PREFIX, REQUEST_STATES, groupDemand, parseRequest, serializeRequest, sortRequests } from './lib/local/requests.mjs'

const code = (value) => (error) => error.code === value
const doctor = (error) => error.code === 'INVALID_INPUT' && error.nextStep === '/pmkit:local:doctor'

test('the prefixes are CUS and REQ and a request has three states', () => {
  assert.equal(CUSTOMER_PREFIX, 'CUS')
  assert.equal(REQUEST_PREFIX, 'REQ')
  assert.deepEqual(REQUEST_STATES, ['open', 'accepted', 'declined'])
})

test('a customer round trips through its file, and the stem is the id', () => {
  const customer = { name: 'Acme Corp', status: 'active', tier: 'enterprise', revenue: 120000, size: 4.5, owner: 'fred', notes: 'Pays yearly.' }
  const text = serializeCustomer(customer)
  assert.equal(text, '---\nname: Acme Corp\nstatus: active\ntier: enterprise\nrevenue: 120000\nsize: 4.5\nowner: fred\n---\n\nPays yearly.\n')
  assert.deepEqual(parseCustomer(text, 'CUS-1'), { id: 'CUS-1', ...customer })
  assert.equal(serializeCustomer({ name: 'Bare', notes: '' }), '---\nname: Bare\n---\n')
  assert.deepEqual(parseCustomer('---\r\nid: CUS-9\r\nname: Bare\r\n---\r\n', 'CUS-2'), { id: 'CUS-2', name: 'Bare', notes: '' })
})

test('parseCustomer refuses a missing name, a line break, a bad revenue or size', () => {
  const bad = [
    '---\ntier: gold\n---\n', '---\nname: One\rTwo\n---\n', '---\nname: A\ntier: [a, b]\n---\n',
    '---\nname: A\nrevenue: -1\n---\n', '---\nname: A\nrevenue: 1.5\n---\n', '---\nname: A\nsize: big\n---\n', '---\nname: A\nowner: 7\n---\n', 'no frontmatter\n',
  ]
  for (const text of bad) assert.throws(() => parseCustomer(text, 'CUS-1'), doctor, text)
  assert.throws(() => parseCustomer('---\n<<<<<<< HEAD\nname: A\n=======\nname: B\n>>>>>>> other\n---\n', 'CUS-1'), code('CONFLICT'))
})

test('sortCustomers puts the highest revenue first, a missing revenue last, then the name', () => {
  const list = [{ id: 'CUS-1', name: 'b' }, { id: 'CUS-2', name: 'a', revenue: 10 }, { id: 'CUS-3', name: 'c', revenue: 50 }, { id: 'CUS-4', name: 'a' }]
  assert.deepEqual(sortCustomers(list).map((item) => item.id), ['CUS-3', 'CUS-2', 'CUS-4', 'CUS-1'])
})

test('a request with only a title is open and not important', () => {
  assert.deepEqual(parseRequest('---\ntitle: Export to CSV\n---\n', 'REQ-1'), { id: 'REQ-1', title: 'Export to CSV', body: '', important: false, state: 'open' })
})

test('a request round trips with every key in file order', () => {
  const request = {
    title: 'Export to CSV', customer: 'CUS-1', from: 'support', important: true, created: '2026-10-31T12:00:00.000Z', state: 'accepted', issue: 'ISS-1',
    triaged: '2026-10-31T13:00:00Z', triagedBy: 'fred', body: 'Please.',
  }
  const text = serializeRequest(request)
  assert.equal(text, '---\ntitle: Export to CSV\ncustomer: CUS-1\nfrom: support\nimportant: true\ncreated: 2026-10-31T12:00:00.000Z\nstate: accepted\nissue: ISS-1\ntriaged: 2026-10-31T13:00:00Z\ntriaged_by: fred\n---\n\nPlease.\n')
  assert.deepEqual(parseRequest(text, 'REQ-1'), { id: 'REQ-1', ...request })
  const declined = parseRequest('---\ntitle: T\nstate: declined\nreason: Out of scope\n---\n', 'REQ-2')
  assert.equal(declined.reason, 'Out of scope')
})

test('parseRequest refuses a bad state, a missing issue, a misplaced issue or reason and bad values', () => {
  const bad = [
    '---\nfrom: support\n---\n', '---\ntitle: T\nstate: done\n---\n', '---\ntitle: T\nstate: accepted\n---\n', '---\ntitle: T\nissue: ISS-1\n---\n',
    '---\ntitle: T\nstate: accepted\nissue: ISS-1\nreason: no\n---\n', '---\ntitle: T\nimportant: yes\n---\n', '---\ntitle: T\ncreated: tomorrow\n---\n',
    '---\ntitle: T\nstate: declined\ntriaged: later\n---\n', '---\ntitle: T\ncustomer: Acme\n---\n', '---\ntitle: T\nstate: accepted\nissue: "../x"\n---\n',
  ]
  for (const text of bad) assert.throws(() => parseRequest(text, 'REQ-1'), doctor, text)
})

test('sortRequests orders by created, then id, and a request without created goes last', () => {
  const list = [{ id: 'REQ-3' }, { id: 'REQ-2', created: '2026-10-02T00:00:00Z' }, { id: 'REQ-10', created: '2026-10-01T00:00:00Z' }, { id: 'REQ-1' }]
  assert.deepEqual(sortRequests(list).map((item) => item.id), ['REQ-10', 'REQ-2', 'REQ-1', 'REQ-3'])
})

test('groupDemand groups accepted requests by issue, most asked first', () => {
  const requests = [
    { id: 'REQ-1', state: 'accepted', issue: 'ISS-2', important: false, customer: 'CUS-1' },
    { id: 'REQ-2', state: 'accepted', issue: 'ISS-1', important: true, customer: 'CUS-1' },
    { id: 'REQ-3', state: 'accepted', issue: 'ISS-1', important: false, from: 'support' },
    { id: 'REQ-4', state: 'open', important: true, customer: 'CUS-2' },
    { id: 'REQ-5', state: 'accepted', issue: 'ISS-1', important: false, customer: 'CUS-1' },
  ]
  assert.deepEqual(groupDemand(requests), [
    { issue: 'ISS-1', count: 3, important: 1, requests: ['REQ-2', 'REQ-3', 'REQ-5'], customers: ['CUS-1'], from: ['support'] },
    { issue: 'ISS-2', count: 1, important: 0, requests: ['REQ-1'], customers: ['CUS-1'], from: [] },
  ])
})

// The tracker operations.

function setup({ numbered = true } = {}) {
  const root = makeRepo('team')
  if (numbered) fs.appendFileSync(path.join(root, '.issues', 'config.yaml'), 'id_style: numbered\n')
  const dir = (name) => path.join(root, '.issues', name)
  const write = (name, file, text) => {
    fs.mkdirSync(dir(name), { recursive: true })
    fs.writeFileSync(path.join(dir(name), file), text)
  }
  return { root, dir, write, tracker: createLocalTracker(root, { now: () => new Date('2026-10-23T12:00:00Z') }) }
}

test('createCustomer writes customers/<id>.md with a CUS id, and a dry run writes nothing', () => {
  const { root, dir, tracker } = setup({ numbered: false })
  const before = hashTree(root)
  const dry = tracker.createCustomer({ name: 'Acme', tier: 'gold', revenue: 500, owner: 'fred' }, 'fred', { dryRun: true })
  assert.equal(dry.before, null)
  assert.deepEqual(hashTree(root), before)
  const { after } = tracker.createCustomer({ name: 'Acme', tier: 'gold', revenue: 500, owner: 'fred' }, 'fred')
  assert.ok(isId(after.id, 'CUS'), after.id)
  assert.deepEqual(after, {
    id: after.id, name: 'Acme', status: null, tier: { id: 'gold', name: 'gold' }, revenue: 500, size: null,
    owner: { id: 'fred', name: 'Fred Vanelli' }, requests: 0, url: null, notes: '',
  })
  assert.equal(fs.readFileSync(path.join(dir('customers'), `${after.id}.md`), 'utf8'), '---\nname: Acme\ntier: gold\nrevenue: 500\nowner: fred\n---\n')
})

test('createCustomer refuses a missing name, an owner who is not a member, a bad revenue and an unknown field', () => {
  const { tracker } = setup()
  for (const input of [{}, { name: 'A', owner: 'nobody' }, { name: 'A', revenue: -2 }, { name: 'A', revenue: '10' }, { name: 'A', url: 'x' }]) {
    assert.throws(() => tracker.createCustomer(input, 'fred'), code('INVALID_INPUT'), JSON.stringify(input))
  }
})

test('getCustomer finds an id, a normalized id or an exact name, and refuses a name two customers share', () => {
  const { tracker, write } = setup()
  write('customers', 'CUS-1.md', '---\nname: Acme\n---\n')
  write('customers', 'CUS-2.md', '---\nname: Beta\n---\n')
  assert.equal(tracker.getCustomer('cus-1').customer.id, 'CUS-1')
  assert.equal(tracker.getCustomer('beta').customer.id, 'CUS-2')
  write('customers', 'CUS-3.md', '---\nname: ACME\n---\n')
  assert.throws(() => tracker.getCustomer('acme'), (error) => error.code === 'INVALID_INPUT' && /CUS-1, CUS-3/.test(error.nextStep))
  for (const ref of ['../config', 'CUS-1/../../x', 'Nobody']) assert.throws(() => tracker.getCustomer(ref), code('NOT_FOUND'), ref)
})

test('createRequest writes an open request, or an accepted one with an issue, and checks the customer and the issue', () => {
  const { dir, tracker } = setup()
  const customer = tracker.createCustomer({ name: 'Acme' }, 'fred').after
  const open = tracker.createRequest({ title: 'CSV export', body: 'Please.', customer: customer.id, important: true }, 'fred').after
  assert.equal(open.id, 'REQ-1')
  assert.deepEqual(open, {
    id: 'REQ-1', title: 'CSV export', body: 'Please.', priority: 1, important: true, customer: { id: 'CUS-1', name: 'Acme' }, from: null,
    state: 'open', target: null, created: '2026-10-23T12:00:00.000Z', triaged: null, reason: null,
  })
  assert.equal(
    fs.readFileSync(path.join(dir('requests'), 'REQ-1.md'), 'utf8'),
    '---\ntitle: CSV export\ncustomer: CUS-1\nimportant: true\ncreated: 2026-10-23T12:00:00.000Z\nstate: open\n---\n\nPlease.\n',
  )
  const linked = tracker.createRequest({ title: 'Retries', from: 'support', issue: 'iss-5n1r' }, 'fred').after
  assert.equal(linked.state, 'accepted')
  assert.deepEqual(linked.target, { type: 'issue', id: 'ISS-5N1R', title: 'Paginate the events API' })
  assert.equal(linked.triaged, null)
  assert.throws(() => tracker.createRequest({ title: 'T', customer: 'CUS-9' }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createRequest({ title: 'T', issue: 'ISS-ZZZZ' }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createRequest({ title: 'T', issue: '../config' }, 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.createRequest({ body: 'no title' }, 'fred'), code('INVALID_INPUT'))
  assert.equal(tracker.getCustomer('CUS-1').customer.requests, 1)
  assert.deepEqual(tracker.getCustomer('CUS-1').requests.map((request) => request.id), ['REQ-1'])
})

test('acceptRequest links an issue and keeps unknown keys and the body; the same accept again writes nothing', () => {
  const { dir, write, tracker } = setup()
  write('requests', 'REQ-1.md', '---\ntitle: CSV export\nsource_ticket: 42\n---\n\nThe text.\n')
  const file = path.join(dir('requests'), 'REQ-1.md')
  const { before, after } = tracker.acceptRequest('req-1', 'ISS-5N1R', 'fred')
  assert.equal(before.state, 'open')
  assert.equal(after.state, 'accepted')
  assert.equal(after.target.id, 'ISS-5N1R')
  assert.deepEqual(after.triaged, { at: '2026-10-23T12:00:00Z', by: 'fred' })
  const text = fs.readFileSync(file, 'utf8')
  assert.match(text, /source_ticket: 42/)
  assert.match(text, /\n\nThe text\.\n$/)
  const again = tracker.acceptRequest('REQ-1', 'ISS-5N1R', 'fred')
  assert.deepEqual(again.before, again.after)
  assert.equal(fs.readFileSync(file, 'utf8'), text)
  assert.throws(() => tracker.acceptRequest('REQ-1', 'ISS-ZZZZ', 'fred'), code('INVALID_INPUT'))
  assert.throws(() => tracker.acceptRequest('REQ-9', 'ISS-5N1R', 'fred'), code('NOT_FOUND'))
})

test('declineRequest removes the issue and keeps the reason; a dry run writes nothing', () => {
  const { root, tracker } = setup()
  tracker.createRequest({ title: 'T', issue: 'ISS-5N1R' }, 'fred')
  const hash = hashTree(root)
  const dry = tracker.declineRequest('REQ-1', 'Out of scope', 'fred', { dryRun: true })
  assert.equal(dry.after.state, 'declined')
  assert.deepEqual(hashTree(root), hash)
  const { after } = tracker.declineRequest('REQ-1', 'Out of scope', 'fred')
  assert.equal(after.target, null)
  assert.equal(after.reason, 'Out of scope')
  assert.equal(tracker.acceptRequest('REQ-1', 'ISS-4M2S', 'fred').after.reason, null)
})

test('listRequests gives the open ones by default, every one with state all, and reports a broken file without failing', () => {
  const { write, tracker } = setup()
  tracker.createRequest({ title: 'A' }, 'fred')
  tracker.createRequest({ title: 'B', issue: 'ISS-5N1R' }, 'fred')
  write('requests', 'REQ-7.md', '---\ntitle: [\n---\n')
  write('requests', 'notes.md', '---\ntitle: N\n---\n')
  const open = tracker.listRequests()
  assert.deepEqual(open.requests.map((request) => request.id), ['REQ-1'])
  assert.deepEqual(open.problems.map((problem) => problem.id), ['REQ-7', 'notes'])
  assert.deepEqual(tracker.listRequests({ state: 'all' }).requests.map((request) => request.id), ['REQ-1', 'REQ-2'])
  assert.deepEqual(tracker.listRequests({ state: 'accepted' }).requests.map((request) => request.id), ['REQ-2'])
  assert.throws(() => tracker.listRequests({ state: 'done' }), code('INVALID_INPUT'))
  assert.throws(() => tracker.getRequest('REQ-7'), code('INVALID_INPUT'))
  for (const ref of ['../config', 'REQ-1/../x', 'notes']) assert.throws(() => tracker.getRequest(ref), code('NOT_FOUND'), ref)
})

test('a request whose issue or customer is gone still lists, with a null title or name and a problem', () => {
  const { write, tracker } = setup()
  write('requests', 'REQ-1.md', '---\ntitle: T\ncustomer: CUS-4\nstate: accepted\nissue: ISS-ZZZZ\n---\n')
  const { requests, problems } = tracker.listRequests({ state: 'all' })
  assert.deepEqual(requests[0].target, { type: 'issue', id: 'ISS-ZZZZ', title: null })
  assert.deepEqual(requests[0].customer, { id: 'CUS-4', name: null })
  assert.deepEqual(problems.map((problem) => problem.id), ['REQ-1', 'REQ-1'])
  const demand = tracker.listDemandSignals()
  assert.deepEqual(demand.signals[0].issue, { id: 'ISS-ZZZZ', title: null, status: null, priority: null })
  assert.ok(demand.problems.length > 0)
})

test('listDemandSignals groups accepted requests by issue with their customers', () => {
  const { tracker } = setup()
  const acme = tracker.createCustomer({ name: 'Acme', tier: 'gold', revenue: 100 }, 'fred').after
  tracker.createRequest({ title: 'A', customer: acme.id, issue: 'ISS-5N1R', important: true }, 'fred')
  tracker.createRequest({ title: 'B', from: 'support', issue: 'ISS-5N1R' }, 'fred')
  tracker.createRequest({ title: 'C', customer: acme.id, issue: 'ISS-4M2S' }, 'fred')
  tracker.createRequest({ title: 'D', customer: acme.id }, 'fred')
  const { signals, problems } = tracker.listDemandSignals()
  assert.deepEqual(problems, [])
  assert.equal(signals.length, 2)
  const [first] = signals
  assert.equal(first.issue.id, 'ISS-5N1R')
  assert.equal(first.issue.title, 'Paginate the events API')
  assert.ok(first.issue.status.category)
  assert.deepEqual({ count: first.count, important: first.important, requests: first.requests, from: first.from }, { count: 2, important: 1, requests: ['REQ-1', 'REQ-2'], from: ['support'] })
  assert.deepEqual(first.customers, [{ id: 'CUS-1', name: 'Acme', tier: { id: 'gold', name: 'gold' }, revenue: 100, size: null }])
})

test('listCustomers orders by revenue and reports a broken file', () => {
  const { write, tracker } = setup()
  write('customers', 'CUS-1.md', '---\nname: Small\nrevenue: 5\n---\n')
  write('customers', 'CUS-2.md', '---\nname: Big\nrevenue: 50\n---\n')
  write('customers', 'CUS-3.md', '---\nname: A\nrevenue: lots\n---\n')
  const { customers, problems } = tracker.listCustomers()
  assert.deepEqual(customers.map((customer) => customer.id), ['CUS-2', 'CUS-1'])
  assert.deepEqual(problems.map((problem) => problem.id), ['CUS-3'])
})
