import assert from 'node:assert/strict'
import test from 'node:test'
import { customersAvailability } from './customers.mjs'

const raw = (plan, customersEnabled) => ({ workspace: { plan }, flags: { customersEnabled } })
const PLAN_HINT = 'Linear customers need the Business or Enterprise plan'
const OFF_HINT = 'Turn on customers in the workspace settings in Linear'

test('the customers flag decides, whatever the plan says', () => {
  for (const plan of ['free', 'business', 'unknown']) assert.deepEqual(customersAvailability(raw(plan, true)), { available: true })
})

test('a plan outside the Business list with the flag off reports plan', () => {
  for (const plan of ['free', 'basic', 'unknown', 'plus']) {
    assert.deepEqual(customersAvailability(raw(plan, false)), { available: false, reason: 'plan', plan, enableHint: PLAN_HINT })
  }
})

test('a Business plan with the flag off reports customers_off', () => {
  for (const plan of ['business', 'enterprise', 'trial']) {
    assert.deepEqual(customersAvailability(raw(plan, false)), { available: false, reason: 'customers_off', plan, enableHint: OFF_HINT })
  }
})

import { customerView, customersText, requestView, sortCustomers } from './customers.mjs'

const node = (extra = {}) => ({
  id: 'cust-1',
  name: 'ACME Corp',
  status: { id: 'st-1', name: 'Active' },
  tier: { id: 'tier-1', name: 'Gold' },
  revenue: 120000,
  size: 450,
  owner: { id: 'user-2', name: 'Ada Lovelace' },
  approximateNeedCount: 7,
  url: 'https://linear.app/acme/customer/acme-corp',
  ...extra,
})

test('customerView shapes a Customer node', () => {
  assert.deepEqual(customerView(node()), {
    id: 'cust-1',
    name: 'ACME Corp',
    status: { id: 'st-1', name: 'Active' },
    tier: { id: 'tier-1', name: 'Gold' },
    revenue: 120000,
    size: 450,
    owner: { id: 'user-2', name: 'Ada Lovelace' },
    requests: 7,
    url: 'https://linear.app/acme/customer/acme-corp',
  })
})

test('customerView keeps a missing tier, revenue, size and owner as null', () => {
  const view = customerView(node({ tier: null, revenue: null, size: null, owner: null, approximateNeedCount: undefined }))
  assert.equal(view.tier, null)
  assert.equal(view.revenue, null)
  assert.equal(view.size, null)
  assert.equal(view.owner, null)
  assert.equal(view.requests, 0)
})

test('requestView gives the target of an issue, a project or neither', () => {
  const issue = requestView({ id: 'need-1', body: 'x', priority: 1, issue: { id: 'iss-1', identifier: 'ACME-12', title: 'Login', archivedAt: null }, project: null })
  assert.deepEqual(issue, { id: 'need-1', body: 'x', priority: 1, important: true, target: { type: 'issue', id: 'ACME-12', title: 'Login' } })
  const project = requestView({ id: 'need-2', body: null, priority: 0, issue: null, project: { id: 'proj-1', name: 'Mobile' } })
  assert.deepEqual(project, { id: 'need-2', body: '', priority: 0, important: false, target: { type: 'project', id: 'proj-1', name: 'Mobile' } })
  assert.equal(requestView({ id: 'need-3', body: '', priority: 0 }).target, null)
})

test('requestView cuts the body to 200 characters and flags an archived issue', () => {
  const view = requestView({ id: 'n', body: 'a'.repeat(300), priority: 0, issue: { id: 'i', identifier: 'ACME-1', title: 'T', archivedAt: '2026-01-01T00:00:00Z' } })
  assert.equal(view.body.length, 200)
  assert.deepEqual(view.target, { type: 'issue', id: 'ACME-1', title: 'T', archived: true })
})

