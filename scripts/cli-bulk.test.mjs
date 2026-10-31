// issues bulk on the Local tracker: the preview, the digest that freezes it, the blockers and a write that stops midway.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { PmkitError } from './lib/errors.mjs'
import { hashTree, makeRepo } from './test-helpers.mjs'

process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

const ENV = { ...process.env, PMKIT_USER: 'fred', PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_SEED: '7' }

async function cli(root, args, adapters = ADAPTERS) {
  const result = await run([...args, '--json'], { cwd: root, env: ENV, adapters })
  return { code: result.code, body: JSON.parse(result.stdout), stderr: result.stderr }
}
async function ok(root, args) {
  const result = await cli(root, args)
  assert.equal(result.code, 0, JSON.stringify(result.body))
  return result.body
}

/** The basic fixture with four issues: A and B and D carry the label legacy, C does not. Returns the ids by name. */
async function withRepo(fn, { autoCommit = false } = {}) {
  const root = makeRepo('basic')
  const ids = {}
  const make = async (name, ...flags) => { ids[name] = (await ok(root, ['issues', 'create', '--title', name, ...flags])).after.id }
  await make('A', '--label', 'legacy', '--priority', 'low')
  await make('B', '--label', 'legacy', '--priority', 'high')
  await make('C', '--label', 'other', '--priority', 'low')
  await make('D', '--label', 'legacy', '--priority', 'low')
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^auto_commit: .*$/m, `auto_commit: ${autoCommit}`))
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', env: ENV })
  git('init', '-q')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.com')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  try {
    await fn(root, ids, git)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const events = (root, id) => fs.readFileSync(path.join(root, '.issues/issues', id, 'events.jsonl'), 'utf8').trim().split('\n').length
const priority = async (root, id) => (await ok(root, ['issues', 'get', id])).priority
const bulk = (root, ...args) => cli(root, ['issues', 'bulk', ...args])

test('the dry run lists the matched issues, the states and a digest, and writes nothing', async () => {
  await withRepo(async (root, ids) => {
    const before = hashTree(root, ['.issues/.cache', '.git'])
    const result = await bulk(root, 'priority', 'high', '--label', 'legacy', '--dry-run')
    assert.equal(result.code, 0)
    assert.deepEqual(result.body.items.map((item) => [item.id, item.state]), [[ids.A, 'change'], [ids.B, 'unchanged'], [ids.D, 'change']])
    assert.equal(result.body.writes, 2)
    assert.match(result.body.digest, /^sha256:[0-9a-f]{64}$/)
    assert.equal(result.body.dryRun, true)
    assert.equal(hashTree(root, ['.issues/.cache', '.git']), before)
  })
})

test('a real run needs the digest of the preview', async () => {
  await withRepo(async (root, ids) => {
    const before = hashTree(root, ['.issues/.cache', '.git'])
    const result = await bulk(root, 'priority', 'high', '--label', 'legacy')
    assert.equal(result.body.error.code, 'INVALID_INPUT')
    assert.match(result.body.error.nextStep, /--dry-run/)
    assert.equal(hashTree(root, ['.issues/.cache', '.git']), before)
    assert.equal(await priority(root, ids.A), 'low')
  })
})

test('a real run with the digest writes exactly what the preview showed', async () => {
  await withRepo(async (root, ids) => {
    const { digest } = (await bulk(root, 'priority', 'high', '--label', 'legacy', '--dry-run')).body
    const result = await bulk(root, 'priority', 'high', '--label', 'legacy', '--expect', digest)
    assert.equal(result.code, 0, JSON.stringify(result.body))
    assert.deepEqual(result.body.applied, [ids.A, ids.D])
    assert.equal(await priority(root, ids.A), 'high')
    assert.equal(await priority(root, ids.D), 'high')
    assert.equal(await priority(root, ids.C), 'low')
    assert.deepEqual([ids.A, ids.B, ids.C, ids.D].map((id) => events(root, id)), [2, 1, 1, 2])
  })
})

