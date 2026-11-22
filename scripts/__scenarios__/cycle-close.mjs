// /pmkit:cycle:close on the team fixture, with GitHub. Setup records the branch feat-dlq on ISS-8C4W (in review),
// and gh answers that its pull request #12 is merged, so step 1 previews, confirms and writes pr sync.
// The active sprint 2026-10-12 then has one done issue and three unfinished ones. No sprint is planned, so the
// user sends ISS-4M2S and ISS-5N1R back to the backlog and splits ISS-2X6D: a new issue under EPC-2M9D takes the
// remaining 3 points in the backlog, with a related link to ISS-2X6D, and ISS-2X6D moves to done with 5 points
// instead of 8 and stays in the closed sprint. The split gives the new issue the blocker ISS-5N1R, the sub-issue
// ISS-4M2S and the unchecked criterion of ISS-2X6D. Setup gives ISS-2X6D one checked and one unchecked criterion,
// because the fixture's ISS-2X6D has none.
// Step 6 reads ISS-0G5E, the issue outside the sprint that the related list of ISS-2X6D names. It is canceled and
// older than the sprint, so it is no half-done split. Setup also cancels an issue of the sprint, Drop the legacy export: step 3
// leaves it out of the unfinished issues, as cycle close does (PMK-165), so it gets no decision and keeps its sprint. Step 8 runs the moves and the split, closes the sprint last,
// then reads the sprint's issues again for the delivered numbers.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const merged = {
  number: 12, url: 'https://github.com/o/r/pull/12', title: 'Dead-letter queue for webhooks (ISS-8C4W)', state: 'MERGED',
  isDraft: false, headRefName: 'feat-dlq', author: { login: 'ana' }, mergedAt: '2026-10-22T15:00:00Z',
}
const retro = path.join(import.meta.dirname, '_inputs', 'retro.md')
const splitCriteria = path.join(import.meta.dirname, '_inputs', 'split-criteria.md')
const remainingCriteria = path.join(import.meta.dirname, '_inputs', 'remaining-criteria.md')
// PMK-160: the create marks the new issue with its origin, so a second run finds a half-done split even without its link.
const splitDescription = path.join(import.meta.dirname, '_inputs', 'split-description.md')
const titleFile = path.join(import.meta.dirname, '_inputs', 'title-finish-the-billing-export-to-csv.md')
const marked = ['issues', 'list', '--text', 'split when sprint 2026-10-12 closed']
const toBacklog = ['cycle', 'add', 'ISS-4M2S', 'ISS-5N1R', '--to', 'none']
// The split keeps the type, priority and labels of ISS-2X6D (feature, high, billing and backend), and carries its
// unchecked criterion.
const split = ['issues', 'create', '--title-file', path.join(import.meta.dirname, '_inputs', 'title-finish-the-billing-export-to-csv.md'), '--type', 'feature', '--estimate', '3', '--parent', 'EPC-2M9D', '--priority', 'high', '--label', 'billing,backend', '--criteria-file', remainingCriteria, '--description-file', splitDescription]
const shrink = ['issues', 'update', 'ISS-2X6D', '--estimate', '5']
const done = ['issues', 'move', 'ISS-2X6D', 'done']
const close = ['cycle', 'close', '2026-10-12']
const writeRetro = ['docs', 'create', 'retros/2026-10-12.md', '--body-file', retro]

