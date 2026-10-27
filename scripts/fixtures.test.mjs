import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { run } from './pmkit.mjs'
import { makeRepo } from './test-helpers.mjs'

const env = { PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_USER: 'fred' }

// Runs the CLI on a fresh copy of a fixture and removes the copy afterwards.
async function withFixture(name, body) {
  const cwd = makeRepo(name)
  try {
    const call = async (...argv) => run(argv, { env, cwd })
    return await body({ cwd, call })
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}

const problemsFor = (problems, id) => problems.filter((problem) => problem.path.includes(`/${id}/`))

test('messy-merge: validate reports the merge leftovers', async () => {
  await withFixture('messy-merge', async ({ call }) => {
    const result = await call('validate', '--json')
    assert.equal(result.code, 0, result.stderr)
    const { problems } = JSON.parse(result.stdout)
    for (const id of ['ISS-4', 'ISS-5']) {
      const own = problemsFor(problems, id)
      assert.ok(own.some((problem) => problem.code === 'conflict'), `${id} has a conflict problem`)
    }
    assert.ok(
      problems.some((problem) => problem.code === 'sprint' && problem.message.includes('more than one active sprint')),
      'the second active sprint is reported',
    )
    for (const id of ['ISS-1', 'ISS-2', 'ISS-3', 'ISS-7', 'ISS-8']) {
      assert.deepEqual(problemsFor(problems, id), [], `${id} has no problem`)
    }
  })
})

test('messy-merge: issues list --json has the clean issues', async () => {
  await withFixture('messy-merge', async ({ call }) => {
    const result = await call('issues', 'list', '--json')
    assert.equal(result.code, 0, result.stderr)
    const ids = JSON.parse(result.stdout).issues.map((issue) => issue.id)
    assert.ok(ids.includes('ISS-1'))
    assert.ok(ids.includes('ISS-2'))
  })
})

test('messy-merge: ISS-6 events are out of order on disk', async () => {
  await withFixture('messy-merge', async ({ cwd }) => {
    const text = fs.readFileSync(path.join(cwd, '.issues/issues/ISS-6/events.jsonl'), 'utf8')
    const times = text.split('\n').filter(Boolean).map((line) => JSON.parse(line).at)
    assert.notDeepEqual(times, [...times].sort())
  })
})

test('no-sprints: validate has no problems and no sprint exists', async () => {
  await withFixture('no-sprints', async ({ call }) => {
    const validate = await call('validate', '--json')
    assert.equal(validate.code, 0, validate.stdout)
    assert.deepEqual(JSON.parse(validate.stdout).problems, [])
    const cycles = await call('cycle', 'list', '--json')
    assert.equal(cycles.code, 0, cycles.stderr)
    assert.deepEqual(JSON.parse(cycles.stdout), [])
  })
})

test('no-sprints: metrics cycle-time prints a number', async () => {
  await withFixture('no-sprints', async ({ call }) => {
    const result = await call('metrics', 'cycle-time', '--json')
    assert.equal(result.code, 0, result.stderr)
    assert.equal(typeof JSON.parse(result.stdout).median, 'number')
  })
})

test('no-sprints: metrics lead-time gives two issues', async () => {
  await withFixture('no-sprints', async ({ call }) => {
    const result = await call('metrics', 'lead-time', '--json')
    assert.equal(result.code, 0, result.stderr)
    const data = JSON.parse(result.stdout)
    assert.equal(data.count, 2)
    assert.equal(data.median, 16.25)
  })
})

test('no-sprints: metrics throughput counts two features', async () => {
  await withFixture('no-sprints', async ({ call }) => {
    const result = await call('metrics', 'throughput', '--json')
    assert.equal(result.code, 0, result.stderr)
    const data = JSON.parse(result.stdout)
    assert.equal(data.count, 2)
    assert.deepEqual(data.byType, { feature: 2 })
  })
})

test('no-sprints: docs read specs/overview.md exits 0', async () => {
  await withFixture('no-sprints', async ({ call }) => {
    const result = await call('docs', 'read', 'specs/overview.md')
    assert.equal(result.code, 0, result.stderr)
  })
})
