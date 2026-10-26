// /pmkit:cycle:close on the team fixture, with GitHub. Setup records the branch feat-dlq on ISS-8C4W (in review),
// and gh answers that its pull request #12 is merged, so step 1 previews, confirms and writes pr sync.
// The active sprint 2026-10-12 then has one done issue and three unfinished ones. No sprint is planned, so the
// user sends ISS-4M2S and ISS-5N1R back to the backlog and splits ISS-2X6D: a new issue under EPC-2M9D takes the
// remaining 3 points in the backlog, with a related link to ISS-2X6D, and ISS-2X6D moves to done with 5 points
// instead of 8 and stays in the closed sprint. The split gives the new issue the blocker ISS-5N1R, the sub-issue
// ISS-4M2S and the unchecked criterion of ISS-2X6D. Setup gives ISS-2X6D one checked and one unchecked criterion,
// because the fixture's ISS-2X6D has none.
// Step 6 reads ISS-0G5E, the issue outside the sprint that the related list of ISS-2X6D names. It is canceled and
// older than the sprint, so it is no half-done split. Step 8 runs the moves and the split, closes the sprint last,
// then reads the sprint's issues again for the delivered numbers.
import assert from 'node:assert/strict'
import path from 'node:path'

const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const merged = {
  number: 12, url: 'https://github.com/o/r/pull/12', title: 'Dead-letter queue for webhooks (ISS-8C4W)', state: 'MERGED',
  isDraft: false, headRefName: 'feat-dlq', author: { login: 'ana' }, mergedAt: '2026-10-22T15:00:00Z',
}
const retro = path.join(import.meta.dirname, '_inputs', 'retro.md')
const splitCriteria = path.join(import.meta.dirname, '_inputs', 'split-criteria.md')
const remainingCriteria = path.join(import.meta.dirname, '_inputs', 'remaining-criteria.md')
const toBacklog = ['cycle', 'add', 'ISS-4M2S', 'ISS-5N1R', '--to', 'none']
// The split keeps the type, priority and labels of ISS-2X6D (feature, high, billing and backend), and carries its
// unchecked criterion.
const split = ['issues', 'create', '--title', 'Finish the billing export to CSV', '--type', 'feature', '--estimate', '3', '--parent', 'EPC-2M9D', '--priority', 'high', '--label', 'billing,backend', '--criteria-file', remainingCriteria]
const shrink = ['issues', 'update', 'ISS-2X6D', '--estimate', '5']
const done = ['issues', 'move', 'ISS-2X6D', 'done']
const close = ['cycle', 'close', '2026-10-12']
const writeRetro = ['docs', 'create', 'retros/2026-10-12.md', '--body-file', retro]