test('an issue that changed after the preview stops the write', async () => {
  await withRepo(async (root, ids) => {
    const { digest } = (await bulk(root, 'priority', 'high', '--label', 'legacy', '--dry-run')).body
    await ok(root, ['issues', 'update', ids.D, '--priority', 'urgent'])
    const before = hashTree(root, ['.issues/.cache', '.git'])
    const result = await bulk(root, 'priority', 'high', '--label', 'legacy', '--expect', digest)
    assert.equal(result.body.error.code, 'CONFLICT')
    assert.equal(result.body.error.expected, digest)
    assert.match(result.body.error.digest, /^sha256:[0-9a-f]{64}$/)
    assert.notEqual(result.body.error.digest, digest)
    assert.equal(hashTree(root, ['.issues/.cache', '.git']), before)
  })
})

test('a filter that now returns another issue stops the write', async () => {
  await withRepo(async (root, ids) => {
    const { digest } = (await bulk(root, 'priority', 'high', '--label', 'legacy', '--dry-run')).body
    await ok(root, ['issues', 'create', '--title', 'E', '--label', 'legacy'])
    const before = hashTree(root, ['.issues/.cache', '.git'])
    const result = await bulk(root, 'priority', 'high', '--label', 'legacy', '--expect', digest)
    assert.equal(result.body.error.code, 'CONFLICT')
    assert.equal(hashTree(root, ['.issues/.cache', '.git']), before)
    assert.equal(await priority(root, ids.A), 'low')
  })
})

test('a filter is required and the flags that would cut or widen the set are refused', async () => {
  await withRepo(async (root) => {
    assert.equal((await bulk(root, 'priority', 'high', '--dry-run')).body.error.code, 'INVALID_INPUT')
    for (const flag of [['--archived'], ['--limit', '1'], ['--sort', 'updated']]) {
      const result = await bulk(root, 'priority', 'high', '--label', 'legacy', ...flag, '--dry-run')
      assert.match(result.body.error.message, /unknown option/)
    }
    assert.equal((await bulk(root, 'bogus', 'x', '--label', 'legacy', '--dry-run')).body.error.code, 'INVALID_INPUT')
  })
})

test('more matches than the cap is refused with the count, never cut', async () => {
  await withRepo(async (root) => {
    const result = await bulk(root, 'priority', 'high', '--label', 'legacy', '--max', '2', '--dry-run')
    assert.equal(result.body.error.code, 'INVALID_INPUT')
    assert.match(result.body.error.message, /3 issues/)
    assert.equal((await bulk(root, 'priority', 'high', '--label', 'legacy', '--max', '500', '--dry-run')).body.error.code, 'INVALID_INPUT')
  })
})

test('an issue file that does not parse shows in the dry run and blocks the real run', async () => {
  await withRepo(async (root, ids) => {
    const file = path.join(root, '.issues/issues', ids.C, 'issue.md')
    fs.writeFileSync(file, `<<<<<<< ours\n${fs.readFileSync(file, 'utf8')}=======\n>>>>>>> theirs\n`)
    const dry = await bulk(root, 'priority', 'high', '--label', 'legacy', '--dry-run')
    assert.equal(dry.code, 0)
    assert.equal(dry.body.digest, null)
    assert.equal(dry.body.writable, false)
    assert.match(dry.body.blockers.join('\n'), new RegExp(ids.C))
    const before = hashTree(root, ['.issues/.cache', '.git'])
    const real = await bulk(root, 'priority', 'high', '--label', 'legacy', '--expect', 'sha256:0')
    assert.equal(real.body.error.code, 'INVALID_INPUT')
    assert.match(real.body.error.message, new RegExp(ids.C))
    assert.equal(hashTree(root, ['.issues/.cache', '.git']), before)
  })
})

test('a saved view gives the same set as its flags, and a view with a limit is refused', async () => {
  await withRepo(async (root) => {
    await ok(root, ['views', 'save', 'legacy', '--label', 'legacy'])
    await ok(root, ['views', 'save', 'one', '--label', 'legacy', '--limit', '1'])
    const flags = (await bulk(root, 'priority', 'high', '--label', 'legacy', '--dry-run')).body
    const view = (await bulk(root, 'priority', 'high', '--view', 'legacy', '--dry-run')).body
    assert.equal(view.digest, flags.digest)
    assert.equal(view.view, 'legacy')
    assert.match((await bulk(root, 'priority', 'high', '--view', 'one', '--dry-run')).body.error.message, /limit/)
    assert.equal((await bulk(root, 'priority', 'high', '--view', 'legacy', '--label', 'x', '--dry-run')).body.error.code, 'INVALID_INPUT')
  })
})

