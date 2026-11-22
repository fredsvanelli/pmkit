// /pmkit:issues:move on the team fixture.
//   entry 0: ISS-2X6D done. ISS-2X6D has a child, ISS-4M2S (todo), and a blocker, ISS-5N1R (in progress),
//            so step 2 reads both and the warning lists them. The user approves the move anyway.
//   entry 1: EPC-2M9D done, the epic path (PMK-355). `issues get` does not find the ID, `epic get` does, and the
//            epic move is previewed, confirmed once and run. The epic is in progress, and done has one status.
// Each entry covers the other's path: rules 6 and 7 are checked per command file, so neither lists the other's calls.
import assert from 'node:assert/strict'

const EPIC_MOVE = ['epic', 'move', 'EPC-2M9D', 'done']

export default [
  {
    command: 'issues/move',
    fixture: 'team',
    prompt: '/pmkit:issues:move ISS-2X6D done',
    answers: ['Yes'],
    steps: [
      { step: '1', read: ['issues', 'get', 'ISS-2X6D'] },
      { step: '2', read: ['issues', 'get', 'ISS-4M2S'] },
      { step: '2', read: ['issues', 'get', 'ISS-5N1R'] },
      { step: '4', dryRun: ['issues', 'move', 'ISS-2X6D', 'done'] },
      { confirm: 'Step 5' },
      { step: '4', write: ['issues', 'move', 'ISS-2X6D', 'done'] },
    ],
    skip: {
      '3 discover': 'done has one status in the team fixture, so step 3 does not ask',
    },
    notHit: {},
    expect(repo) {
      assert.equal(repo.issue('ISS-2X6D').status, 'done')
      assert.equal(repo.newEvents('ISS-2X6D').filter((event) => event.op === 'move').length, 1)
    },
  },
  {
    command: 'issues/move',
    fixture: 'team',
    prompt: '/pmkit:issues:move EPC-2M9D done',
    answers: ['Yes'],
    steps: [
      { step: '1', read: ['issues', 'get', 'EPC-2M9D'], expectError: 'NOT_FOUND' },
      { step: '1', read: ['epic', 'get', 'EPC-2M9D'] },
      { step: 'Epic path 1', dryRun: EPIC_MOVE },
      { confirm: 'Epic path, step 2' },
      { step: 'Epic path 1', write: EPIC_MOVE },
    ],
    skip: {},
    notHit: {},
    expect(repo) {
      assert.match(repo.file('.issues/epics/EPC-2M9D/epic.md'), /^status: done$/m)
      const events = repo.file('.issues/epics/EPC-2M9D/events.jsonl').trim().split('\n').map((line) => JSON.parse(line))
      assert.equal(events.filter((event) => event.op === 'move').length, 1)
    },
  },
]