const closeAndSplit = {
  command: 'cycle/close',
  fixture: 'team',
  github: true,
  gh: { [`pr view feat-dlq --json ${VIEW}`]: { stdout: JSON.stringify(merged) } },
  async setup({ pmkit }) {
    await pmkit(['issues', 'update', 'ISS-8C4W', '--branch', 'feat-dlq'])
    await pmkit(['issues', 'update', 'ISS-2X6D', '--criteria-file', splitCriteria])
    const dropped = await pmkit(['issues', 'create', '--title', 'Drop the legacy export', '--sprint', '2026-10-12'])
    await pmkit(['issues', 'move', dropped.after.id, 'canceled'])
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
    { step: '6', read: marked, save: 'marked' },
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
    assert.deepEqual(saved.marked.issues, [], 'no earlier split of this sprint carries the mark')
    assert.match(repo.file(`.issues/issues/${saved.remaining.after.id}/issue.md`), /^Remaining work of ISS-2X6D, split when sprint 2026-10-12 closed\.$/m, 'the create marks the new issue')
    const unfinished = saved.issues.filter((issue) => !['done', 'canceled'].includes(issue.status.category)).map((issue) => issue.id).sort()
    assert.deepEqual(unfinished, ['ISS-2X6D', 'ISS-4M2S', 'ISS-5N1R'])
    // The canceled issue gets no decision: no move names it, and it keeps its sprint and status through the close.
    const dropped = saved.issues.find((issue) => issue.title === 'Drop the legacy export')
    assert.equal(dropped.status.category, 'canceled')
    assert.ok(!toBacklog.includes(dropped.id), 'no cycle add names the canceled issue')
    assert.deepEqual([repo.issue(dropped.id).sprint, repo.issue(dropped.id).status], ['2026-10-12', 'canceled'])
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

// PMK-159: with an invalid .pmkit/config.yaml every write refuses, so close is a report only. Setup breaks
// write_policy.confirm. Step 1's sync dry run fails with INVALID_INPUT, steps 2 to 5 read, step 6 proposes nothing,
// and the report is shown without a question: nothing is written, and the sprint stays active.
const invalidConfig = {
  command: 'cycle/close',
  fixture: 'team',
  github: true,
  gh: { [`pr view feat-dlq --json ${VIEW}`]: { stdout: JSON.stringify(merged) } },
  async setup({ pmkit, root }) {
    await pmkit(['issues', 'update', 'ISS-8C4W', '--branch', 'feat-dlq'])
    const file = path.join(root, '.pmkit', 'config.yaml')
    const text = fs.readFileSync(file, 'utf8')
    assert.ok(text.includes('confirm: single_writes'))
    fs.writeFileSync(file, text.replace('confirm: single_writes', 'confirm: maybe'))
  },
  prompt: '/pmkit:cycle:close',
  answers: [],
  steps: [
    { step: '1', dryRun: ['pr', 'sync'], expectError: 'INVALID_INPUT' },
    { step: '2', read: ['cycle', 'current'], save: 'sprint' },
    { step: '3', read: ['cycle', 'issues', '2026-10-12'], save: 'issues' },
    { step: '4', read: ['events', '--since', '2026-10-12', '--until', '2026-10-25'] },
    { step: '5', read: ['metrics', 'cycle-time', '--since', '2026-10-12', '--until', '2026-10-25'] },
  ],
  skip: {
    '8 issues link': 'a write: with an invalid .pmkit/config.yaml close proposes no split (the first scenario runs it)',
    '8 issues parent': 'a write: with an invalid .pmkit/config.yaml close proposes no split (the first scenario runs it)',
  },
  notHit: {
    'Step 1': 'the sync dry run fails, so there is nothing to confirm',
    'Step 7': 'the report is shown without a question: every write would refuse',
    'Step 9': 'the retro is a write, so it waits for the file to be fixed',
  },
  expect(repo, saved) {
    assert.equal(saved.sprint.id, '2026-10-12')
    assert.equal(repo.sprint('2026-10-12').state, 'active', 'nothing closes the sprint')
    assert.equal(repo.issue('ISS-8C4W').status, 'in_review', 'pr sync did not run')
    assert.ok(saved.issues.length > 0, 'the report still reads the sprint')
  },
}

// PMK-160: a second run finishes a split a failed step 8 left half done. Setup leaves the worst case: the estimate update
// of ISS-2X6D ran (8 to 5) and the create ran with its mark, but no link, no blocker link, no sub-issue move and no move
// to done. Step 6 finds the new issue by its mark, the user says it is the remaining work and gives 5, the current
// estimate, so step 8 runs the related link, the blocker link, the sub-issue move and the move to done: no second create
// and no estimate update. The git host is none, so the sync answers NOT_SUPPORTED and the close goes on without PR data.
const allToBacklog = ['cycle', 'add', 'ISS-4M2S', 'ISS-5N1R', 'ISS-8C4W', '--to', 'none']
const finishHalfDoneSplit = {
  command: 'cycle/close',
  fixture: 'team',
  async setup({ pmkit }) {
    await pmkit(['issues', 'update', 'ISS-2X6D', '--estimate', '5'])
    await pmkit(['issues', 'create', '--title-file', titleFile, '--type', 'feature', '--estimate', '3', '--parent', 'EPC-2M9D', '--priority', 'high', '--label', 'billing,backend', '--description-file', splitDescription])
  },
  prompt: '/pmkit:cycle:close',
  answers: ['Yes, it is the remaining work of ISS-2X6D', 'Finish the split of ISS-2X6D with 5 delivered, move ISS-4M2S, ISS-5N1R and ISS-8C4W to the backlog', 'Yes'],
  steps: [
    { step: '1', dryRun: ['pr', 'sync'], expectError: 'NOT_SUPPORTED' },
    { step: '2', read: ['cycle', 'current'] },
    { step: '3', read: ['cycle', 'issues', '2026-10-12'], save: 'issues' },
    { step: '4', read: ['events', '--since', '2026-10-12', '--until', '2026-10-25'] },
    { step: '5', read: ['metrics', 'cycle-time', '--since', '2026-10-12', '--until', '2026-10-25'] },
    { step: '6', read: ['cycle', 'list', '--state', 'planned'] },
    { step: '6', read: marked, save: 'marked' },
    { step: '6', read: ['issues', 'get', 'ISS-0G5E'] },
    { confirm: 'Step 7' },
    { step: '7', dryRun: allToBacklog },
    { step: '7', dryRun: done },
    { step: '7', dryRun: close },
    { confirm: 'Step 7' },
    { step: '7', write: allToBacklog },
    { step: '8', write: ({ marked: found }) => ['issues', 'link', found.issues[0].id, 'ISS-2X6D', '--kind', 'related'] },
    { step: '8', write: ({ marked: found }) => ['issues', 'link', 'ISS-5N1R', found.issues[0].id, '--kind', 'blocks'] },
    { step: '8', write: ({ marked: found }) => ['issues', 'parent', 'ISS-4M2S', found.issues[0].id] },
    { step: '8', write: done },
    { step: '8', write: close },
    { step: '8', read: ['cycle', 'issues', '2026-10-12'], save: 'after' },
  ],
  skip: {},
  notHit: {
    'Step 1': 'the git host is none, so the sync answers NOT_SUPPORTED and has nothing to confirm',
    'Step 9': 'this scenario ends at the close; the first scenario covers the retro',
  },
  expect(repo, saved) {
    assert.equal(saved.marked.issues.length, 1, 'the mark finds the one remaining-work issue')
    const remaining = saved.marked.issues[0]
    assert.ok(!saved.issues.find((issue) => issue.id === 'ISS-2X6D').related.includes(remaining.id), 'the link had not run')
    const original = repo.issue('ISS-2X6D')
    assert.deepEqual([original.estimate, original.status, original.sprint], [5, 'done', '2026-10-12'])
    assert.ok(original.related.includes(remaining.id), 'the rerun ran the related link')
    const after = repo.issue(remaining.id)
    assert.deepEqual([after.estimate, after.sprint, after.blocked_by], [3, undefined, ['ISS-5N1R']])
    assert.ok(after.related.includes('ISS-2X6D'))
    assert.equal(repo.issue('ISS-4M2S').parent, remaining.id, 'the open sub-issue moves to the remaining work')
    assert.equal(repo.sprint('2026-10-12').state, 'closed')
  },
}

// PMK-161: nested splits in one close. ISS-2X6D (8 to 5) is split, and so are its open blocker ISS-5N1R (3 to 1) and its open
// sub-issue ISS-4M2S (setup raises it to 2, then 2 to 1). Step 8 runs every create first, then the links: the new issue of
// ISS-5N1R blocks the new issue of ISS-2X6D, and the new issue of ISS-4M2S moves under it, while ISS-4M2S, done, stays under
// ISS-2X6D. Remaining work points to remaining work. The git host is none, so the sync answers NOT_SUPPORTED.
const input = (name) => path.join(import.meta.dirname, '_inputs', name)
const createA = ['issues', 'create', '--title-file', titleFile, '--type', 'feature', '--estimate', '3', '--parent', 'EPC-2M9D', '--priority', 'high', '--label', 'billing,backend', '--description-file', splitDescription]
const createB = ['issues', 'create', '--title-file', input('title-finish-paginating-the-events-api.md'), '--type', 'task', '--estimate', '2', '--priority', 'medium', '--label', 'backend', '--description-file', input('split-description-ISS-5N1R.md')]
const createS = ['issues', 'create', '--title-file', input('title-finish-fixing-the-csv-column-order.md'), '--type', 'task', '--estimate', '1', '--parent', 'ISS-2X6D', '--priority', 'medium', '--label', 'billing', '--description-file', input('split-description-ISS-4M2S.md')]
const shrinkB = ['issues', 'update', 'ISS-5N1R', '--estimate', '1']
const shrinkS = ['issues', 'update', 'ISS-4M2S', '--estimate', '1']
const doneB = ['issues', 'move', 'ISS-5N1R', 'done']
const doneS = ['issues', 'move', 'ISS-4M2S', 'done']
const reviewBack = ['cycle', 'add', 'ISS-8C4W', '--to', 'none']
const nestedSplits = {
  command: 'cycle/close',
  fixture: 'team',
  async setup({ pmkit }) {
    await pmkit(['issues', 'update', 'ISS-4M2S', '--estimate', '2'])
  },
  prompt: '/pmkit:cycle:close',
  answers: ['Split ISS-2X6D with 5 delivered, ISS-5N1R with 1 and ISS-4M2S with 1, move ISS-8C4W to the backlog', 'Yes'],
  steps: [
    { step: '1', dryRun: ['pr', 'sync'], expectError: 'NOT_SUPPORTED' },
    { step: '2', read: ['cycle', 'current'] },
    { step: '3', read: ['cycle', 'issues', '2026-10-12'] },
    { step: '4', read: ['events', '--since', '2026-10-12', '--until', '2026-10-25'] },
    { step: '5', read: ['metrics', 'cycle-time', '--since', '2026-10-12', '--until', '2026-10-25'] },
    { step: '6', read: ['cycle', 'list', '--state', 'planned'] },
    { step: '6', read: marked },
    { step: '6', read: ['issues', 'get', 'ISS-0G5E'] },
    { confirm: 'Step 7' },
    { step: '7', dryRun: reviewBack },
    { step: '7', dryRun: createA },
    { step: '7', dryRun: createB },
    { step: '7', dryRun: createS },
    { step: '7', dryRun: shrink },
    { step: '7', dryRun: shrinkB },
    { step: '7', dryRun: shrinkS },
    { step: '7', dryRun: done },
    { step: '7', dryRun: doneB },
    { step: '7', dryRun: doneS },
    { step: '7', dryRun: close },
    { confirm: 'Step 7' },
    { step: '7', write: reviewBack },
    // Every create first, so the links can name any new issue of this close.
    { step: '7', write: createA, save: 'a' },
    { step: '7', write: createB, save: 'b' },
    { step: '7', write: createS, save: 's' },
    { step: '8', write: ({ a }) => ['issues', 'link', a.after.id, 'ISS-2X6D', '--kind', 'related'] },
    { step: '8', write: ({ b }) => ['issues', 'link', b.after.id, 'ISS-5N1R', '--kind', 'related'] },
    { step: '8', write: ({ s }) => ['issues', 'link', s.after.id, 'ISS-4M2S', '--kind', 'related'] },
    // The blocker of ISS-2X6D is split too, so its new issue blocks the new issue of ISS-2X6D.
    { step: '8', write: ({ a, b }) => ['issues', 'link', b.after.id, a.after.id, '--kind', 'blocks'] },
    // The sub-issue of ISS-2X6D is split too: ISS-4M2S stays under ISS-2X6D, and its new issue moves under the new one.
    { step: '8', write: ({ a, s }) => ['issues', 'parent', s.after.id, a.after.id] },
    { step: '7', write: shrink },
    { step: '7', write: shrinkB },
    { step: '7', write: shrinkS },
    { step: '8', write: done },
    { step: '8', write: doneB },
    { step: '8', write: doneS },
    { step: '8', write: close },
    { step: '8', read: ['cycle', 'issues', '2026-10-12'] },
  ],
  skip: {},
  notHit: {
    'Step 1': 'the git host is none, so the sync answers NOT_SUPPORTED and has nothing to confirm',
    'Step 9': 'this scenario ends at the close; the first scenario covers the retro',
  },
  expect(repo, saved) {
    const [a, b, s] = [saved.a.after.id, saved.b.after.id, saved.s.after.id]
    assert.deepEqual(repo.issue(a).blocked_by, [b], 'the new issue of ISS-2X6D is blocked by the remaining work of its blocker, not by the done ISS-5N1R')
    assert.equal(repo.issue(s).parent, a, 'the remaining work of the sub-issue sits under the remaining work')
    assert.equal(repo.issue('ISS-4M2S').parent, 'ISS-2X6D', 'the delivered sub-issue stays under the delivered original')
    for (const [id, estimate] of [['ISS-2X6D', 5], ['ISS-5N1R', 1], ['ISS-4M2S', 1]]) {
      assert.deepEqual([repo.issue(id).status, repo.issue(id).estimate], ['done', estimate], id)
    }
    assert.deepEqual(repo.issue('ISS-2X6D').blocked_by, ['ISS-5N1R'], 'the original keeps its blocker')
    for (const [made, from] of [[a, 'ISS-2X6D'], [b, 'ISS-5N1R'], [s, 'ISS-4M2S']]) assert.ok(repo.issue(made).related.includes(from), `${made} is related to ${from}`)
    assert.equal(repo.sprint('2026-10-12').state, 'closed')
  },
}

export default [closeAndSplit, invalidConfig, finishHalfDoneSplit, nestedSplits]