test('a view with archived or with only a sort is refused like the flags are', async () => {
  await withRepo(async (root, ids) => {
    await ok(root, ['issues', 'archive', ids.D])
    await ok(root, ['views', 'save', 'arch', '--label', 'legacy', '--archived'])
    await ok(root, ['views', 'save', 'all', '--sort', 'priority'])
    const before = hashTree(root, ['.issues/.cache', '.git'])
    const archived = await bulk(root, 'priority', 'high', '--view', 'arch', '--dry-run')
    assert.equal(archived.body.error.code, 'INVALID_INPUT')
    assert.match(archived.body.error.message, /archived/)
    const sorted = await bulk(root, 'move', 'done', '--view', 'all', '--dry-run')
    assert.equal(sorted.body.error.code, 'INVALID_INPUT')
    assert.match(sorted.body.error.message, /narrow/)
    assert.equal(hashTree(root, ['.issues/.cache', '.git']), before)
  })
})

test('a view with a criterion and a sort is accepted, and the sort orders the preview', async () => {
  await withRepo(async (root, ids) => {
    await ok(root, ['views', 'save', 'sorted', '--label', 'legacy', '--sort', 'priority'])
    const result = await bulk(root, 'priority', 'high', '--view', 'sorted', '--dry-run')
    assert.equal(result.code, 0, JSON.stringify(result.body))
    assert.equal(result.body.matched, 3)
    assert.deepEqual(result.body.items.map((item) => item.id).sort(), [ids.A, ids.B, ids.D].sort())
  })
})

test('a label value with a comma is one INVALID_INPUT and nothing is previewed', async () => {
  await withRepo(async (root) => {
    const result = await bulk(root, 'label-add', 'a,b', '--label', 'legacy', '--dry-run')
    assert.equal(result.body.error.code, 'INVALID_INPUT')
    assert.equal(result.body.items, undefined)
  })
})

test('an empty filter value is refused instead of matching every issue', async () => {
  await withRepo(async (root) => {
    const result = await bulk(root, 'priority', 'high', '--text', '', '--dry-run')
    assert.equal(result.body.error.code, 'INVALID_INPUT')
    assert.match(result.body.error.message, /empty/)
  })
})

test('a value the tracker refuses for every issue is one INVALID_INPUT with its next step, not a blocker per issue', async () => {
  await withRepo(async (root) => {
    for (const args of [['assign', 'ghost'], ['estimate', '4'], ['sprint', '999'], ['priority', 'bogus'], ['move', 'bogus'], ['parent', 'ISS-NOPE']]) {
      const result = await bulk(root, ...args, '--label', 'legacy', '--dry-run')
      assert.equal(result.code, 2, args.join(' '))
      assert.equal(result.body.error.code, 'INVALID_INPUT', `${args.join(' ')}: ${JSON.stringify(result.body)}`)
      assert.ok(result.body.error.nextStep, args.join(' '))
      assert.doesNotMatch(result.body.error.nextStep, /validate/)
    }
  })
})

test('bulk release warns when the release is already released, as issues update does', async () => {
  await withRepo(async (root) => {
    await ok(root, ['release', 'create', '1.0.0'])
    await ok(root, ['release', 'mark-released', '1.0.0'])
    const result = await bulk(root, 'release', '1.0.0', '--label', 'legacy', '--dry-run')
    assert.equal(result.code, 0, JSON.stringify(result.body))
    assert.deepEqual(result.body.warnings, ['release 1.0.0 is already released'])
    assert.match(result.stderr, /release 1.0.0 is already released/)
  })
})

test('when every issue is unchanged there is nothing to write and no digest is needed', async () => {
  await withRepo(async (root, ids) => {
    const { digest } = (await bulk(root, 'priority', 'high', '--label', 'legacy', '--dry-run')).body
    await ok(root, ['issues', 'bulk', 'priority', 'high', '--label', 'legacy', '--expect', digest])
    const before = hashTree(root, ['.issues/.cache', '.git'])
    const result = await bulk(root, 'priority', 'high', '--label', 'legacy')
    assert.equal(result.code, 0, JSON.stringify(result.body))
    assert.equal(result.body.writes, 0)
    assert.deepEqual(result.body.items.map((item) => item.state), ['unchanged', 'unchanged', 'unchanged'])
    assert.deepEqual(result.body.applied, [])
    assert.equal(hashTree(root, ['.issues/.cache', '.git']), before)
  })
})

