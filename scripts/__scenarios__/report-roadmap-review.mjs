// /pmkit:report:roadmap-review on the team fixture, on 2026-10-23. The setup adds milestone beta, due 2026-10-20, and
// puts EPC-2M9D in it by editing the files, so no event is appended. EPC-2M9D started 2026-09-28 and has no status
// update, so it is due one; beta is 3 days late because its epic is open. ISS-3Q6T holds conflict markers, so the
// review is incomplete and the milestone issue counts are unknown.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

export default {
  command: 'report/roadmap-review',
  fixture: 'team',
  async setup({ root }) {
    fs.mkdirSync(path.join(root, '.issues/milestones'), { recursive: true })
    fs.writeFileSync(path.join(root, '.issues/milestones/beta.md'), '---\nname: Beta\ndue: 2026-10-20\n---\n\nBeta.\n')
    const epic = path.join(root, '.issues/epics/EPC-2M9D/epic.md')
    fs.writeFileSync(epic, fs.readFileSync(epic, 'utf8').replace('\ntarget: ', '\nmilestone: beta\ntarget: '))
  },
  prompt: '/pmkit:report:roadmap-review',
  answers: [],
  steps: [
    { step: '1', read: ['roadmap', 'review'], save: 'review' },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    const { review } = saved
    assert.deepEqual(repo.newEvents('EPC-2M9D'), [], 'a read-only command appends no event')
    const [epic] = review.epics
    assert.deepEqual([epic.id, epic.target, epic.milestone, epic.health, epic.delayDays, epic.reasons], ['EPC-2M9D', '2026-11-13', 'beta', null, 0, ['no_recent_update']])
    assert.deepEqual(review.milestones.map((m) => [m.id, m.due, m.epics, m.delayDays]), [['beta', '2026-10-20', ['EPC-2M9D'], 3]])
    assert.deepEqual(review.noRecentUpdates, ['EPC-2M9D'])
    assert.deepEqual(review.updatesNotChecked, [])
    assert.equal(review.incomplete, true)
  },
}
