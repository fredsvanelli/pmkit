// /pmkit:issues:delegate ISS-5N1R claude on the team fixture, with agent:claude added to the members by setup.
// ISS-5N1R is fred's, in progress, with no acceptance criteria, which is the one readiness problem of step 3.
// "claude" matches one agent member, so step 2 asks nothing. At step 7 the user runs the agent later.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const input = (file) => path.join(import.meta.dirname, '_inputs', file)
const delegate = ['issues', 'delegate', 'ISS-5N1R', 'agent:claude', '--instructions-file', input('delegate-instructions.md')]

export default {
  command: 'issues/delegate',
  fixture: 'team',
  setup({ root }) {
    const file = path.join(root, '.issues', 'config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^members:\n/m, 'members:\n  agent:claude: { name: Claude, availability: 1 }\n'))
  },
  prompt: '/pmkit:issues:delegate ISS-5N1R claude make the events export use the new cursor',
  answers: ['Yes', 'Yes', 'Later'],
  steps: [
    { step: '1', read: ['capabilities'] },
    { step: '2', read: ['discover'] },
    { step: '3', read: ['issues', 'get', 'ISS-5N1R', '--comments'] },
    // ISS-5N1R has no acceptance criteria, and the user continues.
    { confirm: 'Step 3' },
    { step: '5', dryRun: delegate },
    { confirm: 'Step 5' },
    { step: '6', write: delegate },
    // The user runs the agent later, so the command shows the steps and makes no other call.
    { confirm: 'Step 7' },
  ],
  skip: {},
  notHit: { 'Step 2': '"claude" matches one agent member exactly' },
  expect(repo) {
    assert.equal(repo.issue('ISS-5N1R').assignee, 'agent:claude')
    const events = repo.newEvents('ISS-5N1R')
    assert.deepEqual(events.map((event) => event.op), ['assign', 'comment'])
    const comment = repo.file(`.issues/issues/ISS-5N1R/comments/${events[1].to}`)
    assert.match(comment, /Delegated to agent:claude by fred, to run locally\./)
    assert.match(comment, /Do not change the public shape of the events response\./)
  },
}
