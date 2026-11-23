// Tests of the jira plans text (PMK-82): the branches the CLI fixtures do not reach.
import assert from 'node:assert/strict'
import test from 'node:test'
import { getText, listText } from './plans-text.mjs'

const SITE = 'acme.atlassian.net'

test('an empty plan list names the site', () => {
  assert.equal(listText({ available: true, site: SITE, plans: [], hasMore: false }), `no plans on ${SITE}`)
})

test('a cut plan list says to pass --limit', () => {
  const plan = { id: '12', name: 'Q1 roadmap', status: 'active', scenario: null }
  assert.equal(listText({ available: true, site: SITE, plans: [plan], hasMore: true }), '12  Q1 roadmap  (active)  scenario none\nmore plans match; pass --limit to read more')
})

test('a plan whose default scenario was not read says so, and a team without capacity reads unknown', () => {
  const team = { id: 'ab-1', name: null, planningStyle: 'kanban', capacity: null, capacityUnit: null }
  const text = getText({ available: true, site: SITE, plan: { id: '12', name: 'x', status: 'active', scenario: null, scheduling: null, releases: [], teams: [team] } })
  assert.equal(text, '12  x  (active)\nscenario: not read\nteam: ab-1  kanban  capacity unknown')
})
