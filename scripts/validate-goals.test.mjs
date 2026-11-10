import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { validateRepo } from './lib/validate.mjs'
import { makeRepo } from './test-helpers.mjs'

const brief = (result, part) => result.problems.map(({ path: file, code }) => `${code} ${file}`).filter((line) => line.includes(part)).sort()

function writeGoal(root, name, text) {
  const dir = path.join(root, '.issues', 'goals')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), text)
}

test('a goal file that breaks the id rule, has no title or has a bad target is a goal problem', () => {
  const root = makeRepo('team')
  writeGoal(root, 'GOAL-1.md', '---\ntitle: Good\ntarget: 2026-12-31\n---\n')
  writeGoal(root, 'bad.md', '---\ntitle: Misnamed\n---\n')
  writeGoal(root, 'GOAL-2.md', '---\ntarget: 2026-12-31\n---\n')
  writeGoal(root, 'GOAL-3.md', '---\ntitle: Late\ntarget: soon\n---\n')
  writeGoal(root, 'notes.txt', 'not a goal\n')
  const result = validateRepo(root)
  assert.deepEqual(brief(result, '/goals/'), ['goal .issues/goals/GOAL-2.md', 'goal .issues/goals/GOAL-3.md', 'goal .issues/goals/bad.md'])
  assert.match(result.problems.find((p) => p.path.endsWith('bad.md')).message, /not named after a goal id such as GOAL-1/)
  assert.match(result.problems.find((p) => p.path.endsWith('GOAL-2.md')).message, /needs a title/)
  assert.match(result.problems.find((p) => p.path.endsWith('GOAL-3.md')).message, /target "soon"/)
})

test('a goal file with conflict markers is one conflict problem and no goal problem', () => {
  const root = makeRepo('team')
  writeGoal(root, 'GOAL-1.md', '---\n<<<<<<< HEAD\ntitle: A\n=======\ntitle: B\n>>>>>>> other\n---\n')
  assert.deepEqual(brief(validateRepo(root), '/goals/'), ['conflict .issues/goals/GOAL-1.md'])
})

test('an epic whose goal has no file is a reference problem', () => {
  const root = makeRepo('team')
  const file = path.join(root, '.issues', 'epics', 'EPC-2M9D', 'epic.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('target: 2026-11-13\n', 'target: 2026-11-13\ngoal: GOAL-9\n'))
  const result = validateRepo(root)
  assert.deepEqual(brief(result, '/epics/'), ['reference .issues/epics/EPC-2M9D/epic.md'])
  assert.equal(result.problems.find((p) => p.path.endsWith('epic.md')).message, 'goal GOAL-9 does not exist')
  writeGoal(root, 'GOAL-9.md', '---\ntitle: Now it exists\n---\n')
  assert.deepEqual(brief(validateRepo(root), '/epics/'), [])
})

function linkEpic(root, goal) {
  const file = path.join(root, '.issues', 'epics', 'EPC-2M9D', 'epic.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('target: 2026-11-13\n', `target: 2026-11-13\ngoal: ${goal}\n`))
}
const epicMessages = (root) => validateRepo(root).problems.filter((p) => p.path.endsWith('EPC-2M9D/epic.md')).map((p) => `${p.code}: ${p.message}`)

test('an epic whose goal is not a goal id is a reference problem even when goals/<value>.md exists (PMK-179)', () => {
  const root = makeRepo('team')
  writeGoal(root, 'notes.md', '---\ntitle: Notes\n---\n')
  linkEpic(root, 'notes')
  assert.deepEqual(epicMessages(root), ['reference: goal notes is not a valid goal id such as GOAL-1'])
})

test('an epic whose goal id is not in the stored form is not a goal id (PMK-179)', () => {
  const root = makeRepo('team')
  writeGoal(root, 'GOAL-1.md', '---\ntitle: One\n---\n')
  linkEpic(root, 'goal-1')
  assert.deepEqual(epicMessages(root), ['reference: goal goal-1 is not a valid goal id such as GOAL-1'])
})

test('an epic whose goal file does not parse is a reference problem next to the goal problem (PMK-179)', () => {
  const root = makeRepo('team')
  writeGoal(root, 'GOAL-1.md', '---\ntarget: 2026-12-31\n---\n')
  linkEpic(root, 'GOAL-1')
  assert.deepEqual(epicMessages(root), ['reference: goal GOAL-1 does not parse, see .issues/goals/GOAL-1.md'])
  assert.deepEqual(brief(validateRepo(root), '/goals/'), ['goal .issues/goals/GOAL-1.md'])
})

test('an epic linked to a goal that parses has no problem (PMK-179)', () => {
  const root = makeRepo('team')
  writeGoal(root, 'GOAL-1.md', '---\ntitle: One\n---\n')
  linkEpic(root, 'GOAL-1')
  assert.deepEqual(epicMessages(root), [])
})

test('validate counts the goal files in checked, readable or not (PMK-213)', () => {
  const root = makeRepo('team')
  assert.equal(validateRepo(root).checked.goals, 0)
  writeGoal(root, 'GOAL-1.md', '---\ntitle: Good\n---\n')
  writeGoal(root, 'GOAL-2.md', '---\ntarget: soon\n---\n')
  writeGoal(root, 'notes.txt', 'not a goal\n')
  assert.equal(validateRepo(root).checked.goals, 2)
})

test('a goal with a status outside the list is a goal problem (PMK-213)', () => {
  const root = makeRepo('team')
  writeGoal(root, 'GOAL-1.md', '---\ntitle: Good\nstatus: done\n---\n')
  assert.match(validateRepo(root).problems.find((p) => p.path.endsWith('GOAL-1.md')).message, /status "done"/)
})
