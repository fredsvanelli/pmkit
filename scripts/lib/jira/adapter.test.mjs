import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../config.mjs'
import { adapterFor } from '../adapters.mjs'
import { makeRepo } from '../../test-helpers.mjs'
import { jiraConfigProblems, jiraDescriptor } from './adapter.mjs'

const pmkit = (scope) => ({ version: 1, tracker: { system: 'jira', scope } })

test('a Jira config needs a site host and a space key', () => {
  assert.deepEqual(jiraConfigProblems(pmkit({ site: 'acme.atlassian.net', space: 'ENG' })), [])
  assert.deepEqual(jiraConfigProblems(pmkit({ site: 'Acme.Atlassian.net', space: 'ENG_2' })), [])
  assert.deepEqual(jiraConfigProblems(pmkit(undefined)), ['tracker.scope.site is required for jira', 'tracker.scope.space is required for jira'])
  assert.deepEqual(jiraConfigProblems(pmkit({ site: 'https://acme.atlassian.net', space: 'eng' })), [
    'tracker.scope.site must be a host such as acme.atlassian.net',
    'tracker.scope.space must be a space key such as ENG',
  ])
})

test('the Jira descriptor is hosted and registered', () => {
  const descriptor = jiraDescriptor()
  assert.equal(descriptor.system, 'jira')
  assert.equal(descriptor.hosted, true)
  assert.equal(descriptor.settings({}).epicPrefix, null)
  assert.equal(adapterFor('jira').system, 'jira')
})

test('loadConfig lists a missing space for a Jira config', () => {
  const root = makeRepo('basic')
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^ {2}system: local$/m, '  system: jira\n  scope:\n    site: acme.atlassian.net'))
  assert.deepEqual(loadConfig(root).pmkitProblems, ['tracker.scope.space is required for jira'])
})
