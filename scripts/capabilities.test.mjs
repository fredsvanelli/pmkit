import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { CAPABILITIES, SERVED_BY, unservedCapabilities } from './lib/capabilities.mjs'
import { COMMANDS } from './pmkit.mjs'
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
  const byPath = (wanted) => manifest.capabilities.filter((entry) => entry.path === wanted).map((entry) => entry.id)
  assert.deepEqual(byPath('native'), [
    'cycles', 'estimation', 'multilevel_hierarchy', 'dependencies', 'native_triage', 'deliverables', 'status_update',
    'releases', 'capacity', 'saved_views', 'documents', 'time_tracking',
  ])
  assert.deepEqual(byPath('derived'), ['native_metrics', 'linked_code', 'agent_delegation', 'security_alerts'])
  assert.deepEqual(byPath('absent'), [
    'strategic_goals', 'demand_signals', 'request_queue', 'user_inbox',
  ])
})

test('derived capabilities carry their detail and absent ones a hint', () => {
  const byId = Object.fromEntries(tracker().capabilities().capabilities.map((entry) => [entry.id, entry]))
  assert.deepEqual(byId.native_metrics.detail, { source: 'events' })
  assert.deepEqual(byId.linked_code.detail, { source: 'git' })
  assert.deepEqual(byId.security_alerts.detail, { source: 'scanners' })
  assert.deepEqual(byId.agent_delegation, { id: 'agent_delegation', path: 'derived', detail: { source: 'assignee', run: 'local' } })
  assert.deepEqual(byId.releases, { id: 'releases', path: 'native' })
  assert.deepEqual(byId.saved_views, { id: 'saved_views', path: 'native' })
  assert.deepEqual(byId.strategic_goals, {
    id: 'strategic_goals', path: 'absent', enableHint: 'No pmkit command serves strategic_goals in the Local tracker yet',
  })
})

test('SERVED_BY has exactly the capability ids, in spec order', () => {
  assert.deepEqual(Object.keys(SERVED_BY), CAPABILITIES)
})

test('every command in SERVED_BY exists in the CLI command table', () => {
  const names = new Set(COMMANDS.map((command) => command.name))
  for (const [id, commands] of Object.entries(SERVED_BY)) {
    for (const name of commands) assert.ok(names.has(name), `${id} names unknown command "${name}"`)
  }
})

test('issues dependencies serves dependencies and multilevel_hierarchy', () => {
  assert.ok(SERVED_BY.dependencies.includes('issues dependencies'))
  assert.ok(SERVED_BY.multilevel_hierarchy.includes('issues dependencies'))
})

test('a native or derived capability has a serving command, an absent one has a hint and no detail', () => {
  for (const entry of tracker().capabilities().capabilities) {
    if (entry.path === 'absent') {
      assert.deepEqual(SERVED_BY[entry.id], [], `${entry.id} is absent but lists commands`)
      assert.ok(entry.enableHint, `${entry.id} is absent without an enableHint`)
      assert.equal('detail' in entry, false, `${entry.id} is absent with a detail`)
    } else {
      assert.ok(['native', 'derived'].includes(entry.path), `${entry.id} has path ${entry.path}`)
      assert.ok(SERVED_BY[entry.id].length > 0, `${entry.id} is ${entry.path} with no serving command`)
    }
  }
})

test('unservedCapabilities flags a native or derived capability with no serving command', () => {
  const entries = tracker().capabilities().capabilities
  assert.deepEqual(unservedCapabilities(entries, SERVED_BY), [])
  const doctored = entries.map((entry) => (entry.id === 'strategic_goals' ? { id: entry.id, path: 'native' } : entry))
  assert.deepEqual(unservedCapabilities(doctored, SERVED_BY), ['strategic_goals'])
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

test('release-notes serves releases and cycles', () => {
  assert.ok(SERVED_BY.releases.includes('release-notes'))
  assert.ok(SERVED_BY.cycles.includes('release-notes'))
})