test('sortCustomers puts the highest revenue first, then name, and a missing revenue last', () => {
  const list = [
    { name: 'Zed', revenue: null },
    { name: 'Beta', revenue: 10 },
    { name: 'Alpha', revenue: 10 },
    { name: 'Top', revenue: 99 },
    { name: 'Aaa', revenue: null },
  ]
  assert.deepEqual(sortCustomers(list).map((item) => item.name), ['Top', 'Alpha', 'Beta', 'Aaa', 'Zed'])
  assert.equal(list[0].name, 'Zed')
})

test('customersText aligns the columns and says when there is no customer', () => {
  const list = [
    customerView(node()),
    customerView(node({ id: 'c2', name: 'Globex', status: { id: 's2', name: 'Prospect' }, tier: null, revenue: null, size: 30, approximateNeedCount: 1 })),
  ]
  assert.equal(
    customersText(list),
    ['ACME Corp   status Active     tier Gold   revenue 120000   size 450   requests 7', 'Globex      status Prospect   tier -      revenue -        size 30    requests 1'].join('\n'),
  )
  assert.equal(customersText([]), 'no customers yet')
})

import { planCustomerEdit, planLink, resolveCustomer } from './customers.mjs'

const STATUSES = [{ id: 'st-1', name: 'Active' }, { id: 'st-2', name: 'Prospect' }]
const TIERS = [{ id: 'tier-1', name: 'Gold' }, { id: 'tier-2', name: 'Silver' }]
const MEMBERS = ['user-1', 'user-2']
const CURRENT = customerView(node())
const edit = (flags) => planCustomerEdit(CURRENT, flags, STATUSES, TIERS, MEMBERS)
const code = (fn) => {
  try {
    fn()
  } catch (error) {
    return error
  }
  assert.fail('expected an error')
}

test('planCustomerEdit builds one input from each flag, resolving names case-insensitively', () => {
  assert.deepEqual(edit({ status: 'prospect' }), { changed: true, input: { statusId: 'st-2' } })
  assert.deepEqual(edit({ tier: 'SILVER' }), { changed: true, input: { tierId: 'tier-2' } })
  assert.deepEqual(edit({ revenue: '5000' }), { changed: true, input: { revenue: 5000 } })
  assert.deepEqual(edit({ size: '12' }), { changed: true, input: { size: 12 } })
  assert.deepEqual(edit({ owner: 'user-1' }), { changed: true, input: { ownerId: 'user-1' } })
  assert.deepEqual(edit({ name: 'ACME Inc' }), { changed: true, input: { name: 'ACME Inc' } })
  assert.deepEqual(edit({ status: 'prospect', revenue: '0' }).input, { statusId: 'st-2', revenue: 0 })
})

test('planCustomerEdit clears the tier and the owner with none', () => {
  assert.deepEqual(edit({ tier: 'none' }).input, { tierId: null })
  assert.deepEqual(edit({ owner: 'none' }).input, { ownerId: null })
})

test('planCustomerEdit rejects bad input with INVALID_INPUT', () => {
  const cases = [
    {},
    { status: 'Gone' },
    { tier: 'Bronze' },
    { revenue: '1.5' },
    { revenue: '-3' },
    { revenue: 'lots' },
    { size: '2.5' },
    { size: 'x' },
    { owner: 'user-9' },
    { name: '' },
    { revenue: true },
  ]
  for (const flags of cases) assert.equal(code(() => edit(flags)).code, 'INVALID_INPUT', JSON.stringify(flags))
  assert.match(code(() => edit({ status: 'Gone' })).nextStep, /Active, Prospect/)
  assert.match(code(() => edit({ tier: 'Bronze' })).nextStep, /Gold, Silver/)
})

test('planCustomerEdit returns changed false when nothing differs', () => {
  assert.deepEqual(edit({ status: 'active', tier: 'gold', revenue: '120000', size: '450', owner: 'user-2', name: 'ACME Corp' }), { changed: false })
  const bare = planCustomerEdit(customerView(node({ tier: null, owner: null })), { tier: 'none', owner: 'none' }, STATUSES, TIERS, MEMBERS)
  assert.deepEqual(bare, { changed: false })
})

