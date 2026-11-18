// The github draft-issues calls of the CLI over the GitHub adapter and the stateful fake GitHub, run in process. No test starts gh.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { githubDescriptor } from './lib/github/adapter.mjs'
import { fakeGithubIssues } from './fake-github-issues.mjs'
import { childEnv } from './golden-helpers.mjs'
import { makeRepo, tempDir, userStoreEnv } from './test-helpers.mjs'

process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

const CONFIG = `version: 1
tracker:
  system: github
  scope:
    host: github.com
    repo: acme/widgets
    project: acme/7
git_host:
  system: github
write_policy:
  confirm: none
mappings:
  status:
    backlog: Backlog
    todo: Todo
    in_progress: In Progress
    in_review: In Review
    done: Done
`

function githubRepo({ config = CONFIG, ...options } = {}) {
  const root = tempDir('pmkit-github-drafts-')
  spawnSync('git', ['init', '-q'], { cwd: root })
  fs.mkdirSync(path.join(root, '.pmkit'))
  fs.writeFileSync(path.join(root, '.pmkit', 'config.yaml'), config)
  const fake = fakeGithubIssues(options)
  const a = fake.seedDraft({ title: 'Offline mode', body: 'Work without a network.', values: { Status: 'Todo' } }).item
  const b = fake.seedDraft({ title: 'Dark theme' }).item
  const env = { ...childEnv(), ...userStoreEnv().env }
  const adapters = { ...ADAPTERS, github: githubDescriptor({ exec: fake.exec }) }
  const cli = (args) => run(args, { cwd: root, env, adapters })
  return { root, fake, cli, a, b }
}

const dataOf = (result) => {
  assert.equal(result.code, 0, result.stdout + result.stderr)
  return JSON.parse(result.stdout)
}
const errorOf = (result) => {
  assert.equal(result.code, 2, result.stdout + result.stderr)
  return JSON.parse(result.stdout).error
}

test('github draft-issues list returns the drafts of the Project', async () => {
  const { cli, a } = githubRepo()
  const listed = dataOf(await cli(['github', 'draft-issues', 'list', '--json']))
  assert.equal(listed.available, true)
  assert.deepEqual(listed.drafts.map((draft) => [draft.item, draft.title, draft.fields]), [[a, 'Offline mode', { Status: 'Todo' }], [listed.drafts[1].item, 'Dark theme', {}]])
  assert.equal(dataOf(await cli(['github', 'draft-issues', 'list', '--limit', '1', '--project', 'acme/7', '--json'])).hasMore, true)
  const text = await cli(['github', 'draft-issues', 'list'])
  assert.equal(text.code, 0, text.stderr)
  assert.match(text.stdout, new RegExp(`^${a} {2}Offline mode {2}Todo`))
  assert.equal(errorOf(await cli(['github', 'draft-issues', 'list', '--project', 'acme', '--json'])).code, 'INVALID_INPUT')
})

test('github draft-issues convert previews with --dry-run, then converts', async () => {
  const { fake, cli, a, b } = githubRepo()
  const dry = dataOf(await cli(['github', 'draft-issues', 'convert', a, b, '--dry-run', '--json']))
  assert.deepEqual([dry.dryRun, dry.target, dry.drafts.map((draft) => draft.title)], [true, { repo: 'acme/widgets', tracked: true }, ['Offline mode', 'Dark theme']])
  assert.equal(fake.mutations.length, 0)
  const text = await cli(['github', 'draft-issues', 'convert', a, '--dry-run'])
  assert.equal(text.stdout, 'would convert 1 draft of Roadmap into issues in acme/widgets\n')
  const done = dataOf(await cli(['github', 'draft-issues', 'convert', a, b, '--json']))
  assert.deepEqual(done.converted.map((item) => [item.number, item.id]), [[1, '1'], [2, '2']])
  assert.deepEqual(fake.mutations.map((call) => call.name), ['PmkitConvertDraftItem', 'PmkitConvertDraftItem'])
  assert.equal(dataOf(await cli(['issues', 'get', '1', '--json'])).title, 'Offline mode')
})

test('github draft-issues convert needs an item and refuses a bad one', async () => {
  const { cli } = githubRepo()
  assert.equal(errorOf(await cli(['github', 'draft-issues', 'convert', '--json'])).code, 'INVALID_INPUT')
  assert.deepEqual(errorOf(await cli(['github', 'draft-issues', 'convert', 'PVTI_404', '--dry-run', '--json'])), { code: 'INVALID_INPUT', message: 'item PVTI_404 does not exist', nextStep: 'pmkit github draft-issues list' })
})

test('a broken config refuses github draft-issues convert and still lets list run', async () => {
  const { fake, cli, a } = githubRepo({ config: `${CONFIG}  fields:\n    priority: bogus\n` })
  const refused = errorOf(await cli(['github', 'draft-issues', 'convert', a, '--json']))
  assert.match(refused.message, /^\.pmkit\/config\.yaml is not valid, so writes are refused/)
  assert.equal(fake.mutations.length, 0)
  const listed = await cli(['github', 'draft-issues', 'list', '--json'])
  assert.equal(listed.code, 0, listed.stderr)
})

test('the github draft-issues calls refuse a Local tracker', async () => {
  const root = makeRepo()
  const result = await run(['github', 'draft-issues', 'list', '--json'], { cwd: root, env: { ...childEnv(), ...userStoreEnv().env } })
  assert.deepEqual(errorOf(result), { code: 'NOT_SUPPORTED', message: '`github draft-issues list` works only with the GitHub Issues tracker, and tracker.system is "local"', nextStep: 'node scripts/pmkit.mjs --help' })
})