test('label-add and move go through the existing operations and record their events', async () => {
  await withRepo(async (root, ids) => {
    const add = (await bulk(root, 'label-add', 'old', '--label', 'legacy', '--dry-run')).body
    await ok(root, ['issues', 'bulk', 'label-add', 'old', '--label', 'legacy', '--expect', add.digest])
    assert.deepEqual((await ok(root, ['issues', 'get', ids.A])).labels, ['legacy', 'old'])
    const move = (await bulk(root, 'move', 'todo', '--label', 'old', '--dry-run')).body
    assert.equal(move.writes, 3)
    await ok(root, ['issues', 'bulk', 'move', 'todo', '--label', 'old', '--expect', move.digest])
    assert.equal((await ok(root, ['issues', 'get', ids.B])).status.category, 'todo')
  })
})

test('a write that fails midway stops, lists what changed and what is left, and commits the writes', async () => {
  await withRepo(async (root, ids, git) => {
    const flaky = {
      ...ADAPTERS,
      local: {
        ...ADAPTERS.local,
        create: async (...args) => {
          const tracker = await ADAPTERS.local.create(...args)
          let writes = 0
          const assign = tracker.assign
          tracker.assign = (id, who, actor, options) => {
            if (!options?.dryRun && ++writes === 2) throw Object.assign(new Error('disk full'), { code: 'UPSTREAM', nextStep: 'retry' })
            return assign(id, who, actor, options)
          }
          return tracker
        },
      },
    }
    const file = path.join(root, '.issues/config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^auto_commit: .*$/m, 'auto_commit: true'))
    git('commit', '-qam', 'auto commit on')
    const args = ['issues', 'bulk', 'assign', 'fred', '--label', 'legacy']
    const { digest } = (await cli(root, [...args, '--dry-run'], flaky)).body
    const result = await cli(root, [...args, '--expect', digest], flaky)
    assert.equal(result.code, 2)
    assert.match(result.body.error.message, new RegExp(`${ids.B} failed after 1 of 3`))
    assert.deepEqual(result.body.result, { applied: [ids.A], failed: { id: ids.B, code: 'UPSTREAM', message: 'disk full' }, remaining: [ids.D] })
    assert.equal((await ok(root, ['issues', 'get', ids.A])).assignee, 'fred')
    assert.equal((await ok(root, ['issues', 'get', ids.B])).assignee, undefined)
    assert.equal((await ok(root, ['issues', 'get', ids.D])).assignee, undefined)
    assert.match(git('log', '-1', '--format=%s').stdout, /issues bulk/)
    assert.equal(git('status', '--porcelain').stdout, '')
  })
})

test('a stop midway keeps applied and failed in the result even when the write failed with CONFLICT', async () => {
  await withRepo(async (root, ids) => {
    const flaky = {
      ...ADAPTERS,
      local: {
        ...ADAPTERS.local,
        create: async (...args) => {
          const tracker = await ADAPTERS.local.create(...args)
          let writes = 0
          const assign = tracker.assign
          tracker.assign = (id, who, actor, options) => {
            if (!options?.dryRun && ++writes === 2) throw new PmkitError('CONFLICT', 'changed under us', 'retry')
            return assign(id, who, actor, options)
          }
          return tracker
        },
      },
    }
    const args = ['issues', 'bulk', 'assign', 'fred', '--label', 'legacy']
    const { digest } = (await cli(root, [...args, '--dry-run'], flaky)).body
    const result = await cli(root, [...args, '--expect', digest], flaky)
    assert.equal(result.code, 2)
    assert.equal(result.body.error.code, 'CONFLICT')
    assert.deepEqual(result.body.result.applied, [ids.A])
    assert.equal(result.body.result.failed.id, ids.B)
    assert.equal((await ok(root, ['issues', 'get', ids.A])).assignee, 'fred')
  })
})
