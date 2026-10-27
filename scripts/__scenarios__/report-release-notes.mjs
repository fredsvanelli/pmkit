// Both entries start with the pr sync preview, which moves nothing on this fixture.
// /pmkit:report:release-notes 1.0.0 on a planned release: a draft with one done issue, saved after the user confirms.
// /pmkit:report:release-notes with no argument on a tracker with no release and no sprint: the default 14 days, and the user declines to save.
import assert from 'node:assert/strict'
import path from 'node:path'

const body = path.join(import.meta.dirname, '_inputs', 'release-notes.md')

export default [
  {
    command: 'report/release-notes',
    fixture: 'no-sprints',
    github: true,
    prompt: '/pmkit:report:release-notes 1.0.0',
    answers: ['Save'],
    steps: [
      { step: '1', dryRun: ['pr', 'sync'] },
      { step: '2', read: ['release-notes', '--release', '1.0.0'], save: 'notes' },
      { step: '7', read: ['capabilities'] },
      { step: '7', dryRun: ['docs', 'create', 'release-notes/1.0.0.md', '--body-file', body] },
      { confirm: 'Step 7' },
      { step: '7', write: ['docs', 'create', 'release-notes/1.0.0.md', '--body-file', body] },
    ],
    skip: {},
    notHit: { 'Step 1': 'no issue is in review with a branch, so the pr sync preview moves nothing and does not ask' },
    expect(repo, saved) {
      assert.equal(saved.notes.draft, true)
      assert.deepEqual(saved.notes.groups.flatMap((group) => group.issues.map((issue) => issue.id)), ['ISS-6R3N'])
      assert.equal(saved.notes.counts.excluded.open, 1)
      const added = repo.git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)
      assert.deepEqual(added.filter((file) => file.endsWith('release-notes/1.0.0.md')).length, 1, added.join('\n'))
      const file = added.find((name) => name.endsWith('release-notes/1.0.0.md'))
      assert.ok(file.startsWith('.issues/docs/'), file)
      assert.ok(repo.file(file).includes('ISS-6R3N'))
    },
  },
  {
    command: 'report/release-notes',
    fixture: 'no-sprints',
    github: true,
    prompt: '/pmkit:report:release-notes',
    answers: ['Do not save'],
    steps: [
      { step: '1', dryRun: ['pr', 'sync'] },
      { step: '2', read: ['release-notes'], save: 'notes' },
      { step: '7', read: ['capabilities'] },
      { step: '7', dryRun: ['docs', 'create', 'release-notes/2026-10-09_2026-10-23.md', '--body-file', body] },
      { confirm: 'Step 7' },
    ],
    skip: {},
    notHit: { 'Step 1': 'no issue is in review with a branch, so the pr sync preview moves nothing and does not ask' },
    expect(repo, saved) {
      assert.equal(saved.notes.basis, 'period')
      assert.equal(saved.notes.period.defaulted, true)
      assert.equal(saved.notes.reason, 'no_closed_sprint')
      assert.equal(repo.git('ls-files', '--others', '--exclude-standard'), '')
    },
  },
]
