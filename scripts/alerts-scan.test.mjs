import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SEVERITIES, alertCandidate, alertKey, matchAlerts, priorityFor } from './lib/alerts.mjs'

// Key, priority, candidates and matching of `alerts scan` (PMK-73).

const ALERT = { id: 'npm-audit:lodash', scanner: 'npm-audit', package: 'lodash', title: 'Command Injection', severity: 'critical', url: 'https://example.com/a/2', fixAvailable: false }

test('alertKey is 12 hex digits that follow the scanner, the package and the advisory url', () => {
  const key = alertKey(ALERT)
  assert.match(key, /^[0-9a-f]{12}$/)
  assert.equal(alertKey({ ...ALERT, severity: 'low', title: 'other text', fixAvailable: true }), key, 'severity, title and fix do not change the key')
  assert.notEqual(alertKey({ ...ALERT, url: 'https://example.com/a/3' }), key)
  assert.notEqual(alertKey({ ...ALERT, package: 'lodash.merge' }), key)
  assert.notEqual(alertKey({ ...ALERT, scanner: 'other' }), key)
})

test('alertKey falls back to the title when the alert has no url', () => {
  const bare = { ...ALERT, url: null, title: 'vulnerable through minimist' }
  assert.notEqual(alertKey(bare), alertKey({ ...bare, title: 'vulnerable through tar' }))
})

test('priorityFor maps by position and clamps to the last priority', () => {
  const four = ['urgent', 'high', 'medium', 'low']
  assert.deepEqual(SEVERITIES.map((severity) => priorityFor(severity, four)), ['urgent', 'high', 'medium', 'low'])
  assert.deepEqual(SEVERITIES.map((severity) => priorityFor(severity, ['p1', 'p2', 'p3'])), ['p1', 'p2', 'p3', 'p3'])
  assert.deepEqual(SEVERITIES.map((severity) => priorityFor(severity, ['only'])), ['only', 'only', 'only', 'only'])
  assert.equal(priorityFor('high', ['a', 'b', 'c', 'd', 'e']), 'b')
  assert.equal(priorityFor('medium', ['a', 'b', 'c', 'd', 'e']), 'c')
  assert.equal(priorityFor('low', ['a', 'b', 'c', 'd', 'e']), 'e')
  assert.equal(priorityFor('critical', []), null)
})

test('alertCandidate has the title, type, priority and a description that ends with the key line', () => {
  const candidate = alertCandidate(ALERT, { priorities: ['urgent', 'high', 'medium', 'low'], types: ['feature', 'bug'] })
  assert.equal(candidate.title, 'Security: lodash: Command Injection')
  assert.equal(candidate.type, 'bug')
  assert.equal(candidate.priority, 'urgent')
  assert.equal(candidate.key, alertKey(ALERT))
  assert.match(candidate.description, /^Command Injection\n\nSeverity: critical\nPackage: lodash\nScanner: npm-audit\nAdvisory: https:\/\/example\.com\/a\/2\nFix available: no\n\nalert-key: [0-9a-f]{12}\n$/)
  assert.equal(alertCandidate(ALERT, { priorities: ['x'], types: ['task', 'chore'] }).type, 'task', 'the first allowed type when bug is not allowed')
})

test('alertCandidate cuts a long title at 120 characters and says when there is no advisory url', () => {
  const candidate = alertCandidate({ ...ALERT, title: 'x'.repeat(300), url: null, fixAvailable: true }, { priorities: ['a'], types: ['bug'] })
  assert.equal(candidate.title.length, 120)
  assert.match(candidate.description, /Advisory: none\nFix available: yes/)
})

test('matchAlerts matches an issue that holds the alert-key line, whatever its status, and keeps the rest', () => {
  const options = { priorities: ['urgent', 'high', 'medium', 'low'], types: ['bug'] }
  const a = alertCandidate(ALERT, options)
  const b = alertCandidate({ ...ALERT, package: 'tar', url: null, title: 'vulnerable through minimist', severity: 'high' }, options)
  const issues = [
    { id: 'ISS-1', status: { name: 'done' }, description: 'x', body: `## Description\n\nsomething\r\nalert-key: ${a.key}\r\n` },
    { id: 'ISS-2', status: { name: 'backlog' }, description: `mentions alert-key: ${b.key} inside a line`, body: '' },
  ]
  const { candidates, matched } = matchAlerts([a, b], issues)
  assert.deepEqual(candidates.map((c) => c.package), ['tar'])
  assert.deepEqual(matched.map((m) => [m.package, m.issue, m.status]), [['lodash', 'ISS-1', 'done']])
})
