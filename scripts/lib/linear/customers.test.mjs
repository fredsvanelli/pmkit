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
