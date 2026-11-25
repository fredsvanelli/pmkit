import assert from 'node:assert/strict'
import { test } from 'node:test'
import { jiraDate, ofBoard, readBoardSprints, sprintKey, sprintOf, toSprint } from './sprints.mjs'

const closed = (id, completeDate) => ({ id, state: 'closed', completeDate, boardId: 1 })
const active42 = { id: 42, state: 'active', boardId: 1 }

test('toSprint maps a closed Jira sprint', () => {
  const sprint = { id: 42, name: 'S1', state: 'closed', startDate: '2026-11-02T12:00:00.000Z', endDate: '2026-11-15T12:00:00.000Z', completeDate: '2026-11-15T17:00:00.000+0000', goal: 'Ship' }
  assert.deepEqual(toSprint(sprint), { id: '42', name: 'S1', start: '2026-11-02', end: '2026-11-15', goal: 'Ship', state: 'closed', closed: '2026-11-15T17:00:00.000Z', capacity: {}, daysOff: {} })
})

test('toSprint reads an undated future sprint as planned with null dates', () => {
  const sprint = toSprint({ id: 7, name: 'Undated', state: 'future' })
  assert.equal(sprint.start, null)
  assert.equal(sprint.end, null)
  assert.equal(sprint.goal, '')
  assert.equal(sprint.state, 'planned')
  assert.equal('closed' in sprint, false)
})

test('toSprint carries the local entry', () => {
  const sprint = toSprint({ id: 7, name: 'S', state: 'active' }, { capacity: { a: 3 }, daysOff: { a: ['2026-11-03'] }, capacityBase: { a: 5 } })
  assert.deepEqual([sprint.capacity, sprint.daysOff, sprint.capacityBase], [{ a: 3 }, { a: ['2026-11-03'] }, { a: 5 }])
})

test('sprintOf follows ADR 0016', () => {
  assert.equal(sprintOf([closed(41, '2026-11-01T00:00:00.000Z'), active42], 'in_progress', 1), '42')
  assert.equal(sprintOf([closed(41, '2026-11-01T00:00:00.000Z')], 'in_progress', 1), undefined)
  assert.equal(sprintOf([closed(40, '2026-10-01T00:00:00.000Z'), closed(41, '2026-11-01T00:00:00.000Z')], 'done', 1), '41')
  assert.equal(sprintOf([{ ...active42, boardId: 9 }], 'todo', 1), undefined)
  assert.equal(sprintOf(null, 'todo', 1), undefined)
  assert.equal(sprintOf([{ id: 5, state: 'future' }, active42], 'todo', 1), '42')
})

test('sprintKey accepts positive whole numbers only', () => {
  assert.equal(sprintKey('42'), 42)
  assert.equal(sprintKey('0'), null)
  assert.equal(sprintKey('2026-11-02'), null)
})

test('jiraDate is noon UTC', () => {
  assert.equal(jiraDate('2026-11-02'), '2026-11-02T12:00:00.000Z')
})

test('ofBoard keeps the board sprints and those without an origin', () => {
  assert.deepEqual(ofBoard([{ id: 1, originBoardId: 1 }, { id: 2, originBoardId: 9 }, { id: 3 }], 1).map((s) => s.id), [1, 3])
})

test('readBoardSprints paginates the board and filters by origin', async () => {
  const calls = []
  const client = { paginate: async (path, options) => (calls.push([path, options]), { items: [{ id: 1, originBoardId: 3 }, { id: 2, originBoardId: 4 }], hasMore: false }) }
  assert.deepEqual(await readBoardSprints(client, 3), [{ id: 1, originBoardId: 3 }])
  assert.equal(calls[0][0], '/rest/agile/1.0/board/3/sprint')
  assert.deepEqual(calls[0][1].query, { state: 'future,active,closed' })
})
