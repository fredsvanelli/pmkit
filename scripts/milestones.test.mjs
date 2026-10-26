import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMilestone, serializeMilestone, sortMilestones, validMilestoneId } from './lib/local/milestones.mjs'

const code = (expected) => (error) => {
  assert.equal(error.code, expected)
  assert.equal(error.nextStep, '/pmkit:local:doctor')
  return true
}

test('validMilestoneId accepts letters, digits, dots, underscores and dashes between a letter or digit at each end', () => {
  for (const id of ['local-gaps', 'phase-2-commands', 'v1.0', 'M1', 'a', 'x_y']) assert.equal(validMilestoneId(id), true, id)
  for (const id of ['Q4 2026', 'v1.', '-a', '', '.a', 'a/b', 'a\nb', undefined, 12]) assert.equal(validMilestoneId(id), false, String(id))
})

test('parseMilestone reads name, due and the body as description', () => {
  const text = '---\nname: Local tracker gaps\ndue: 2026-11-30\n---\n\nClose the gaps.\n'
  assert.deepEqual(parseMilestone(text, 'local-gaps'), {
    id: 'local-gaps', name: 'Local tracker gaps', due: '2026-11-30', description: 'Close the gaps.',
  })
})

test('parseMilestone without name uses the id, and without due leaves it out', () => {
  assert.deepEqual(parseMilestone('---\nowner: fred\n---\n', 'M1'), { id: 'M1', name: 'M1', description: '' })
})

test('parseMilestone ignores extra frontmatter keys', () => {
  const milestone = parseMilestone('---\nname: One\ncolor: red\nid: other\n---\n', 'M1')
  assert.deepEqual(milestone, { id: 'M1', name: 'One', description: '' })
})

test('parseMilestone refuses a bad due date', () => {
  assert.throws(() => parseMilestone('---\nname: One\ndue: 2026-13-40\n---\n', 'M1'), code('INVALID_INPUT'))
})

// The YAML reader yields no line break inside a value, so a name split by a lone carriage return fails to parse.
test('parseMilestone refuses a name with a line break', () => {
  assert.throws(() => parseMilestone('---\nname: One\rTwo\n---\n', 'M1'), code('INVALID_INPUT'))
})

test('parseMilestone refuses text without frontmatter', () => {
  assert.throws(() => parseMilestone('name: One\n', 'M1'), code('INVALID_INPUT'))
})

test('parseMilestone refuses git conflict markers', () => {
  const text = '---\n<<<<<<< HEAD\nname: One\n=======\nname: Two\n>>>>>>> branch\n---\n'
  assert.throws(() => parseMilestone(text, 'M1'), code('CONFLICT'))
})

test('serializeMilestone writes name and due as frontmatter with no body', () => {
  assert.equal(serializeMilestone({ name: 'Local tracker gaps', due: '2026-11-30' }), '---\nname: Local tracker gaps\ndue: 2026-11-30\n---\n')
  assert.equal(serializeMilestone({ name: 'M1' }), '---\nname: M1\n---\n')
})

test('serializeMilestone output reads back with parseMilestone', () => {
  for (const name of ['1.0', 'true', 'a: b', 'v1.0']) {
    assert.equal(parseMilestone(serializeMilestone({ name }), 'x').name, name)
  }
})

test('sortMilestones orders by due, then id, with no due last', () => {
  const list = [
    { id: 'z', name: 'z', description: '' },
    { id: 'b', name: 'b', due: '2026-12-01', description: '' },
    { id: 'a', name: 'a', due: '2026-12-01', description: '' },
    { id: 'c', name: 'c', due: '2026-11-01', description: '' },
    { id: 'y', name: 'y', description: '' },
  ]
  assert.deepEqual(sortMilestones(list).map((m) => m.id), ['c', 'a', 'b', 'y', 'z'])
  assert.deepEqual(list.map((m) => m.id), ['z', 'b', 'a', 'c', 'y'], 'the input list is not changed')
})
