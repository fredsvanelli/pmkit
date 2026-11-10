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

// PMK-190: order, unread records and the request rewrite.

test('the inbox sorts by instant, not by text', () => {
  const { write, tracker } = setup()
  write('requests', 'REQ-1.md', '---\ntitle: late in UTC\ncreated: 2026-11-01T09:00:00-05:00\n---\n')
  write('requests', 'REQ-2.md', '---\ntitle: noon UTC\ncreated: 2026-11-01T12:00:00Z\n---\n')
  assert.deepEqual(tracker.listRequests().requests.map((request) => request.id), ['REQ-2', 'REQ-1'])
  assert.deepEqual(sortRequests([{ id: 'REQ-1', created: '2026-11-01T09:00:00-05:00' }, { id: 'REQ-2', created: '2026-11-01T12:00:00Z' }]).map((item) => item.id), ['REQ-2', 'REQ-1'])
})

test('customers show lists the requests newest first, a request without created last, a tie by id descending', () => {
  const { write, tracker } = setup()
  write('customers', 'CUS-1.md', '---\nname: Acme\n---\n')
  write('requests', 'REQ-1.md', '---\ntitle: old\ncustomer: CUS-1\ncreated: 2026-11-01T12:00:00Z\n---\n')
  write('requests', 'REQ-2.md', '---\ntitle: offset\ncustomer: CUS-1\ncreated: 2026-11-01T09:00:00-05:00\n---\n')
  write('requests', 'REQ-3.md', '---\ntitle: tie a\ncustomer: CUS-1\ncreated: 2026-11-01T14:00:00Z\n---\n')
  write('requests', 'REQ-4.md', '---\ntitle: no date\ncustomer: CUS-1\n---\n')
  assert.deepEqual(tracker.getCustomer('CUS-1').requests.map((request) => request.id), ['REQ-3', 'REQ-2', 'REQ-1', 'REQ-4'])
})

test('getRequest returns the problems of an unreadable customer or issue, and an empty list when all reads', () => {
  const { write, tracker } = setup()
  write('requests', 'REQ-1.md', '---\ntitle: T\ncustomer: CUS-4\nstate: accepted\nissue: ISS-ZZZZ\n---\n')
  assert.deepEqual(tracker.getRequest('REQ-1').problems.map((problem) => problem.id), ['REQ-1', 'REQ-1'])
  write('requests', 'REQ-2.md', '---\ntitle: Fine\n---\n')
  assert.deepEqual(tracker.getRequest('REQ-2').problems, [])
})

test('customers show says the lookup is incomplete when a name matches nothing and a customer file could not be read', () => {
  const { write, tracker } = setup()
  write('customers', 'CUS-1.md', '---\nname: Acme\n---\n')
  write('customers', 'CUS-2.md', '---\ntier: gold\n---\n')
  assert.throws(() => tracker.getCustomer('Beta'), (error) => error.code === 'NOT_FOUND' && /CUS-2/.test(error.message) && /not (be )?read|incomplete|cannot be read/i.test(error.message))
  assert.throws(() => tracker.getCustomer('Nobody'), (error) => error.code === 'NOT_FOUND' && /CUS-2/.test(error.message))
  // A match is still found, and the unreadable file is reported next to it.
  const found = tracker.getCustomer('acme')
  assert.equal(found.customer.id, 'CUS-1')
  assert.deepEqual(found.problems.map((problem) => problem.id), ['CUS-2'])
})

test('requests list --customer refuses a customer that is not a readable customer file, and no customer filters nothing', () => {
  const { write, tracker } = setup()
  write('customers', 'CUS-1.md', '---\nname: Acme\n---\n')
  write('customers', 'CUS-2.md', '---\ntier: gold\n---\n')
  write('requests', 'REQ-1.md', '---\ntitle: A\ncustomer: CUS-1\n---\n')
  write('requests', 'REQ-2.md', '---\ntitle: B\n---\n')
  assert.deepEqual(tracker.listRequests({ customer: 'cus-1' }).requests.map((request) => request.id), ['REQ-1'])
  assert.deepEqual(tracker.listRequests({}).requests.map((request) => request.id), ['REQ-1', 'REQ-2'])
  // An empty value, such as an empty $CUSTOMER in a script, is refused and does not list every request.
  for (const customer of ['CUS-9', 'Acme', '../x', 'CUS-2', '']) {
    assert.throws(() => tracker.listRequests({ customer }), (error) => error.code === 'INVALID_INPUT', customer)
  }
  assert.throws(() => tracker.listRequests({ customer: 'CUS-9' }), (error) => error.nextStep === 'pmkit customers list')
})

