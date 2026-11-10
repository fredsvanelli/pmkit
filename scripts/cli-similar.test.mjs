// `issues similar` (PMK-216): the text-similarity read that /pmkit:issues:estimate uses instead of --text keywords.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import { run } from './pmkit.mjs'
import { makeRepo } from './test-helpers.mjs'

const env = { ...process.env, PMKIT_USER: 'fred', PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
const similar = async (root, args) => {
  const result = await run(['issues', 'similar', ...args, '--json'], { cwd: root, env })
  return { ...result, data: result.code === 0 ? JSON.parse(result.stdout) : JSON.parse(result.stdout) }
}

test('issues similar lists completed issues that read alike, with their estimate, and writes nothing', async () => {
  const root = makeRepo('no-sprints')
  const { code, data, stderr } = await similar(root, ['ISS-9B2X'])
  assert.equal(code, 0, stderr)
  assert.equal(data.target.id, 'ISS-9B2X')
  assert.ok(data.similar.length > 0 && data.similar.every((hit) => hit.status.category === 'done'), JSON.stringify(data.similar))
  assert.ok(data.similar.every((hit) => hit.id !== 'ISS-9B2X' && hit.score > 0 && 'estimate' in hit && hit.shared.length > 0))
  assert.deepEqual([data.complete, data.hasMore], [true, false])
})

test('issues similar --category picks the issues it reads', async () => {
  const root = makeRepo('no-sprints')
  const { data } = await similar(root, ['ISS-6R3N', '--category', 'in_review'])
  assert.deepEqual(data.similar.map((hit) => [hit.id, hit.status.category]), [['ISS-9B2X', 'in_review']])
})

test('issues similar --limit cuts the list', async () => {
  const root = makeRepo('no-sprints')
  for (const title of ['Sign webhook requests', 'Verify webhook payloads', 'Rotate webhook signing keys']) {
    assert.equal((await run(['issues', 'create', '--title', title, '--type', 'task', '--estimate', '2', '--json'], { cwd: root, env })).code, 0)
  }
  const args = ['ISS-2K5P', '--category', 'done,todo,backlog,in_review,triage']
  const all = await similar(root, args)
  assert.ok(all.data.similar.length >= 3, JSON.stringify(all.data.similar))
  const one = await similar(root, [...args, '--limit', '1'])
  assert.deepEqual(one.data.similar.map((hit) => hit.id), [all.data.similar[0].id])
})

test('issues similar is incomplete when an issue file cannot be read, and says so', async () => {
  const { code, data, stderr } = await similar(makeRepo('team'), ['ISS-5N1R'])
  assert.equal(code, 0)
  assert.equal(data.complete, false)
  assert.ok(data.problems.some((problem) => problem.id === 'ISS-3Q6T'))
  assert.match(stderr, /not verified/)
})

test('issues similar refuses a bad limit and an unknown issue', async () => {
  const root = makeRepo('no-sprints')
  assert.equal((await similar(root, ['ISS-9B2X', '--limit', '0'])).data.error.code, 'INVALID_INPUT')
  assert.equal((await similar(root, ['ISS-0000'])).data.error.code, 'NOT_FOUND')
})

test('issues similar refuses an empty --category', async () => {
  assert.equal((await similar(makeRepo('no-sprints'), ['ISS-9B2X', '--category', ''])).data.error.code, 'INVALID_INPUT')
})

test('issues similar says not verified on stdout when the target has no usable words or the read is incomplete', async () => {
  const root = makeRepo('team')
  const created = JSON.parse((await run(['issues', 'create', '--title', 'UI', '--type', 'task', '--json'], { cwd: root, env })).stdout).after.id
  const result = await run(['issues', 'similar', created], { cwd: root, env })
  assert.match(result.stdout, /not verified/)
  assert.doesNotMatch(result.stdout, /^no similar issues among/)
})
