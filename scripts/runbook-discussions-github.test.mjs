// E2E test of docs/runbooks/discussions-github.md: the real CLI, run as a subprocess, with a fake gh first on PATH that keeps the
// state of the stateful fake GitHub in a fixture file between runs. No logged call may hold the token.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeGithubIssues } from './fake-github-issues.mjs'
import { GITHUB_TRACKER_INIT, statefulGhCalls, statefulGhOnPath } from './fake-gh-path.mjs'
import { childEnv } from './golden-helpers.mjs'
import { tempDir, userStoreEnv } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(SCRIPTS, 'pmkit.mjs')
const TOKEN = `ghp_${'Qw7E'.repeat(9)}`
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'discussions-github.md')
const URL_1 = 'https://github.com/acme/widgets/discussions/1'
const PAT_STEP = 'Give the token read and write access to Discussions in its GitHub settings, or unset GH_TOKEN to use the gh login'

const SETUP = [...GITHUB_TRACKER_INIT, '--json']

const COMMANDS = {
  list: ['github', 'discussions', 'list', '--json'],
  ideas: ['github', 'discussions', 'list', '--category', 'ideas', '--json'],
  get1: ['github', 'discussions', 'get', '1', '--json'],
  createDry: ['issues', 'create', '--title-file', 'tmp/title.txt', '--description-file', 'tmp/description.md', '--criteria-file', 'tmp/criteria.txt', '--dry-run', '--json'],
  create: ['issues', 'create', '--title-file', 'tmp/title.txt', '--description-file', 'tmp/description.md', '--criteria-file', 'tmp/criteria.txt', '--json'],
  commentDry: ['github', 'discussions', 'comment', '1', '--body-file', 'tmp/comment.txt', '--dry-run', '--json'],
  comment: ['github', 'discussions', 'comment', '1', '--body-file', 'tmp/comment.txt', '--json'],
  get9: ['github', 'discussions', 'get', '9', '--json'],
  get2: ['github', 'discussions', 'get', '2', '--json'],
}

/** The state "Before you start" describes: setup done, two discussions on GitHub, the texts in tmp/. Returns { fake, pmkit }. */
function runbookRepo() {
  const root = tempDir('pmkit-runbook-discussions-github-')
  spawnSync('git', ['init', '-q'], { cwd: root })
  const github = fakeGithubIssues()
  github.seedDiscussion({
    title: 'RFC: offline mode', body: 'Should the app work without a network?', category: 'Ideas', author: 'hubot', upvotes: 4, updatedAt: '2026-11-10T00:00:00.000Z',
    comments: [{ author: 'octocat', body: 'Yes, read-only first', upvotes: 2, replies: [{ author: 'hubot', body: 'And writes later?' }] }, { author: 'hubot', body: 'Sync conflicts worry me' }],
  })
  // A long thread: the answer has 120 replies, and 1000 other comments follow it (PMK-342).
  const replies = Array.from({ length: 120 }, (_, index) => ({ author: 'octocat', body: `Thanks ${index + 1}` }))
  const others = Array.from({ length: 1000 }, (_, index) => ({ author: 'octocat', body: `Same here ${index + 1}` }))
  github.seedDiscussion({ title: 'How do I reset my token?', category: 'Q&A', updatedAt: '2026-11-12T00:00:00.000Z', comments: [{ author: 'hubot', body: 'Run gh auth refresh', isAnswer: true, replies }, ...others] })
  const fake = statefulGhOnPath({ meta: null, issues: github.toJSON() })
  const env = { ...childEnv(), ...userStoreEnv().env, GH_TOKEN: TOKEN, PATH: `${fake.bin}${path.delimiter}${process.env.PATH}` }
  const pmkit = (args) => {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' })
    return { code: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  json(pmkit(SETUP))
  fs.mkdirSync(path.join(root, 'tmp'))
  const files = {
    'title.txt': 'Add an offline mode\n',
    'description.md': `### Context\n\nFrom discussion #1: ${URL_1}\n\nUsers asked to work without a network.\n`,
    'criteria.txt': '- The app opens without a network\n- Changes made offline sync when the network is back\n',
    'comment.txt': 'Tracked in #3\n',
  }
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, 'tmp', name), text)
  return { fake, pmkit }
}