export default {
  command: 'cycle/close',
  fixture: 'team',
  github: true,
  gh: { [`pr view feat-dlq --json ${VIEW}`]: { stdout: JSON.stringify(merged) } },
  async setup({ pmkit }) {
    await pmkit(['issues', 'update', 'ISS-8C4W', '--branch', 'feat-dlq'])
    await pmkit(['issues', 'update', 'ISS-2X6D', '--criteria-file', splitCriteria])
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
    { step: '6', read: ['issues', 'get', 'ISS-0G5E'], save: 'related' },
    // Step 7: the decision per unfinished issue, the dry runs, then one approval for the whole preview.
    { confirm: 'Step 7' },
    { step: '7', dryRun: toBacklog },
    { step: '7', dryRun: split },
    { step: '7', dryRun: shrink },
    { step: '7', dryRun: done },
    { step: '7', dryRun: close },
    { confirm: 'Step 7' },
    // Step 8: the same moves and the split without --dry-run (create, related link, blocker link, sub-issue move,
    // estimate, move), then the close.
    { step: '7', write: toBacklog },
    { step: '7', write: split, save: 'remaining' },
    { step: '8', write: ({ remaining }) => ['issues', 'link', remaining.after.id, 'ISS-2X6D', '--kind', 'related'] },
    { step: '8', write: ({ remaining }) => ['issues', 'link', 'ISS-5N1R', remaining.after.id, '--kind', 'blocks'] },
    { step: '8', write: ({ remaining }) => ['issues', 'parent', 'ISS-4M2S', remaining.after.id] },
    { step: '7', write: shrink },
    { step: '8', write: done },
    { step: '8', write: close },
    // Step 8 reads the sprint's issues again, after the writes, for the delivered numbers.
    { step: '8', read: ['cycle', 'issues', '2026-10-12'], save: 'after' },
    // Step 9: the retro document.
    { step: '9', dryRun: writeRetro },
    { confirm: 'Step 9' },
    { step: '9', write: writeRetro },
  ],
  skip: { '7 issues get': 'ISS-5N1R and ISS-4M2S, the blocker and the sub-issue of ISS-2X6D, are in the sprint, so the step 3 read gives their status' },
  notHit: {},
  expect(repo, saved) {
    assert.equal(repo.sprint('2026-10-12').state, 'closed')
    assert.equal(repo.issue('ISS-8C4W').status, 'done')
    for (const id of ['ISS-4M2S', 'ISS-5N1R']) assert.equal(repo.issue(id).sprint, undefined, `${id} is back in the backlog`)
    assert.deepEqual(saved.syncPreview.moved, [{ id: 'ISS-8C4W', pr: 12 }])
    assert.equal(saved.sprint.id, '2026-10-12')
    assert.deepEqual(saved.planned, [], 'no planned sprint, so the moves go to the backlog')
    assert.equal(saved.related.status.category, 'canceled', 'the related issue outside the sprint is no half-done split')
    const unfinished = saved.issues.filter((issue) => issue.status.category !== 'done').map((issue) => issue.id).sort()
    assert.deepEqual(unfinished, ['ISS-2X6D', 'ISS-4M2S', 'ISS-5N1R'])
    const original = repo.issue('ISS-2X6D')
    assert.equal(original.estimate, 5)
    assert.equal(original.status, 'done', 'the split moves the original to done')
    assert.equal(original.sprint, '2026-10-12', 'the original stays in the closed sprint as the delivered part')
    const remaining = repo.issue(saved.remaining.after.id)
    assert.equal(remaining.estimate, 3)
    assert.equal(remaining.parent, 'EPC-2M9D')
    // The two facts plan's step 5 query reads: a status in todo or backlog, and no sprint.
    assert.equal(remaining.status, 'backlog')
    assert.equal(remaining.sprint, undefined, 'the new issue goes to the backlog')
    for (const field of ['type', 'priority']) assert.equal(remaining[field], original[field], `the split keeps the ${field}`)
    assert.deepEqual(remaining.labels, original.labels, 'the split keeps the labels')
    assert.ok(original.related.includes(saved.remaining.after.id), 'the original links to the new issue')
    assert.ok(remaining.related.includes('ISS-2X6D'), 'the new issue links to the original')
    // The carry-over: the open blocker is copied, the open sub-issue moves, and the unchecked criterion is copied.
    assert.deepEqual(remaining.blocked_by, ['ISS-5N1R'], 'the new issue is blocked by the original\'s open blocker')
    assert.equal(repo.issue('ISS-4M2S').parent, saved.remaining.after.id, 'the open sub-issue moves to the new issue')
    const remainingFile = repo.file(`.issues/issues/${saved.remaining.after.id}/issue.md`)
    assert.match(remainingFile, /## Acceptance criteria\n\n- \[ \] Totals row at the bottom\n?$/m)
    assert.doesNotMatch(remainingFile, /\[x\]/, 'the new issue takes only the unchecked criterion')
    assert.deepEqual(original.blocked_by, ['ISS-5N1R'], 'the original keeps its blocker')
    const originalFile = repo.file('.issues/issues/ISS-2X6D/issue.md')
    assert.match(originalFile, /^- \[x\] Export invoices for a date range$/m, 'the original keeps its checked criterion')
    assert.match(originalFile, /^- \[ \] Totals row at the bottom$/m, 'the original keeps its unchecked criterion')
    // Criterion 1: no issue stays open in the closed sprint.
    const open = saved.after.filter((issue) => !['done', 'canceled'].includes(issue.status.category)).map((issue) => issue.id)
    assert.deepEqual(open, [], 'every issue left in the closed sprint is done or canceled')
    const delivered = saved.after.filter((issue) => issue.status.category === 'done')
    assert.deepEqual(delivered.map((issue) => issue.id).sort(), ['ISS-2X6D', 'ISS-8C4W'])
    assert.equal(delivered.find((issue) => issue.id === 'ISS-2X6D').estimate, 5)
    assert.equal(delivered.reduce((sum, issue) => sum + issue.estimate, 0), 10)
    assert.match(repo.file('.issues/docs/retros/2026-10-12.md'), /Delivered 2 of 3 planned issues, 10 of 16 points/)
  },
}
