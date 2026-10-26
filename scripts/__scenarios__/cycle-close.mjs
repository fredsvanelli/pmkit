// /pmkit:cycle:close on the team fixture, with GitHub. Setup records the branch feat-dlq on ISS-8C4W (in review),
// and gh answers that its pull request #12 is merged, so step 1 previews, confirms and writes pr sync.
// The active sprint 2026-10-12 then has one done issue and three unfinished ones. No sprint is planned, so the
// user sends ISS-4M2S and ISS-5N1R back to the backlog and splits ISS-2X6D: a new issue under EPC-2M9D takes the
// remaining 3 points in the backlog, and ISS-2X6D stays in the closed sprint with 5 points instead of 8.
// Step 8 closes the sprint first, then runs the moves and the split.
import assert from 'node:assert/strict'
import path from 'node:path'

const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const merged = {
  number: 12, url: 'https://github.com/o/r/pull/12', title: 'Dead-letter queue for webhooks (ISS-8C4W)', state: 'MERGED',
  isDraft: false, headRefName: 'feat-dlq', author: { login: 'ana' }, mergedAt: '2026-10-22T15:00:00Z',
}
const retro = path.join(import.meta.dirname, '_inputs', 'retro.md')
const toBacklog = ['cycle', 'add', 'ISS-4M2S', 'ISS-5N1R', '--to', 'none']
// The split keeps the type, priority and labels of ISS-2X6D (feature, high, billing and backend).
const split = ['issues', 'create', '--title', 'Finish the billing export to CSV', '--type', 'feature', '--estimate', '3', '--parent', 'EPC-2M9D', '--priority', 'high', '--label', 'billing,backend']
const shrink = ['issues', 'update', 'ISS-2X6D', '--estimate', '5']
const close = ['cycle', 'close', '2026-10-12']
const writeRetro = ['docs', 'create', 'retros/2026-10-12.md', '--body-file', retro]

export default {
  command: 'cycle/close',
  fixture: 'team',
  github: true,
  gh: { [`pr view feat-dlq --json ${VIEW}`]: { stdout: JSON.stringify(merged) } },
  async setup({ pmkit }) {
    await pmkit(['issues', 'update', 'ISS-8C4W', '--branch', 'feat-dlq'])
  },
  prompt: '/pmkit:cycle:close',
  answers: ['Yes', 'Split ISS-2X6D, move ISS-4M2S and ISS-5N1R to the backlog', 'Yes', 'Yes'],
  steps: [
    // Step 1: sync the merged pull requests, after a preview.
    { step: '1', dryRun: ['pr', 'sync'], save: 'syncPreview' },
    { confirm: 'Step 1' },
    { step: '1', write: ['pr', 'sync'] },
    // Steps 2 to 6: read the sprint, its issues, the events, the cycle time and the planned sprints.
    { step: '2', read: ['cycle', 'current'], save: 'sprint' },
    { step: '3', read: ['cycle', 'issues', '2026-10-12'], save: 'issues' },
    { step: '4', read: ['events', '--since', '2026-10-12', '--until', '2026-10-25'] },
    { step: '5', read: ['metrics', 'cycle-time', '--since', '2026-10-12', '--until', '2026-10-25'] },
    { step: '6', read: ['cycle', 'list', '--state', 'planned'], save: 'planned' },
    // Step 7: the decision per unfinished issue, the dry runs, then one approval for the whole preview.
    { confirm: 'Step 7' },
    { step: '7', dryRun: toBacklog },
    { step: '7', dryRun: split },
    { step: '7', dryRun: shrink },
    { step: '7', dryRun: close },
    { confirm: 'Step 7' },
    // Step 8: close the sprint, then the same moves and the split without --dry-run.
    { step: '8', write: close },
    { step: '7', write: toBacklog },
    { step: '7', write: split, save: 'remaining' },
    { step: '7', write: shrink },
    // Step 9: the retro document.
    { step: '9', dryRun: writeRetro },
    { confirm: 'Step 9' },
    { step: '9', write: writeRetro },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    assert.equal(repo.sprint('2026-10-12').state, 'closed')
    assert.equal(repo.issue('ISS-8C4W').status, 'done')
    for (const id of ['ISS-4M2S', 'ISS-5N1R']) assert.equal(repo.issue(id).sprint, undefined, `${id} is back in the backlog`)
    assert.deepEqual(saved.syncPreview.moved, [{ id: 'ISS-8C4W', pr: 12 }])
    assert.equal(saved.sprint.id, '2026-10-12')
    assert.deepEqual(saved.planned, [], 'no planned sprint, so the moves go to the backlog')
    const unfinished = saved.issues.filter((issue) => issue.status.category !== 'done').map((issue) => issue.id).sort()
    assert.deepEqual(unfinished, ['ISS-2X6D', 'ISS-4M2S', 'ISS-5N1R'])
    const original = repo.issue('ISS-2X6D')
    assert.equal(original.estimate, 5)
    assert.equal(original.sprint, '2026-10-12', 'the original stays in the closed sprint')
    const remaining = repo.issue(saved.remaining.after.id)
    assert.equal(remaining.estimate, 3)
    assert.equal(remaining.parent, 'EPC-2M9D')
    assert.equal(remaining.sprint, undefined, 'the new issue goes to the backlog')
    for (const field of ['type', 'priority']) assert.equal(remaining[field], original[field], `the split keeps the ${field}`)
    assert.deepEqual(remaining.labels, original.labels, 'the split keeps the labels')
    assert.match(repo.file('.issues/docs/retros/2026-10-12.md'), /Delivered 1 of 3 planned issues/)
  },
}