function json(result) {
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout)
}
function failure(result) {
  assert.equal(result.code, 2, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout).error
}
const state = (fake) => JSON.parse(fs.readFileSync(fake.fixtureFile, 'utf8')).issues
const mutationNames = (fake) => statefulGhCalls(fake).map((call) => /mutation (\w+)/.exec(JSON.parse(call.input || '{}').query ?? '')?.[1]).filter(Boolean)

test('the runbook names the commands this test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  for (const args of Object.values(COMMANDS)) assert.ok(text.includes(`node scripts/pmkit.mjs ${args.join(' ')}`), args.join(' '))
  for (const expected of ['Turn on Discussions in the repository settings on GitHub', 'GitHub has no discussion #9 in acme/widgets', 'acme/widgets has Discussions turned off', `From discussion #1: ${URL_1}`, 'Tracked in #3', PAT_STEP, 'discussion #2 has 1001 comments and pmkit read the first 1000', 'GitHub has no discussion #2 in acme/widgets', '; it was deleted while pmkit read the thread', 'pmkit github discussions get 2']) {
    assert.ok(text.includes(expected), expected)
  }
})

test('runbook: list, read, create an issue from a discussion and comment back, steps 1 to 10', () => {
  const { fake, pmkit } = runbookRepo()

  // Step 1: newest activity first.
  const listed = json(pmkit(COMMANDS.list))
  assert.equal(listed.available, true)
  assert.deepEqual(listed.discussions.map((item) => [item.number, item.category, item.state, item.answered]), [[2, 'Q&A', 'open', true], [1, 'Ideas', 'open', false]])
  assert.equal(listed.hasMore, false)

  // Step 2: the category, in another case.
  assert.deepEqual(json(pmkit(COMMANDS.ideas)).discussions.map((item) => item.number), [1])

  // Step 3: the thread.
  const read = json(pmkit(COMMANDS.get1))
  assert.deepEqual([read.discussion.title, read.discussion.category.name, read.discussion.author, read.discussion.answer, read.discussion.commentsTotal], ['RFC: offline mode', 'Ideas', 'hubot', null, 2])
  assert.equal(read.discussion.comments[0].replies[0].body, 'And writes later?')
  assert.deepEqual(read.warnings, [])

  // Step 4: the dry run creates nothing; the real run creates issue 3, which names the discussion.
  json(pmkit(COMMANDS.createDry))
  assert.deepEqual(state(fake).issues, [])
  const created = json(pmkit(COMMANDS.create))
  assert.equal(created.after.id, '3')
  assert.ok(state(fake).issues[0].body.includes(`From discussion #1: ${URL_1}`))

  // Step 5: the comment dry run posts nothing; the real run posts it.
  const dry = json(pmkit(COMMANDS.commentDry))
  assert.deepEqual(dry, { discussion: 1, title: 'RFC: offline mode', url: null, body: 'Tracked in #3', author: 'octocat' })
  assert.ok(!mutationNames(fake).includes('PmkitAddDiscussionComment'))
  const posted = json(pmkit(COMMANDS.comment))
  assert.match(posted.url, /^https:\/\/github\.com\/acme\/widgets\/discussions\/1#discussioncomment-\d+$/)
  assert.equal(mutationNames(fake).filter((name) => name === 'PmkitAddDiscussionComment').length, 1)

  // Step 6: the comment is on the discussion, which stays open.
  const again = json(pmkit(COMMANDS.get1)).discussion
  assert.equal(again.commentsTotal, 3)
  assert.deepEqual([again.comments.at(-1).body, again.comments.at(-1).author, again.state], ['Tracked in #3', 'octocat', 'open'])

  // Step 7: a missing discussion.
  assert.deepEqual(failure(pmkit(COMMANDS.get9)), { code: 'NOT_FOUND', message: 'GitHub has no discussion #9 in acme/widgets', nextStep: 'pmkit github discussions list' })

  // Step 8: Discussions turned off.
  const fixture = JSON.parse(fs.readFileSync(fake.fixtureFile, 'utf8'))
  fixture.issues.discussionsEnabled = false
  fs.writeFileSync(fake.fixtureFile, JSON.stringify(fixture))
  const off = json(pmkit(COMMANDS.list))
  assert.deepEqual([off.available, off.reason, off.enableHint], [false, 'disabled', 'Turn on Discussions in the repository settings on GitHub'])
  assert.deepEqual(failure(pmkit(COMMANDS.commentDry)), { code: 'NOT_SUPPORTED', message: 'acme/widgets has Discussions turned off', nextStep: 'Turn on Discussions in the repository settings on GitHub' })

  // Step 9: Discussions back on, and a fine-grained PAT without the Discussions permission. GitHub refuses the read once.
  const pat = JSON.parse(fs.readFileSync(fake.fixtureFile, 'utf8'))
  pat.issues.discussionsEnabled = true
  pat.issues.failures = { PmkitDiscussion: [{ errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token' }] }] }
  fs.writeFileSync(fake.fixtureFile, JSON.stringify(pat))
  assert.deepEqual(failure(pmkit(COMMANDS.get1)), { code: 'AUTH', message: 'GitHub refused the personal access token: Resource not accessible by personal access token', nextStep: PAT_STEP })

  // Step 10: a thread past 100 comments, whose answer has past 100 replies, comes back whole up to 1000 comments, with a warning past that.
  const long = json(pmkit(COMMANDS.get2))
  assert.equal(long.discussion.commentsTotal, 1001)
  assert.equal(long.discussion.comments.length, 1000)
  assert.equal(long.discussion.comments.at(-1).body, 'Same here 999')
  assert.deepEqual([long.discussion.comments[0].isAnswer, long.discussion.comments[0].repliesTotal, long.discussion.comments[0].replies.length], [true, 120, 120])
  assert.equal(long.discussion.comments[0].replies.at(-1).body, 'Thanks 120')
  assert.deepEqual(long.warnings, ['discussion #2 has 1001 comments and pmkit read the first 1000'])

  // Steps 11 and 12: the discussion, then a comment, deleted between the first read and a further page. GitHub answers the node read NOT_FOUND once.
  const goneOnce = (operation, id) => {
    const fixture = JSON.parse(fs.readFileSync(fake.fixtureFile, 'utf8'))
    fixture.issues.failures = { [operation]: [{ data: { node: null }, errors: [{ type: 'NOT_FOUND', path: ['node'], message: `Could not resolve to a node with the global id of '${id}'` }] }] }
    fs.writeFileSync(fake.fixtureFile, JSON.stringify(fixture))
  }
  goneOnce('PmkitDiscussionComments', 'D_2')
  assert.deepEqual(failure(pmkit(COMMANDS.get2)), { code: 'NOT_FOUND', message: 'GitHub has no discussion #2 in acme/widgets', nextStep: 'pmkit github discussions list' })
  const answer = long.discussion.comments[0].id
  goneOnce('PmkitDiscussionReplies', answer)
  assert.deepEqual(failure(pmkit(COMMANDS.get2)), {
    code: 'NOT_FOUND', message: `GitHub has no comment ${answer} in discussion #2 in acme/widgets; it was deleted while pmkit read the thread`, nextStep: 'pmkit github discussions get 2',
  })

  // No call holds the token, and every call names the host.
  const made = statefulGhCalls(fake)
  assert.ok(made.length > 0)
  for (const call of made) {
    assert.deepEqual(call.args.slice(0, 3), ['api', '--hostname', 'github.com'])
    assert.ok(!JSON.stringify(call).includes(TOKEN), 'a gh call holds the token')
  }
})