test('resolveCustomer matches the id, then the exact name', () => {
  const list = [customerView(node()), customerView(node({ id: 'cust-2', name: 'Globex' })), customerView(node({ id: 'cust-3', name: 'Dup' })), customerView(node({ id: 'cust-4', name: 'dup' }))]
  assert.equal(resolveCustomer(list, 'cust-2').name, 'Globex')
  assert.equal(resolveCustomer(list, 'acme corp').id, 'cust-1')
  const ambiguous = code(() => resolveCustomer(list, 'DUP'))
  assert.equal(ambiguous.code, 'INVALID_INPUT')
  assert.match(ambiguous.nextStep, /cust-3/)
  assert.match(ambiguous.nextStep, /cust-4/)
  assert.equal(code(() => resolveCustomer(list, 'nobody')).code, 'NOT_FOUND')
})

const ISSUE = { type: 'issue', id: 'ACME-12', linearId: 'iss-12', title: 'Login' }
const PROJECT = { type: 'project', id: 'proj-1', linearId: 'proj-1', name: 'Mobile' }
const OWNED = [
  requestView({ id: 'need-1', body: 'a', priority: 0, issue: { id: 'iss-9', identifier: 'ACME-9', title: 'Old' } }),
  requestView({ id: 'need-2', body: 'b', priority: 1, project: { id: 'proj-2', name: 'Web' } }),
]
const link = (flags, target, requests = OWNED) => planLink({ customer: CURRENT, requests, flags, target })

test('planLink creates a request on an issue or a project', () => {
  assert.deepEqual(link({ issue: 'ACME-12' }, ISSUE), { kind: 'create', input: { customerId: 'cust-1', issueId: 'iss-12', priority: 0 } })
  assert.deepEqual(link({ project: 'Mobile', important: true, body: 'Wants it' }, PROJECT), {
    kind: 'create',
    input: { customerId: 'cust-1', projectId: 'proj-1', priority: 1, body: 'Wants it' },
  })
})

test('planLink reports CONFLICT for a second request on the same target', () => {
  const error = code(() => link({ issue: 'ACME-9' }, { type: 'issue', id: 'ACME-9', linearId: 'iss-9', title: 'Old' }))
  assert.equal(error.code, 'CONFLICT')
  assert.match(error.message, /need-1/)
  assert.match(error.nextStep, /--request/)
})

test('planLink moves a request the customer owns', () => {
  assert.deepEqual(link({ request: 'need-1', project: 'Mobile' }, PROJECT), {
    kind: 'move',
    id: 'need-1',
    from: { type: 'issue', id: 'ACME-9', title: 'Old' },
    input: { issueId: null, projectId: 'proj-1' },
  })
  assert.deepEqual(link({ request: 'need-2', issue: 'ACME-12' }, ISSUE).input, { issueId: 'iss-12', projectId: null })
})

test('planLink rejects bad combinations with INVALID_INPUT', () => {
  const cases = [
    [{ issue: 'ACME-12', project: 'Mobile' }, ISSUE],
    [{}, undefined],
    [{ request: 'need-1' }, undefined],
    [{ request: 'need-9', issue: 'ACME-12' }, ISSUE],
    [{ request: 'need-1', issue: 'ACME-12', body: 'x' }, ISSUE],
    [{ request: 'need-1', issue: 'ACME-12', important: true }, ISSUE],
    [{ issue: 'not a key' }, undefined],
    [{ request: 'need-1', issue: 'ACME-9' }, { type: 'issue', id: 'ACME-9', linearId: 'iss-9', title: 'Old' }],
  ]
  for (const [flags, target] of cases) assert.equal(code(() => link(flags, target)).code, 'INVALID_INPUT', JSON.stringify(flags))
})
