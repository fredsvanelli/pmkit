// /pmkit:backlog:groom on the team fixture. stale_days is 60, so the cutoff is 2026-08-24 and no issue is stale.
// The team fixture has no issue whose title is close to ISS-1V9Z (Investigate slow login), so setup files one,
// ISS-M0GZ, that reports the same symptom. The user accepts three fixes: an estimate of 2 on ISS-6J0B, the epic
// EPC-2M9D as parent of ISS-3F7H, and ISS-1V9Z as a duplicate of ISS-M0GZ, which also moves it to canceled.
import assert from 'node:assert/strict'

const estimate = ['issues', 'update', 'ISS-6J0B', '--estimate', '2']
const parent = ['issues', 'parent', 'ISS-3F7H', 'EPC-2M9D']
const duplicate = ['issues', 'link', 'ISS-1V9Z', 'ISS-M0GZ', '--kind', 'duplicate']
const cancel = ['issues', 'move', 'ISS-1V9Z', 'canceled']
const scan = (suffix) => [
  { step: '2', read: ['issues', 'list', '--category', 'backlog,todo,triage'], save: `backlog${suffix}` },
  { step: '3', read: ['events', '--since', '2026-08-24'] },
  { step: '4', read: ['validate'] },
]

export default {
  command: 'backlog/groom',
  fixture: 'team',
  async setup({ pmkit }) {
    await pmkit(['issues', 'create', '--title', 'Login takes ten seconds after submit', '--type', 'bug', '--description-file', '-'], {
      stdin: 'Users wait about ten seconds after they submit the login form.\n',
    })
  },
  prompt: '/pmkit:backlog:groom',
  answers: ['The estimate on ISS-6J0B, the parent of ISS-3F7H and the duplicate ISS-1V9Z', 'Yes'],
  steps: [
    // Steps 2 to 4: the scan.
    ...scan('Before'),
    // Step 6: the user picks the three fixes.
    { confirm: 'Step 6' },
    // Step 7: a dry run of every accepted fix.
    { step: '7', dryRun: estimate },
    { step: '7', dryRun: parent },
    { step: '7', dryRun: duplicate },
    { step: '7', dryRun: cancel },
    // Steps 8 and 9: one approval for the whole preview, then the same commands without --dry-run.
    { confirm: 'Step 8' },
    { step: '7', write: estimate },
    { step: '7', write: parent },
    { step: '7', write: duplicate },
    { step: '7', write: cancel },
    // Step 10: steps 2 to 4 again, to compare the counts.
    ...scan('After'),
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    assert.equal(repo.issue('ISS-3F7H').parent, 'EPC-2M9D')
    assert.equal(repo.issue('ISS-1V9Z').status, 'canceled')
    assert.deepEqual(repo.issue('ISS-1V9Z').duplicate_of, ['ISS-M0GZ'])
    const links = ['ISS-1V9Z', 'ISS-M0GZ'].flatMap((id) => repo.newEvents(id)).filter((event) => event.op === 'link')
    assert.equal(links.length, 1)
    const ids = (list) => list.issues.map((issue) => issue.id).sort()
    assert.deepEqual(ids(saved.backlogBefore), ['ISS-1V9Z', 'ISS-3F7H', 'ISS-4M2S', 'ISS-6J0B', 'ISS-M0GZ'])
    assert.deepEqual(ids(saved.backlogAfter), ['ISS-3F7H', 'ISS-4M2S', 'ISS-6J0B', 'ISS-M0GZ'], 'the canceled duplicate leaves the backlog')
    assert.equal(repo.issue('ISS-6J0B').estimate, 2)
  },
}
