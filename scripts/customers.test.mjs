import { test } from 'node:test'
import assert from 'node:assert/strict'
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
