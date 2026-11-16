// /pmkit:issues:log-time ISS-5N1R 1h30 on the Local tracker, and on a Linear team with no time tracking.
// 1. The Local tracker. The time_tracking capability is native, so the command previews and writes the entry, reads the
//    total from time-entries, and the comment of step 6 does not run. The CLI reads "1h30" as 90 minutes, so the entry and
//    the total are 90.
// 2. ACME-2 on Linear. time_tracking is absent (PMK-227), so step 1 takes the comment path: step 4 and step 5 are skipped,
//    the CLI never logs time, step 6 reads the time with parse-time (90 minutes), previews the comment, asks once and posts
//    it. The fake Linear API answers every read; nothing reaches the real API.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fakeLinearIssues } from '../fake-linear-api.mjs'

const inputs = path.join(import.meta.dirname, '_inputs')
// The fake Linear API of the Linear entry, set when its routes are built, so that expect can read the posted comments.
const fake = {}
const log = ['issues', 'log-time', 'ISS-5N1R', '1h30']
const comment = ['issues', 'comment', 'ACME-2', '--body-file', path.join(inputs, 'log-time-comment.md')]

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

const local = {
  command: 'issues/log-time',
  fixture: 'team',
  prompt: '/pmkit:issues:log-time ISS-5N1R 1h30',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['capabilities'] },
    { step: '2', read: ['issues', 'get', 'ISS-5N1R'] },
    { step: '4', dryRun: log },
    { confirm: 'Step 5' },
    { step: '5', write: log },
    { step: '5', read: ['issues', 'time-entries', 'ISS-5N1R'] },
  ],
  skip: {
    '6 issues parse-time': 'the Local tracker has time tracking, so the command does not read the time for a comment',
    '6 issues comment': 'the Local tracker has time tracking, so the command logs the entry and does not comment it',
  },
  notHit: {
    'Step 6': 'the Local tracker has time tracking, so the command does not suggest a comment',
    'Step 3': 'the time is given in the prompt, so step 3 does not ask for it',
  },
  expect(repo) {
    const entries = repo.newEvents('ISS-5N1R').filter((event) => event.op === 'log_time')
    assert.equal(entries.length, 1)
    assert.equal(entries[0].minutes, 90)
  },
}

const linear = {
  command: 'issues/log-time',
  fixture: 'team',
  git: true,
  linear: {
    routes: () => {
      const issues = fakeLinearIssues()
      issues.seed({ title: 'Export the invoice list as JSON', description: 'JSON export of the invoice list.', stateId: 'state-8' })
      issues.seed({ title: 'Export the invoice list as CSV', description: 'CSV export of the invoice list.' })
      fake.issues = issues
      return issues.routes
    },
  },
  setup: ({ root }) => fs.writeFileSync(path.join(root, '.pmkit', 'config.yaml'), LINEAR_CONFIG),
  prompt: '/pmkit:issues:log-time ACME-2 1h30',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['capabilities'], save: 'capabilities' },
    { step: '2', read: ['issues', 'get', 'ACME-2'] },
    { step: '6', read: ['issues', 'parse-time', '1h30'], save: 'parsed' },
    { step: '6', dryRun: comment },
    { confirm: 'Step 6' },
    { step: '6', write: comment },
  ],
  skip: {
    '4 issues log-time': 'the tracker has no time tracking, so the CLI refuses log-time and the command takes the comment path',
    '5 issues log-time': 'the tracker has no time tracking, so no entry is written',
    '5 issues time-entries': 'the tracker has no time tracking, so there is no total to read',
  },
  notHit: {
    'Step 5': 'the tracker has no time tracking, so step 5 does not write an entry',
    'Step 3': 'the time is given in the prompt, so step 3 does not ask for it',
  },
  expect(repo, saved) {
    assert.equal(saved.capabilities.capabilities.find((capability) => capability.id === 'time_tracking').path, 'absent')
    assert.equal(saved.parsed.minutes, 90)
    // The comment is read back from the fake Linear API after the write: one comment on ACME-2 with the time in it.
    const issue = fake.issues.records.find((record) => record.identifier === 'ACME-2')
    const comments = fake.issues.comments.filter((item) => item.issueId === issue.id)
    assert.equal(comments.length, 1, 'one comment is posted on ACME-2')
    assert.match(comments[0].body, /^Time worked: 90 minutes \(1h30\)\.$/m)
  },
}

export default [local, linear]
