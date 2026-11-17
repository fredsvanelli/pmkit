// The github discussions calls of the CLI over the GitHub adapter and the stateful fake GitHub, run in process. No test starts gh.
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
  const root = tempDir('pmkit-github-discussions-')
  spawnSync('git', ['init', '-q'], { cwd: root })
  fs.mkdirSync(path.join(root, '.pmkit'))
  fs.writeFileSync(path.join(root, '.pmkit', 'config.yaml'), config)
  const fake = fakeGithubIssues(options)
  fake.seedDiscussion({ title: 'RFC: plugins', body: 'Should we add plugins?', category: 'Ideas', author: 'hubot', updatedAt: '2026-11-10T00:00:00.000Z', comments: [{ body: 'Yes', replies: [{ author: 'hubot', body: 'Why?' }] }] })
  fake.seedDiscussion({ title: 'How do I log in?', category: 'Q&A', updatedAt: '2026-11-12T00:00:00.000Z', comments: [{ body: 'Run gh auth login', isAnswer: true }] })
  const env = { ...childEnv(), ...userStoreEnv().env }
  const adapters = { ...ADAPTERS, github: githubDescriptor({ exec: fake.exec }) }
  const cli = (args) => run(args, { cwd: root, env, adapters })
  return { root, fake, cli }
}

const dataOf = (result) => {
  assert.equal(result.code, 0, result.stdout + result.stderr)
  return JSON.parse(result.stdout)
}
const errorOf = (result) => {
  assert.equal(result.code, 2, result.stdout + result.stderr)
  return JSON.parse(result.stdout).error
}

test('github discussions list returns the open discussions and filters them', async () => {
  const { cli } = githubRepo()
  const all = dataOf(await cli(['github', 'discussions', 'list', '--json']))
  assert.equal(all.available, true)
  assert.deepEqual(all.discussions.map((item) => item.number), [2, 1])
  assert.deepEqual(dataOf(await cli(['github', 'discussions', 'list', '--category', 'ideas', '--json'])).discussions.map((item) => item.number), [1])
  assert.deepEqual(dataOf(await cli(['github', 'discussions', 'list', '--answered', 'yes', '--limit', '5', '--state', 'all', '--json'])).discussions.map((item) => item.number), [2])
  const text = await cli(['github', 'discussions', 'list'])
  assert.equal(text.code, 0, text.stderr)
  assert.match(text.stdout, /^#2 {2}How do I log in\?/)
})

test('github discussions list refuses a bad --answered or --state value', async () => {
  const { cli } = githubRepo()
  assert.equal(errorOf(await cli(['github', 'discussions', 'list', '--answered', 'maybe', '--json'])).code, 'INVALID_INPUT')
  assert.equal(errorOf(await cli(['github', 'discussions', 'list', '--state', 'shut', '--json'])).message, '--state must be open, closed or all')
})

test('github discussions get returns the thread, and refuses a bad or missing number', async () => {
  const { cli } = githubRepo()
  const one = dataOf(await cli(['github', 'discussions', 'get', '#1', '--json']))
  assert.equal(one.discussion.title, 'RFC: plugins')
  assert.equal(one.discussion.comments[0].replies[0].body, 'Why?')
  assert.equal(errorOf(await cli(['github', 'discussions', 'get', 'abc', '--json'])).code, 'INVALID_INPUT')
  assert.deepEqual(errorOf(await cli(['github', 'discussions', 'get', '9', '--json'])), { code: 'NOT_FOUND', message: 'GitHub has no discussion #9 in acme/widgets', nextStep: 'pmkit github discussions list' })
  const text = await cli(['github', 'discussions', 'get', '1'])
  assert.match(text.stdout, /^#1 {2}RFC: plugins\nIdeas {2}by hubot {2}open/)
})

test('github discussions get and list say when Discussions are off', async () => {
  const { cli } = githubRepo({ discussionsEnabled: false })
  const listed = dataOf(await cli(['github', 'discussions', 'list', '--json']))
  assert.deepEqual([listed.available, listed.reason, listed.enableHint], [false, 'disabled', 'Turn on Discussions in the repository settings on GitHub'])
  assert.equal(dataOf(await cli(['github', 'discussions', 'get', '1', '--json'])).available, false)
})

test('github discussions comment previews with --dry-run, then posts', async () => {
  const { root, fake, cli } = githubRepo()
  const body = path.join(root, 'tmp-comment.txt')
  fs.writeFileSync(body, 'Tracked in #3\n')
  const dry = dataOf(await cli(['github', 'discussions', 'comment', '1', '--body-file', body, '--dry-run', '--json']))
  assert.deepEqual(dry, { discussion: 1, title: 'RFC: plugins', url: null, body: 'Tracked in #3', author: 'octocat' })
  assert.equal(fake.mutations.length, 0)
  const posted = dataOf(await cli(['github', 'discussions', 'comment', '1', '--body-file', body, '--json']))
  assert.match(posted.url, /discussions\/1#discussioncomment-\d+$/)
  assert.deepEqual(fake.mutations.map((call) => call.name), ['PmkitAddDiscussionComment'])
  const text = await cli(['github', 'discussions', 'comment', '1', '--body-file', body, '--dry-run'])
  assert.equal(text.stdout, 'would comment on discussion #1\n')
  assert.equal(errorOf(await cli(['github', 'discussions', 'comment', '1', '--json'])).code, 'INVALID_INPUT')
})

test('a broken config refuses github discussions comment and still lets list and get run', async () => {
  const { root, fake, cli } = githubRepo({ config: `${CONFIG}  fields:\n    priority: bogus\n` })
  const body = path.join(root, 'tmp-comment.txt')
  fs.writeFileSync(body, 'Tracked in #3\n')
  const refused = errorOf(await cli(['github', 'discussions', 'comment', '1', '--body-file', body, '--json']))
  assert.match(refused.message, /^\.pmkit\/config\.yaml is not valid, so writes are refused: mappings\.fields\.priority must be issue:<name>/)
  assert.equal(fake.mutations.length, 0)
  const listed = await cli(['github', 'discussions', 'list', '--json'])
  assert.equal(listed.code, 0, listed.stderr)
  assert.match(listed.stderr, /warning: \.pmkit\/config\.yaml is not valid/)
  assert.equal((await cli(['github', 'discussions', 'get', '1', '--json'])).code, 0)
})

test('the github discussions calls refuse a Local tracker', async () => {
  const root = makeRepo()
  const result = await run(['github', 'discussions', 'list', '--json'], { cwd: root, env: { ...childEnv(), ...userStoreEnv().env } })
  assert.deepEqual(errorOf(result), { code: 'NOT_SUPPORTED', message: '`github discussions list` works only with the GitHub Issues tracker, and tracker.system is "local"', nextStep: 'node scripts/pmkit.mjs --help' })
})
