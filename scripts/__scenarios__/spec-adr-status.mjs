// /pmkit:spec:adr-status on the team fixture, with two repository ADRs set up. ADR 0001 is superseded by 0002, so the
// preview shows no status before and the new line after, the user approves once, and the write leaves the file
// without a commit, as the command says.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const call = ['docs', 'adr-status', '1', 'superseded', '--by', '2']

export default {
  command: 'spec/adr-status',
  fixture: 'team',
  git: true,
  setup({ root }) {
    const dir = path.join(root, 'docs', 'adr')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '0001-keep-estimates-in-hours.md'), '# Keep estimates in hours\n\nThe team estimated in hours.\n')
    fs.writeFileSync(path.join(dir, '0002-keep-estimates-in-points.md'), '# Keep estimates in points\n\nVelocity uses points.\n')
  },
  prompt: '/pmkit:spec:adr-status 1 superseded --by 2',
  answers: ['Yes'],
  steps: [
    { step: '1', dryRun: call },
    { confirm: 'Step 2' },
    { step: '3', write: call },
  ],
  skip: {},
  notHit: {},
  expect(repo) {
    assert.match(repo.file('docs/adr/0001-keep-estimates-in-hours.md'), /^Status: superseded by docs\/adr\/0002-keep-estimates-in-points\.md$/m)
    assert.doesNotMatch(repo.file('docs/adr/0002-keep-estimates-in-points.md'), /Status:/)
  },
}
