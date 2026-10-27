// Criterion 2 of PMK-32: no command writes a credential into the repository.
// It runs the write commands of the capability manifest with a sentinel in every
// credential variable, then looks for the sentinel in every file of the copies.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { runPmkit } from './golden-helpers.mjs'
import { makeRepo, tempDir, userStoreEnv } from './test-helpers.mjs'

const SENTINEL = 'pmkit-test-sentinel-9f3a'

/** Every file under dir, .git included. */
function filesUnder(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(full))
    else out.push(full)
  }
  return out
}

function filesWithSentinel(dir) {
  return filesUnder(dir).filter((file) => fs.readFileSync(file).includes(SENTINEL))
}

test('no command writes a credential into the repository or the user store', async () => {
  const { env: storeEnv } = userStoreEnv()
  const env = { ...storeEnv, LINEAR_API_KEY: SENTINEL, GITHUB_TOKEN: SENTINEL, GH_TOKEN: SENTINEL }
  const fresh = tempDir('pmkit-bare-')
  const repo = makeRepo('basic')
  const inputs = tempDir('pmkit-inputs-')
  const body = path.join(inputs, 'body.md')
  fs.writeFileSync(body, 'A note with no secret.\n')

  const run = async (root, args) => {
    const result = await runPmkit([...args, '--root', root, '--json'], root, { env })
    assert.equal(result.code, 0, `pmkit ${args.join(' ')} exited ${result.code}: ${result.stdout}${result.stderr}`)
    return JSON.parse(result.stdout)
  }

  await run(fresh, ['init'])
  const created = await run(repo, ['issues', 'create', '--title', 'Sentinel check'])
  const id = created.after.id
  await run(repo, ['issues', 'update', id, '--priority', 'high'])
  await run(repo, ['epic', 'create', '--title', 'Sentinel epic'])
  await run(repo, ['cycle', 'open', '--start', '2026-11-02'])
  await run(repo, ['release', 'create', 'v9.9.9'])
  await run(repo, ['milestone', 'create', 'sentinel-milestone'])
  await run(repo, ['issues', 'comment', id, '--body-file', body])
  await run(repo, ['docs', 'create', 'sentinel.md', '--body-file', body])
  await run(repo, ['reindex'])
  await run(repo, ['validate'])
  await run(repo, ['discover'])

  assert.deepEqual(filesWithSentinel(fresh), [])
  assert.deepEqual(filesWithSentinel(repo), [])
  // No command uses the store yet. A command that starts to use it must show up here on purpose.
  assert.equal(fs.existsSync(storeEnv.PMKIT_HOME), false, 'a command wrote into the user store')
})

test('the walk finds a sentinel hidden in a file, including inside .git', () => {
  const repo = makeRepo('basic')
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true })
  fs.writeFileSync(path.join(repo, '.git', 'leak'), `x ${SENTINEL} y`)
  assert.deepEqual(filesWithSentinel(repo), [path.join(repo, '.git', 'leak')])
})
