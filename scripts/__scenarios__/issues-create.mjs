// /pmkit:issues:create with a vague idea. The search finds webhook issues and the epic, the user creates a new
// issue anyway, answers the questions on context and scope, and approves the refined ticket. --sprint puts the
// issue in a sprint, which always asks for confirmation. The CLI takes a sprint ID, not the word "current".
import assert from 'node:assert/strict'
import path from 'node:path'

const inputs = path.join(import.meta.dirname, '_inputs')
const args = ['issues', 'create', '--title', 'Show the delivery history of a webhook', '--type', 'feature', '--priority', 'medium',
  '--estimate', '3', '--parent', 'EPC-2M9D', '--sprint', '2026-10-12',
  '--description-file', path.join(inputs, 'webhook-history-description.md'), '--criteria-file', path.join(inputs, 'webhook-history-criteria.md')]

export default {
  command: 'issues/create',
  fixture: 'team',
  prompt: '/pmkit:issues:create show the delivery history of a webhook',
  answers: [
    'Create a new one anyway',
    'Support cannot tell a customer whether a webhook reached their endpoint, so they ask an engineer to search the logs',
    'The dashboard only, the last 30 days, no resending by hand',
    'Yes',
  ],
  steps: [
    { step: '1', read: ['discover'] },
    { step: '2', read: ['issues', 'list', '--text', 'webhook'] },
    { step: '2', read: ['epic', 'list'] },
    { confirm: 'Step 3' },
    { step: '6', dryRun: args },
    { confirm: 'Step 7' },
    { step: '6', write: args },
  ],
  skip: {},
  notHit: {},
  expect(repo) {
    const created = repo.issue('ISS-M0GZ')
    assert.equal(created.title, 'Show the delivery history of a webhook')
    assert.equal(created.sprint, '2026-10-12')
    assert.equal(created.parent, 'EPC-2M9D')
    assert.deepEqual([created.type, created.priority, created.estimate], ['feature', 'medium', 3])
    const body = repo.file('.issues/issues/ISS-M0GZ/issue.md')
    for (const heading of ['### Context', '### Scope (in)', '### Out of scope', '### Tasks']) assert.ok(body.includes(`\n${heading}\n`), heading)
    assert.equal(body.split('\n').filter((line) => line.startsWith('- [ ] ')).length, 6)
  },
}
