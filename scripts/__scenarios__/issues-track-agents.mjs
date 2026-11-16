// /pmkit:issues:track-agents on the team fixture with no git host. ISS-5N1R is delegated to agent:claude and ISS-2X6D is
// assigned to agent:codex with no delegation comment. The CLI lists both, with no pull request state and a note that says why.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

export default {
  command: 'issues/track-agents',
  fixture: 'team',
  async setup({ root, pmkit }) {
    const file = path.join(root, '.issues', 'config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^members:\n/m, 'members:\n  agent:claude: { name: Claude, availability: 1 }\n  agent:codex: { name: Codex, availability: 1 }\n'))
    const body = path.join(import.meta.dirname, '_inputs', 'track-agents-delegation.md')
    await pmkit(['issues', 'assign', 'ISS-5N1R', 'agent:claude'])
    await pmkit(['issues', 'comment', 'ISS-5N1R', '--body-file', body])
    await pmkit(['issues', 'assign', 'ISS-2X6D', 'agent:codex'])
  },
  prompt: '/pmkit:issues:track-agents',
  answers: [],
  steps: [{ step: '1', read: ['issues', 'track-agents'], save: 'tracked' }],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    assert.deepEqual(saved.tracked.issues.map((row) => [row.id, row.assignee, row.delegation.state, row.pr]), [
      ['ISS-2X6D', 'agent:codex', 'none', null],
      ['ISS-5N1R', 'agent:claude', 'current', null],
    ])
    assert.ok(saved.tracked.notes.some((note) => note.includes('git_host is none')))
  },
}
