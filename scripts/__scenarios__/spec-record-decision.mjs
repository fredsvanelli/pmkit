// /pmkit:spec:record-decision on the team fixture, which has no docs/adr/ folder and a Local tracker, so the ADR is a
// tracker document. The prompt carries the context and the consequence, so the command has nothing to ask.
//   entry 0: no ADR yet, so the number is 0001. It affects two issues, so the two comments are a bulk change: the
//            previews come first and the user approves them once.
//   entry 1: the tracker folder already holds 0002 and a README with no number, so the number is 0003. One issue,
//            so the comment is a single write.
// Neither expect reads `saved`, so a live run checks the whole of both.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const inputs = path.join(import.meta.dirname, '_inputs')
const decision = 'We keep estimates in points, not hours. Context: two members argued about the precision of hours in the last sprint planning, and velocity already uses points. Consequence: time logged on an issue stays separate from its estimate. Rejected: estimating in hours.'
const nextAdr = ['docs', 'next-adr', '--title', 'Keep estimates in points']

const added = (repo) => repo.git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)

export default [
  {
    command: 'spec/record-decision',
    fixture: 'team',
    git: true,
    prompt: `/pmkit:spec:record-decision ${decision} --issues ISS-5N1R,ISS-4P8A`,
    answers: ['Yes', 'Yes'],
    steps: [
      { step: '2', read: ['issues', 'get', 'ISS-5N1R'] },
      { step: '2', read: ['issues', 'get', 'ISS-4P8A'] },
      { step: '3', read: nextAdr },
      { step: '5', read: nextAdr },
      { step: '5', dryRun: ['docs', 'create', 'adr/0001-keep-estimates-in-points.md', '--body-file', path.join(inputs, 'adr.md')] },
      { confirm: 'Step 5' },
      { step: '5', write: ['docs', 'create', 'adr/0001-keep-estimates-in-points.md', '--body-file', path.join(inputs, 'adr.md')] },
      { step: '6', dryRun: ['issues', 'comment', 'ISS-5N1R', '--body-file', path.join(inputs, 'adr-comment.md')] },
      { step: '6', dryRun: ['issues', 'comment', 'ISS-4P8A', '--body-file', path.join(inputs, 'adr-comment.md')] },
      { confirm: 'Step 6' },
      { step: '6', write: ['issues', 'comment', 'ISS-5N1R', '--body-file', path.join(inputs, 'adr-comment.md')] },
      { step: '6', write: ['issues', 'comment', 'ISS-4P8A', '--body-file', path.join(inputs, 'adr-comment.md')] },
    ],
    skip: {},
    notHit: {},
    expect(repo) {
      const file = added(repo).find((name) => name.endsWith('adr/0001-keep-estimates-in-points.md'))
      assert.equal(file, '.issues/docs/adr/0001-keep-estimates-in-points.md')
      assert.match(repo.file(file), /ISS-5N1R/)
      for (const id of ['ISS-5N1R', 'ISS-4P8A']) {
        assert.equal(repo.newEvents(id).filter((event) => event.op === 'comment').length, 1, `${id} got one comment`)
      }
    },
  },
  {
    command: 'spec/record-decision',
    fixture: 'team',
    git: true,
    setup({ root }) {
      const dir = path.join(root, '.issues', 'docs', 'adr')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, '0002-existing.md'), '# Existing\n')
      fs.writeFileSync(path.join(dir, 'README.md'), '# ADRs\n')
    },
    prompt: `/pmkit:spec:record-decision ${decision} --issues ISS-5N1R`,
    answers: ['Yes', 'Yes'],
    steps: [
      { step: '2', read: ['issues', 'get', 'ISS-5N1R'] },
      { step: '3', read: nextAdr },
      { step: '5', read: nextAdr },
      { step: '5', dryRun: ['docs', 'create', 'adr/0003-keep-estimates-in-points.md', '--body-file', path.join(inputs, 'adr-0003.md')] },
      { confirm: 'Step 5' },
      { step: '5', write: ['docs', 'create', 'adr/0003-keep-estimates-in-points.md', '--body-file', path.join(inputs, 'adr-0003.md')] },
      { step: '6', dryRun: ['issues', 'comment', 'ISS-5N1R', '--body-file', path.join(inputs, 'adr-comment-0003.md')] },
      { confirm: 'Step 6' },
      { step: '6', write: ['issues', 'comment', 'ISS-5N1R', '--body-file', path.join(inputs, 'adr-comment-0003.md')] },
    ],
    skip: {},
    notHit: {},
    expect(repo) {
      const files = added(repo).filter((name) => name.includes('docs/adr/'))
      assert.ok(files.includes('.issues/docs/adr/0003-keep-estimates-in-points.md'), files.join('\n'))
      assert.ok(!files.some((name) => name.includes('0001-')), 'a gap or a README does not restart the numbers')
      assert.equal(repo.newEvents('ISS-5N1R').filter((event) => event.op === 'comment').length, 1)
    },
  },
]
