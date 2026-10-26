// /pmkit:report:status EPC-2M9D: the epic has no update yet, so the period is the default 14 days (since 2026-10-09).
// The draft comes from _inputs/status-update.md and is published with health on_track after the user approves.
import assert from 'node:assert/strict'
import path from 'node:path'

const body = path.join(import.meta.dirname, '_inputs', 'status-update.md')
const publish = ['epic', 'update-status', 'EPC-2M9D', '--health', 'on_track', '--body-file', body]

export default {
  command: 'report/status',
  fixture: 'team',
  github: true,
  prompt: '/pmkit:report:status EPC-2M9D',
  answers: ['Publish'],
  steps: [
    { step: '1', dryRun: ['pr', 'sync'] },
    { step: '2', read: ['epic', 'get', 'EPC-2M9D'] },
    { step: '2', read: ['epic', 'progress', 'EPC-2M9D'] },
    { step: '2', read: ['issues', 'list', '--parent', 'EPC-2M9D'] },
    { step: '3', read: ['epic', 'updates', 'EPC-2M9D'] },
    { step: '4', read: ['events', '--since', '2026-10-09'] },
    { step: '7', dryRun: publish },
    { confirm: 'Step 7' },
    { step: '7', write: publish },
  ],
  skip: {},
  notHit: { 'Step 1': 'no issue is in review with a branch, so the pr sync preview moves nothing and does not ask' },
  expect(repo) {
    const added = repo.git('ls-files', '--others', '--exclude-standard', '.issues/epics/EPC-2M9D/updates').split('\n').filter(Boolean)
    assert.equal(added.length, 1, added.join('\n'))
    assert.match(repo.file(added[0]), /health: on_track/)
    assert.ok(repo.file(added[0]).includes('The retry work is the only open risk.'))
  },
}
