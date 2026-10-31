import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SEVERITIES, alertCandidate, alertKey, matchAlerts, parseNpmAudit, priorityFor } from './lib/alerts.mjs'

// Key, priority, candidates and matching of `alerts scan` (PMK-73).

const ALERT = { id: 'npm-audit:lodash', scanner: 'npm-audit', package: 'lodash', title: 'Command Injection', severity: 'critical', url: 'https://example.com/a/2', fixAvailable: false }

test('alertKey follows only the scanner and the package', () => {
  const key = alertKey(ALERT)
  assert.match(key, /^[0-9a-f]{12}$/)
  const other = { ...ALERT, severity: 'low', title: 'other text', url: 'https://example.com/a/3', fixAvailable: true, advisories: [{ title: 'x', url: 'y' }] }
  assert.equal(alertKey(other), key, 'severity, title, url, fix and advisories do not change the key')
  assert.notEqual(alertKey({ ...ALERT, package: 'lodash.merge' }), key)
  assert.notEqual(alertKey({ ...ALERT, scanner: 'other' }), key)
})

test('a package that goes through b and c keeps its key when it goes through b only', () => {
  const via = (title) => ({ ...ALERT, package: 'a', url: null, title })
  assert.equal(alertKey(via('vulnerable through b, c')), alertKey(via('vulnerable through b')))
})

test('two advisories on one package are one alert, and their order does not change the key', () => {
  const report = (via) => JSON.stringify({ vulnerabilities: { a: { name: 'a', severity: 'high', via, fixAvailable: true } } })
  const first = { title: 'One', url: 'https://example.com/1', severity: 'high' }
  const second = { title: 'Two', url: 'https://example.com/2', severity: 'high' }
  const one = parseNpmAudit(report([first, second])).alerts
  const two = parseNpmAudit(report([second, first])).alerts
  assert.equal(one.length, 1)
  assert.equal(alertKey(one[0]), alertKey(two[0]))
  assert.deepEqual(one[0].advisories, [{ title: 'One', url: 'https://example.com/1' }, { title: 'Two', url: 'https://example.com/2' }])
})

test('priorityFor matches the name first', () => {
  const four = ['urgent', 'high', 'medium', 'low']
  assert.deepEqual(SEVERITIES.map((severity) => priorityFor(severity, four)), ['urgent', 'high', 'medium', 'low'])
  assert.deepEqual(SEVERITIES.map((severity) => priorityFor(severity, ['low', 'medium', 'high', 'urgent'])), ['urgent', 'high', 'medium', 'low'], 'an inverted list')
  assert.deepEqual(SEVERITIES.map((severity) => priorityFor(severity, ['urgent', 'high', 'medium', 'low', 'none'])), ['urgent', 'high', 'medium', 'low'], 'never none')
  assert.deepEqual(SEVERITIES.map((severity) => priorityFor(severity, ['critical', 'high', 'normal', 'low'])), ['critical', 'high', 'normal', 'low'])
  assert.equal(priorityFor('critical', ['urgent', 'critical', 'high']), 'urgent')
})

test('priorityFor uses the position when no name matches, clamps, and never returns none', () => {
  assert.deepEqual(SEVERITIES.map((severity) => priorityFor(severity, ['p1', 'p2', 'p3'])), ['p1', 'p2', 'p3', 'p3'])
  assert.deepEqual(SEVERITIES.map((severity) => priorityFor(severity, ['only'])), ['only', 'only', 'only', 'only'])
  assert.deepEqual(SEVERITIES.map((severity) => priorityFor(severity, ['a', 'b', 'c', 'd', 'e'])), ['a', 'b', 'c', 'e'])
  assert.deepEqual(SEVERITIES.map((severity) => priorityFor(severity, ['p1', 'p2', 'p3', 'none'])), ['p1', 'p2', 'p3', 'p3'])
  assert.equal(priorityFor('critical', []), null)
  assert.equal(priorityFor('critical', ['none']), null)
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
