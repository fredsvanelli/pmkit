// /pmkit:spec:record-decision on the team fixture, which has no docs/adr/ folder and a Local tracker, so the ADR is a
// tracker document at adr/0001-keep-estimates-in-points.md. It affects two issues, so the two comments are a bulk change:
// the previews come first and the user approves them once.
import assert from 'node:assert/strict'
import path from 'node:path'

const inputs = path.join(import.meta.dirname, '_inputs')
const adr = path.join(inputs, 'adr.md')
const comment = path.join(inputs, 'adr-comment.md')
const docPath = 'adr/0001-keep-estimates-in-points.md'

export default {
  command: 'spec/record-decision',
  fixture: 'team',
  git: true,
  prompt: '/pmkit:spec:record-decision We keep estimates in points, not hours. --issues ISS-5N1R,ISS-4P8A',
  answers: ['Yes', 'Yes'],
  steps: [
    { step: '2', read: ['issues', 'get', 'ISS-5N1R'] },
    { step: '2', read: ['issues', 'get', 'ISS-4P8A'] },
    { step: '3', read: ['capabilities'] },
    { step: '4', read: ['docs', 'list'], save: 'docs' },
    { step: '6', dryRun: ['docs', 'create', docPath, '--body-file', adr] },
    { confirm: 'Step 6' },
    { step: '6', write: ['docs', 'create', docPath, '--body-file', adr] },
    { step: '7', dryRun: ['issues', 'comment', 'ISS-5N1R', '--body-file', comment] },
    { step: '7', dryRun: ['issues', 'comment', 'ISS-4P8A', '--body-file', comment] },
    { confirm: 'Step 7' },
    { step: '7', write: ['issues', 'comment', 'ISS-5N1R', '--body-file', comment] },
    { step: '7', write: ['issues', 'comment', 'ISS-4P8A', '--body-file', comment] },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    assert.deepEqual(saved.docs, [], 'the fixture has no ADR, so the number is 0001')
    const added = repo.git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)
    const file = added.find((name) => name.endsWith(docPath))
    assert.equal(file, `.issues/docs/${docPath}`)
    assert.match(repo.file(file), /ISS-5N1R/)
    for (const id of ['ISS-5N1R', 'ISS-4P8A']) {
      assert.equal(repo.newEvents(id).filter((event) => event.op === 'comment').length, 1, `${id} got one comment`)
    }
  },
}
