// /pmkit:issues:estimate, two entries.
// 1. ISS-4M2S on the Local tracker. The estimation capability is native, so step 7 saves the estimate and step 8, the
//    comment of a tracker with no estimate field, does not run. ISS-4M2S is in todo with an estimate of 1. `issues similar`
//    ranks the completed issue ISS-9T2M ("Fix rounding in invoice totals", 2) first, and the scenario proposes 2. The team
//    fixture has a file with conflict markers (ISS-3Q6T), so the read is incomplete and the step says the list is not verified.
//    The issue is not done or canceled, so step 2 does not ask.
// 2. ACME-2 on Linear with the team's estimates off (PMK-216): `estimation` is not native, so step 7 is skipped, no
//    `issues update --estimate` runs and step 8 posts the estimate as a comment, in ideal days.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fakeLinearIssues } from '../fake-linear-api.mjs'

const LINEAR_CONFIG = `version: 1
tracker:
  system: linear
  scope:
    workspace: acme
    team: ACME
git_host:
  system: none
write_policy:
  confirm: single_writes
  preview: [bulk, delete, publish_update, move_scope]
mappings:
  status:
    in_review: In Review
    blocked: none
  types:
    feature: Feature
    bug: Bug
`
const body = path.join(import.meta.dirname, '_inputs', 'estimate-comment.md')

const update = ['issues', 'update', 'ISS-4M2S', '--estimate', '2']

const local = {
  command: 'issues/estimate',
  fixture: 'team',
  prompt: '/pmkit:issues:estimate ISS-4M2S',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['capabilities'] },
    { step: '2', read: ['issues', 'get', 'ISS-4M2S'] },
    { step: '3', read: ['discover'] },
    { step: '5', read: ['issues', 'similar', 'ISS-4M2S'] },
    { step: '7.1', dryRun: update },
    { confirm: 'Step 7' },
    { step: '7.3', write: update },
  ],
  skip: {
    '8 issues comment': 'the Local tracker has an estimate field, so the command saves the estimate and does not comment it',
  },
  notHit: {
    'Step 8': 'the Local tracker has an estimate field, so the command does not comment the estimate',
    'Step 2': 'ISS-4M2S is in todo, so step 2 does not ask whether to estimate a finished issue',
  },
  expect(repo) {
    assert.equal(repo.issue('ISS-4M2S').estimate, 2)
    assert.equal(repo.newEvents('ISS-4M2S').filter((event) => event.op === 'update' && event.field === 'estimate').length, 1)
  },
}

const comment = ['issues', 'comment', 'ACME-2', '--body-file', body]

const linear = {
  command: 'issues/estimate',
  fixture: 'team',
  git: true,
  linear: {
    routes: () => {
      const issues = fakeLinearIssues()
      issues.seed({ title: 'Export the invoice list as JSON', description: 'JSON export of the invoice list.', stateId: 'state-8' })
      issues.seed({ title: 'Export the invoice list as CSV', description: 'CSV export of the invoice list.' })
      return issues.routes
    },
  },
  setup: ({ root }) => fs.writeFileSync(path.join(root, '.pmkit', 'config.yaml'), LINEAR_CONFIG),
  prompt: '/pmkit:issues:estimate ACME-2',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['capabilities'], save: 'capabilities' },
    { step: '2', read: ['issues', 'get', 'ACME-2'] },
    { step: '3', read: ['discover'] },
    { step: '5', read: ['issues', 'similar', 'ACME-2'], save: 'similar' },
    { step: '8', dryRun: comment },
    { confirm: 'Step 8' },
    { step: '8', write: comment },
  ],
  skip: {
    '7.1 issues update': 'estimation is not native on this team, so step 7 is skipped and no estimate is saved',
    '7.3 issues update': 'estimation is not native on this team, so step 7 is skipped and no estimate is saved',
  },
  notHit: {
    'Step 7': 'the tracker has no estimate field for the team, so the command comments the estimate',
    'Step 2': 'ACME-2 is not done or canceled, so step 2 does not ask whether to estimate a finished issue',
  },
  expect(repo, saved) {
    assert.notEqual(saved.capabilities.capabilities.find((capability) => capability.id === 'estimation').path, 'native')
    assert.equal(saved.similar.complete, true)
    assert.deepEqual(saved.similar.unestimated.map((hit) => hit.id), ['ACME-1'], 'ACME-1 has no estimate, so it is listed apart')
  },
}

export default [local, linear]
