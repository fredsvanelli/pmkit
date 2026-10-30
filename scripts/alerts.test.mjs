import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SEVERITIES, parseNpmAudit } from './lib/alerts.mjs'

const audit = (vulnerabilities) => JSON.stringify({ auditReportVersion: 2, vulnerabilities })

test('SEVERITIES lists the four levels, highest first', () => {
  assert.deepEqual(SEVERITIES, ['critical', 'high', 'medium', 'low'])
})

test('npm moderate maps to medium and info to low', () => {
  const { alerts, warnings } = parseNpmAudit(audit({
    a: { name: 'a', severity: 'moderate', via: [], fixAvailable: true },
    b: { name: 'b', severity: 'info', via: [], fixAvailable: false },
    c: { name: 'c', severity: 'critical', via: [], fixAvailable: false },
    d: { name: 'd', severity: 'high', via: [], fixAvailable: false },
  }))
  assert.deepEqual(Object.fromEntries(alerts.map((a) => [a.package, a.severity])), { a: 'medium', b: 'low', c: 'critical', d: 'high' })
  assert.deepEqual(warnings, [])
})

test('an unknown severity maps to low and adds a warning', () => {
  const { alerts, warnings } = parseNpmAudit(audit({ a: { name: 'a', severity: 'weird', via: [] } }))
  assert.equal(alerts[0].severity, 'low')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /a.*weird/)
})

test('the title and url come from the first advisory in via', () => {
  const { alerts } = parseNpmAudit(audit({
    lodash: { name: 'lodash', severity: 'high', fixAvailable: { name: 'lodash', version: '4.17.21' }, via: ['x', { source: 1, title: 'Prototype Pollution', url: 'https://example.com/advisories/1' }] },
  }))
  assert.deepEqual(alerts, [{
    id: 'npm-audit:lodash', scanner: 'npm-audit', package: 'lodash', title: 'Prototype Pollution', severity: 'high',
    url: 'https://example.com/advisories/1', fixAvailable: true,
  }])
})

test('a via with only package names gives the fallback title and no url', () => {
  const { alerts } = parseNpmAudit(audit({ a: { name: 'a', severity: 'low', via: ['b', 'c'], fixAvailable: false } }))
  assert.equal(alerts[0].title, 'vulnerable through b, c')
  assert.equal(alerts[0].url, null)
  assert.equal(alerts[0].fixAvailable, false)
})

test('invalid JSON, empty output and a missing vulnerabilities object throw', () => {
  assert.throws(() => parseNpmAudit('not json'), /not valid JSON/)
  assert.throws(() => parseNpmAudit('{}'), /vulnerabilities/)
  assert.throws(() => parseNpmAudit(''), /empty/)
})
