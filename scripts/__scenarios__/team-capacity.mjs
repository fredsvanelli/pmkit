// /pmkit:team:capacity on the team fixture, on 2026-10-23. Setup removes ISS-3Q6T, the issue with conflict markers, so the
// load read is complete and the preview can show its effect. In the active sprint 2026-10-12 ana holds 13 points against a
// capacity of 10 (over average and over capacity) and fred holds 4 against 8. The user raises ana to 14 and fred to 9 and gives
// fred one day off. That touches two members, so the preview is full and the question is asked. The change leaves ana
// over the average but no longer over capacity. The second read shows the new numbers.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const change = ['--set', 'ana=14,fred=9', '--days-off', 'fred=2026-10-14']

export default {
  command: 'team/capacity',
  fixture: 'team',
  prompt: '/pmkit:team:capacity',
  answers: ['Capacity ana=14 and fred=9, and one day off for fred on 2026-10-14', 'Yes'],
  setup({ root }) {
    fs.rmSync(path.join(root, '.issues/issues/ISS-3Q6T'), { recursive: true })
  },
  steps: [
    { step: '1', read: ['team', 'capacity'], save: 'before' },
    { step: '4', dryRun: ['team', 'capacity', ...change], save: 'preview' },
    { confirm: 'Step 5' },
    { step: '6', write: ['team', 'capacity', ...change] },
    { step: '7', read: ['team', 'capacity'], save: 'after' },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    const row = (report, member) => report.members.find((item) => item.member === member)
    assert.deepEqual(row(saved.before, 'ana').flags, ['over_average', 'over_capacity'])
    assert.deepEqual(saved.preview.changes.map((item) => item.member), ['ana', 'fred'])
    assert.deepEqual(saved.preview.load.after.flags.ana, ['over_average'], 'ana is no longer over capacity after the change')
    const sprint = repo.sprint('2026-10-12')
    assert.deepEqual(sprint.capacity, { fred: 9, ana: 14 })
    assert.deepEqual(sprint.days_off, { ana: ['2026-10-16'], fred: ['2026-10-14'] })
    assert.deepEqual([row(saved.after, 'ana').capacity, row(saved.after, 'fred').capacity, row(saved.after, 'fred').workingDays], [14, 9, 9])
  },
}
