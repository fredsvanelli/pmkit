import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { CAPABILITIES } from './lib/capabilities.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { fixedNow, makeRepo } from './test-helpers.mjs'

const tracker = (fixture = 'team') => createLocalTracker(makeRepo(fixture), { now: fixedNow(), random: () => 0 })

test('the manifest lists the 20 capabilities in spec order, each with a path', () => {
  const manifest = tracker().capabilities()
  assert.equal(CAPABILITIES.length, 20)
  assert.deepEqual(manifest.capabilities.map((entry) => entry.id), CAPABILITIES)
  assert.equal(CAPABILITIES[0], 'cycles')
  assert.equal(CAPABILITIES[19], 'user_inbox')
  assert.equal(manifest.tracker, 'local')
  assert.equal(manifest.generatedAt, '2026-10-23T12:00:00Z')
  const derived = manifest.capabilities.filter((entry) => entry.path === 'derived').map((entry) => entry.id)
  assert.deepEqual(derived, ['native_metrics', 'linked_code', 'agent_delegation', 'security_alerts', 'user_inbox'])
  assert.equal(manifest.capabilities.filter((entry) => entry.path === 'native').length, 15)
})

test('derived capabilities carry their detail', () => {
  const byId = Object.fromEntries(tracker().capabilities().capabilities.map((entry) => [entry.id, entry]))
  assert.deepEqual(byId.native_metrics.detail, { source: 'events' })
  assert.deepEqual(byId.linked_code.detail, { source: 'git' })
  assert.deepEqual(byId.agent_delegation.detail, { assignee: 'agent:<name>' })
  assert.deepEqual(byId.security_alerts.detail, { source: 'local scanners' })
  assert.deepEqual(byId.user_inbox.detail, { source: 'mentions and assignments since the last check' })
})

function withGitHost(system) {
  const root = makeRepo('basic')
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/git_host:\n(  .*\n)+/, `git_host:\n  system: ${system}\n`))
  return createLocalTracker(root, { now: fixedNow() })
}

test('linked_code has an enable hint only when git_host is none', () => {
  const linked = (t) => t.capabilities().capabilities.find((entry) => entry.id === 'linked_code')
  const none = withGitHost('none')
  assert.equal(none.capabilities().gitHost, 'none')
  assert.equal(linked(none).enableHint, 'Set git_host in .pmkit/config.yaml')
  const github = withGitHost('github')
  assert.equal(github.capabilities().gitHost, 'github')
  assert.equal('enableHint' in linked(github), false)
})

test('estimation detail comes from the config', () => {
  const entry = tracker().capabilities().capabilities.find((item) => item.id === 'estimation')
  assert.deepEqual(entry, { id: 'estimation', path: 'native', detail: { unit: 'points', scale: [1, 2, 3, 5, 8, 13] } })
})

test('discover lists statuses in config order, the lists and members sorted by id', () => {
  const found = tracker().discover()
  assert.deepEqual(found.statuses, [
    { name: 'triage', category: 'triage' }, { name: 'backlog', category: 'backlog' }, { name: 'todo', category: 'todo' },
    { name: 'in_progress', category: 'in_progress' }, { name: 'in_review', category: 'in_review' },
    { name: 'done', category: 'done' }, { name: 'canceled', category: 'canceled' },
  ])
  assert.deepEqual(found.types, ['feature', 'bug', 'task', 'chore'])
  assert.deepEqual(found.priorities, ['urgent', 'high', 'medium', 'low'])
  assert.deepEqual(found.labels, ['backend', 'frontend', 'webhooks', 'billing'])
  assert.deepEqual(found.members, [
    { id: 'ana', name: 'Ana Souza', email: 'ana@example.com', availability: 0.8 },
    { id: 'fred', name: 'Fred Vanelli', email: 'fred@example.com', availability: 1 },
  ])
  assert.deepEqual(found.estimate, { unit: 'points', scale: [1, 2, 3, 5, 8, 13] })
})
