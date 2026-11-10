import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeRepo, userStoreEnv } from './test-helpers.mjs'
import { fakeGh, ghCalls } from './fake-gh.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pmkit.mjs')
const ITEM_KEYS = ['key', 'kind', 'issue', 'title', 'at', 'by', 'in', 'comment', 'excerpt', 'from', 'to', 'synthetic', 'seen']

function setup() {
  const root = makeRepo('no-sprints')
  const { env: store } = userStoreEnv()
  const run = (args, { user = 'fred', now = '2026-10-31T10:00:00Z' } = {}) => {
    const env = { ...process.env, ...store, PMKIT_USER: user, PMKIT_NOW: now, PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  const json = (args, options) => {
    const result = run([...args, '--json'], options)
    assert.equal(result.status, 0, result.stderr + result.stdout)
    return JSON.parse(result.stdout)
  }
  return { root, store, run, json }
}

test('inbox list prints the stable JSON keys, the item keys and a table with the key', () => {
  const { run, json } = setup()
  assert.equal(run(['issues', 'assign', 'ISS-1V9Z', 'fred'], { user: 'ana', now: '2026-10-31T09:00:00Z' }).status, 0)
  const empty = json(['inbox', 'list', '--since', '2026-10-31T09:30:00Z'])
  assert.deepEqual(Object.keys(empty), ['available', 'user', 'checked', 'since', 'hidden', 'items', 'counts', 'complete', 'problems', 'reviews'])
  assert.deepEqual(empty.items, [])
  assert.match(run(['inbox', 'list', '--since', '2026-10-31T09:30:00Z']).stdout, /no unseen mentions, assignments or status changes for fred since 2026-10-31T09:30:00Z/)
  const data = json(['inbox', 'list'])
  assert.equal(data.available, true)
  assert.deepEqual([data.user, data.checked, data.hidden], ['fred', null, 0])
  assert.deepEqual(Object.keys(data.items[0]), ITEM_KEYS)
  assert.deepEqual([data.items[0].kind, data.items[0].issue, data.items[0].by, data.items[0].seen], ['assignment', 'ISS-1V9Z', 'ana', false])
  const text = run(['inbox', 'list']).stdout
  assert.match(text, /assignment/)
  assert.match(text, /ISS-1V9Z/)
  assert.ok(text.includes(data.items[0].key))
})

test('inbox list with --all, with --as and with --all and --since together', () => {
  const { run, json } = setup()
  assert.equal(json(['inbox', 'list', '--all']).since, null)
  assert.equal(json(['inbox', 'list', '--as', 'ana']).user, 'ana')
  const both = run(['inbox', 'list', '--all', '--since', '2026-10-31T09:30:00Z', '--json'])
  assert.equal(both.status, 2)
  assert.equal(JSON.parse(both.stdout).error.code, 'INVALID_INPUT')
})

test('inbox mark-read --dry-run writes nothing, --key marks only that key and the list shows the rest', () => {
  const { store, run, json } = setup()
  run(['issues', 'assign', 'ISS-1V9Z', 'fred'], { user: 'ana', now: '2026-10-31T09:00:00Z' })
  run(['issues', 'assign', 'ISS-2K5P', 'fred'], { user: 'ana', now: '2026-10-31T09:10:00Z' })
  const [first, second] = json(['inbox', 'list']).items
  const dry = json(['inbox', 'mark-read', '--dry-run'])
  assert.deepEqual(dry, { user: 'fred', previous: null, recorded: '2026-10-31T10:00:00Z', marked: [first.key, second.key].sort(), unknown: [], pruned: 0, changed: true, dryRun: true, note: null })
  assert.equal(fs.existsSync(path.join(store.PMKIT_HOME, 'inbox')), false)
  assert.match(run(['inbox', 'mark-read', '--dry-run']).stdout, /would mark 2 items read for fred\ndry run: nothing was written/)
  const done = json(['inbox', 'mark-read', '--key', first.key])
  assert.deepEqual([done.changed, done.marked.includes(first.key)], [true, true])
  assert.equal(fs.readdirSync(path.join(store.PMKIT_HOME, 'inbox')).length, 1)
  assert.deepEqual(json(['inbox', 'list']).items.map((item) => item.key), [second.key])
  assert.match(run(['inbox', 'mark-read']).stdout, /marked 1 item read for fred/)
  assert.deepEqual(json(['inbox', 'list']).items, [])
  assert.match(run(['inbox', 'mark-read']).stdout, /nothing to mark read for fred/)
})

test('an incomplete inbox says so in the text, the warnings and the JSON, and mark-read refuses', () => {
  const { root, store, run, json } = setup()
  fs.mkdirSync(path.join(root, '.issues', 'issues', 'ISS-2K5P', 'comments'), { recursive: true })
  fs.writeFileSync(path.join(root, '.issues', 'issues', 'ISS-2K5P', 'comments', 'bad.md'), '---\nauthor: [\n---\n@fred\n')
  const result = run(['inbox', 'list', '--all'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /the inbox is incomplete: 1 problem/)
  assert.match(result.stderr, /warning: ISS-2K5P: INVALID_INPUT comment bad\.md cannot be read.*; run pmkit validate/)
  const data = json(['inbox', 'list', '--all'])
  assert.equal(data.complete, false)
  assert.equal(data.problems[0].id, 'ISS-2K5P')
  const refused = run(['inbox', 'mark-read', '--json'])
  assert.equal(refused.status, 2)
  const error = JSON.parse(refused.stdout).error
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.problems.length, 1)
  assert.equal(fs.existsSync(path.join(store.PMKIT_HOME, 'inbox')), false)
})

test('inbox commands refuse a bad value with INVALID_INPUT', () => {
  const { run } = setup()
  for (const args of [['inbox', 'list', '--since', 'later'], ['inbox', 'list', '--as', 'nobody']]) {
    const result = run([...args, '--json'])
    assert.equal(result.status, 2, args.join(' '))
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT', args.join(' '))
  }
})

test('PMK-195: inbox mark-read marks the known keys, warns about an unknown key and exits 0', () => {
  const { run, json } = setup()
  run(['issues', 'assign', 'ISS-1V9Z', 'fred'], { user: 'ana', now: '2026-10-31T09:00:00Z' })
  const first = json(['inbox', 'list', '--all']).items[0]
  const result = run(['inbox', 'mark-read', '--key', first.key, '--key', 'comment:ISS-1V9Z:none', '--json'])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual([JSON.parse(result.stdout).marked, JSON.parse(result.stdout).unknown], [[first.key], ['comment:ISS-1V9Z:none']])
  assert.match(result.stderr, /warning: no item has the key comment:ISS-1V9Z:none/)
})

// PMK-225: review requests from one gh call, and the Text and Seen columns.
const REVIEW_CALL = 'pr list --state open --limit 200 --json number,url,title,headRefName,author,reviewRequests'
const pr = (number, requests, extra = {}) => ({ number, url: `https://github.com/acme/repo/pull/${number}`, title: `PR ${number}`, headRefName: `b${number}`, author: { login: 'ana' }, reviewRequests: requests, ...extra })

function withGithub(root, canned) {
  const file = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('git_host:\n  system: none', 'git_host:\n  system: github\n  repo: acme/repo'))
  return fakeGh(canned)
}

function ghSetup(canned) {
  const context = setup()
  const gh = withGithub(context.root, canned)
  const ghRun = (args, options) => {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: context.root,
      env: { ...process.env, ...context.store, PMKIT_USER: 'fred', PMKIT_NOW: '2026-10-31T10:00:00Z', PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', PATH: `${gh.dir}${path.delimiter}${process.env.PATH}`, PMKIT_FAKE_GH: gh.responses, ...options },
      encoding: 'utf8',
    })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  return { ...context, gh, ghRun }
}

test('PMK-225: inbox list --reviews matches review requests by member id or --login, without case, and lists team requests apart', () => {
  const { ghRun, gh } = ghSetup({
    [REVIEW_CALL]: { stdout: JSON.stringify([
      pr(1, [{ __typename: 'User', login: 'Fred' }]),
      pr(2, [{ __typename: 'User', login: 'fred-gh' }]),
      pr(3, [{ __typename: 'User', login: 'ana' }]),
      pr(4, [{ __typename: 'Team', name: 'Core', slug: 'core' }]),
    ]) },
  })
  const result = ghRun(['inbox', 'list', '--reviews', '--login', 'FRED-GH', '--json'])
  assert.equal(result.status, 0, result.stderr + result.stdout)
  const data = JSON.parse(result.stdout)
  assert.deepEqual(data.reviews, {
    verified: true,
    requested: [1, 2].map((n) => ({ number: n, url: `https://github.com/acme/repo/pull/${n}`, title: `PR ${n}`, branch: `b${n}`, author: 'ana' })),
    teamRequests: [{ number: 4, team: 'core' }],
    complete: true,
    reason: null,
  })
  assert.equal(data.counts.reviewRequests, 2)
  assert.deepEqual(ghCalls(gh), [REVIEW_CALL])
  const text = ghRun(['inbox', 'list', '--reviews', '--login', 'fred-gh']).stdout
  assert.match(text, /2 review requests waiting for fred/)
  assert.match(text, /PR 1/)
})

test('PMK-225: inbox list --reviews says not verified, never 0, when gh fails or there is no git host', () => {
  const failing = ghSetup({ [REVIEW_CALL]: { status: 1, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' } })
  const result = failing.ghRun(['inbox', 'list', '--reviews', '--json'])
  assert.equal(result.status, 0, result.stderr + result.stdout)
  const data = JSON.parse(result.stdout)
  assert.deepEqual(data.reviews, { verified: false, requested: null, teamRequests: null, complete: false, reason: 'GitHub CLI is not logged in', code: 'AUTH' })
  assert.equal(data.counts.reviewRequests, null)
  assert.match(failing.ghRun(['inbox', 'list', '--reviews']).stdout, /review requests not verified: GitHub CLI is not logged in/)
  const { json } = setup()
  const none = json(['inbox', 'list', '--reviews'])
  assert.deepEqual([none.reviews.verified, none.reviews.code, none.counts.reviewRequests], [false, 'NOT_SUPPORTED', null])
})

test('PMK-225: 200 pull requests back make the review count incomplete', () => {
  const many = Array.from({ length: 200 }, (_, i) => pr(i + 1, []))
  const { ghRun } = ghSetup({ [REVIEW_CALL]: { stdout: JSON.stringify(many) } })
  const data = JSON.parse(ghRun(['inbox', 'list', '--reviews', '--json']).stdout)
  assert.deepEqual([data.reviews.verified, data.reviews.complete, data.reviews.reason], [true, false, 'only the 200 most recently created open pull requests were read'])
})

test('PMK-225: without --reviews the list calls no gh and has reviews null', () => {
  const { ghRun, gh } = ghSetup({})
  const data = JSON.parse(ghRun(['inbox', 'list', '--json']).stdout)
  assert.deepEqual([data.reviews, data.counts.reviewRequests], [null, null])
  assert.deepEqual(ghCalls(gh), [])
})

test('PMK-225: the text table shows the mention text cut at 60 characters, the status change and whether an item was seen', () => {
  const { run, json } = setup()
  const long = `@fred ${'x'.repeat(80)}`
  const body = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-body-')), 'body.md')
  fs.writeFileSync(body, long)
  const posted = run(['issues', 'comment', 'ISS-1V9Z', '--body-file', body], { user: 'ana', now: '2026-10-31T09:00:00Z' })
  fs.rmSync(path.dirname(body), { recursive: true })
  assert.equal(posted.status, 0, posted.stderr + posted.stdout)
  assert.equal(run(['issues', 'assign', 'ISS-1V9Z', 'fred'], { user: 'ana', now: '2026-10-31T09:01:00Z' }).status, 0)
  assert.equal(run(['issues', 'move', 'ISS-1V9Z', 'in_progress'], { user: 'ana', now: '2026-10-31T09:02:00Z' }).status, 0)
  const text = run(['inbox', 'list']).stdout
  const header = text.split('\n')[0].split('|').map((cell) => cell.trim())
  assert.deepEqual(header, ['When', 'Kind', 'Issue', 'Title', 'By', 'Where', 'Text', 'Seen', 'Key'])
  assert.ok(text.includes(`${long.slice(0, 59)}…`))
  assert.ok(!text.includes(long.slice(0, 61)))
  assert.match(text, /\w → in_progress/)
  const key = json(['inbox', 'list']).items[0].key
  assert.equal(run(['inbox', 'mark-read', '--key', key]).status, 0)
  const seenRow = run(['inbox', 'list', '--all']).stdout.split('\n').find((line) => line.includes(key))
  assert.equal(seenRow.split('|').map((cell) => cell.trim())[7], 'yes')
})

test('PMK-225 review 2: --login without --reviews is INVALID_INPUT, not ignored', () => {
  const { run } = setup()
  const result = run(['inbox', 'list', '--login', 'fred-gh', '--json'])
  assert.equal(result.status, 2, result.stdout + result.stderr)
  const { error } = JSON.parse(result.stdout)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.match(error.message, /--login/)
  assert.match(error.nextStep, /--reviews/)
})