test('accept and decline keep comments, unknown keys, key order and the body byte for byte', () => {
  const { dir, write, tracker } = setup()
  const head = '---\n# who asked\ntitle: CSV export\nsource_ticket: 42\ncreated: 2026-10-23T11:00:00Z\n# triage below\nstate: open\n---\n'
  const body = '\nThe text.\n\nSecond paragraph with   spaces.\n'
  write('requests', 'REQ-1.md', head + body)
  const file = path.join(dir('requests'), 'REQ-1.md')
  tracker.acceptRequest('REQ-1', 'ISS-5N1R', 'fred')
  const accepted = fs.readFileSync(file, 'utf8')
  assert.ok(accepted.endsWith('---\n' + body), 'the body is untouched')
  assert.match(accepted, /^---\n# who asked\ntitle: CSV export\nsource_ticket: 42\ncreated: 2026-10-23T11:00:00Z\n# triage below\nstate: accepted\n/)
  assert.match(accepted, /\nissue: ISS-5N1R\ntriaged: 2026-10-23T12:00:00Z\ntriaged_by: fred\n---\n/)
  tracker.declineRequest('REQ-1', 'Out of scope', 'fred')
  const declined = fs.readFileSync(file, 'utf8')
  assert.ok(declined.endsWith('---\n' + body))
  assert.match(declined, /^---\n# who asked\ntitle: CSV export\nsource_ticket: 42\ncreated: 2026-10-23T11:00:00Z\n# triage below\nstate: declined\n/)
  assert.doesNotMatch(declined, /issue:/)
  assert.match(declined, /reason: Out of scope/)
  assert.equal(parseRequest(declined, 'REQ-1').state, 'declined')
})

test('accept on a request with CRLF line endings writes LF and keeps the comment', () => {
  const { dir, write, tracker } = setup()
  write('requests', 'REQ-1.md', '---\r\n# note\r\ntitle: T\r\n---\r\n')
  tracker.acceptRequest('REQ-1', 'ISS-5N1R', 'fred')
  const text = fs.readFileSync(path.join(dir('requests'), 'REQ-1.md'), 'utf8')
  assert.ok(!text.includes('\r'))
  assert.match(text, /^---\n# note\ntitle: T\n/)
})

test('customers show says "does not exist" for an id with no file and "incomplete" only for a name that may sit in an unreadable file', () => {
  const { write, tracker } = setup()
  write('customers', 'CUS-1.md', '---\nname: Acme\n---\n')
  write('customers', 'CUS-2.md', '---\ntier: gold\n---\n')
  assert.throws(() => tracker.getCustomer('CUS-9'), (error) => error.code === 'NOT_FOUND' && /customer CUS-9 does not exist/.test(error.message) && !/incomplete/.test(error.message))
  assert.throws(() => tracker.getCustomer('Beta'), (error) => error.code === 'NOT_FOUND' && /incomplete/.test(error.message) && /CUS-2/.test(error.message))
})

test('--customer names an unreadable customer as unreadable, a missing one as missing and a name as not an id', () => {
  const { write, tracker } = setup()
  write('customers', 'CUS-2.md', '---\ntier: gold\n---\n')
  write('customers', 'CUS-3.md', '---\n<<<<<<< HEAD\nname: A\n=======\nname: B\n>>>>>>> o\n---\n')
  const message = (customer) => { try { tracker.listRequests({ customer }) } catch (error) { return `${error.code} ${error.message}` } }
  assert.match(message('CUS-2'), /^INVALID_INPUT customer CUS-2 cannot be read: .*needs a name/)
  assert.match(message('CUS-3'), /^CONFLICT customer CUS-3 cannot be read: /)
  assert.equal(message('CUS-9'), 'INVALID_INPUT customer CUS-9 does not exist')
  assert.match(message('Acme'), /^INVALID_INPUT customer "Acme" is not a customer id such as CUS-1/)
  assert.doesNotMatch(message('CUS-2'), /does not exist/)
})

test('accept and decline return the problems of the links they could not read', () => {
  const { write, tracker } = setup()
  write('requests', 'REQ-1.md', '---\ntitle: T\ncustomer: CUS-4\n---\n')
  write('requests', 'REQ-2.md', '---\ntitle: Fine\n---\n')
  assert.deepEqual(tracker.acceptRequest('REQ-1', 'ISS-5N1R', 'fred').problems.map((problem) => problem.id), ['REQ-1'])
  assert.deepEqual(tracker.declineRequest('REQ-1', 'No', 'fred', { dryRun: true }).problems.map((problem) => problem.id), ['REQ-1'])
  assert.deepEqual(tracker.declineRequest('REQ-2', 'No', 'fred').problems, [])
})

// PMK-204: what a demand problem is about, so a command can tell a problem that concerns a candidate from one that does not.
test('listDemandSignals says what each problem is about', () => {
  const { write, tracker } = setup()
  write('requests', 'REQ-1.md', '---\ntitle: T\ncustomer: CUS-4\nstate: accepted\nissue: ISS-ZZZZ\n---\n')
  write('requests', 'REQ-2.md', '<<<<<<< HEAD\ntitle: Broken\n=======\n>>>>>>> other\n')
  const { problems } = tracker.listDemandSignals()
  assert.deepEqual(problems.map((problem) => [problem.id, problem.about]).sort(), [['CUS-4', 'customer'], ['ISS-ZZZZ', 'issue'], ['REQ-2', 'request']])
})

// PMK-221: customers update.
test('updateCustomer edits each field, clears status, tier and owner with none, and keeps comments, unknown keys and notes', () => {
  const { dir, write, tracker } = setup()
  write('customers', 'CUS-1.md', '---\n# the account\nname: Acme\nplan: gold\nstatus: active\ntier: t1\nowner: fred\n---\n\nNotes.\n')
  const { before, after } = tracker.updateCustomer('acme', { name: 'Acme Corp', tier: 'enterprise', revenue: 5, size: 1.5, status: 'none', owner: 'NONE' }, 'fred')
  assert.equal(before.name, 'Acme')
  assert.deepEqual(after, {
    id: 'CUS-1', name: 'Acme Corp', status: null, tier: { id: 'enterprise', name: 'enterprise' }, revenue: 5, size: 1.5, owner: null, requests: 0, url: null, notes: 'Notes.',
  })
  const text = fs.readFileSync(path.join(dir('customers'), 'CUS-1.md'), 'utf8')
  for (const kept of ['# the account\n', 'plan: gold\n', '\nNotes.\n']) assert.ok(text.includes(kept), kept)
  assert.ok(!/^status:|^owner:/m.test(text), text)
  assert.equal(tracker.updateCustomer('CUS-1', { owner: 'fred' }, 'fred').after.owner.id, 'fred')
})

test('updateCustomer with no change or a dry run writes nothing, and refuses bad values', () => {
  const { root, write, tracker } = setup()
  write('customers', 'CUS-1.md', '---\r\nname: Acme\r\nrevenue: 10\r\n---\r\n')
  const hash = hashTree(root)
  const same = tracker.updateCustomer('CUS-1', { revenue: 10, tier: 'none' }, 'fred')
  assert.deepEqual(same.before, same.after)
  const dry = tracker.updateCustomer('CUS-1', { revenue: 20 }, 'fred', { dryRun: true })
  assert.equal(dry.after.revenue, 20)
  assert.deepEqual(hashTree(root), hash)
  for (const changes of [{}, { revenue: -1 }, { revenue: '10' }, { size: 'big' }, { owner: 'nobody' }, { name: '' }, { name: 'A\nB' }, { url: 'x' }]) {
    assert.throws(() => tracker.updateCustomer('CUS-1', changes, 'fred'), code('INVALID_INPUT'), JSON.stringify(changes))
  }
  assert.throws(() => tracker.updateCustomer('CUS-9', { revenue: 1 }, 'fred'), code('NOT_FOUND'))
  assert.deepEqual(hashTree(root), hash)
})

// PMK-221: requests update edits the text of a request.
test('updateRequest edits the title and the body, keeps triaged, unknown keys and comments', () => {
  const { dir, write, tracker } = setup()
  write('requests', 'REQ-1.md', '---\n# from the call\ntitle: CSV\nsource_ticket: 42\nstate: declined\nreason: later\ntriaged: 2026-10-23T12:00:00Z\ntriaged_by: fred\n---\n\nOld text.\n')
  const { before, after } = tracker.updateRequest('req-1', { title: 'CSV export', body: 'New text.\r\nSecond line.' }, 'fred')
  assert.deepEqual([before.title, before.body], ['CSV', 'Old text.'])
  assert.deepEqual([after.title, after.body, after.state, after.reason, after.triaged], ['CSV export', 'New text.\nSecond line.', 'declined', 'later', { at: '2026-10-23T12:00:00Z', by: 'fred' }])
  const text = fs.readFileSync(path.join(dir('requests'), 'REQ-1.md'), 'utf8')
  assert.equal(text, '---\n# from the call\ntitle: CSV export\nsource_ticket: 42\nstate: declined\nreason: later\ntriaged: 2026-10-23T12:00:00Z\ntriaged_by: fred\n---\n\nNew text.\nSecond line.\n')
  tracker.updateRequest('REQ-1', { body: '' }, 'fred')
  assert.ok(fs.readFileSync(path.join(dir('requests'), 'REQ-1.md'), 'utf8').endsWith('triaged_by: fred\n---\n'))
})

test('updateRequest with the same text or a dry run writes nothing, and refuses bad input', () => {
  const { root, write, tracker } = setup()
  write('requests', 'REQ-1.md', '---\ntitle: CSV\n---\n\nText.\n')
  const hash = hashTree(root)
  const same = tracker.updateRequest('REQ-1', { title: 'CSV', body: 'Text.\n' }, 'fred')
  assert.deepEqual(same.before, same.after)
  assert.equal(tracker.updateRequest('REQ-1', { title: 'Other' }, 'fred', { dryRun: true }).after.title, 'Other')
  assert.deepEqual(hashTree(root), hash)
  for (const changes of [{}, { title: '' }, { title: 'A\nB' }, { state: 'open' }]) {
    assert.throws(() => tracker.updateRequest('REQ-1', changes, 'fred'), code('INVALID_INPUT'), JSON.stringify(changes))
  }
  assert.throws(() => tracker.updateRequest('REQ-9', { title: 'T' }, 'fred'), code('NOT_FOUND'))
  assert.deepEqual(hashTree(root), hash)
})
