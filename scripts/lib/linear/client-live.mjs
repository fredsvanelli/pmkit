// Opt-in live check of the Linear client, the workspace discovery and the issue filters against the sandbox workspace.
// It sends reads only, keeps its discovery cache in a temporary folder it removes, prints no workspace data, and
// `npm test` does not load it (the name does not end in .test.mjs).
//
//   set -a; . ./.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=<url key> node --test scripts/lib/linear/client-live.mjs
//
// PMKIT_LIVE_WORKSPACE is the URL key the key is expected to belong to. It stays out of the repository.
// Every test is skipped, with one reason, unless PMKIT_LIVE is 1, PMKIT_LIVE_WORKSPACE is set and
// LINEAR_API_KEY is usable.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { isPmkitError } from '../errors.mjs'
import { replay } from '../local/events.mjs'
import { createLinearClient, isMutation, operationName } from './client.mjs'
import { linearCredential } from './credential.mjs'
import { categoryOfType, discoveryView, fetchDiscovery } from './discovery.mjs'
import { COMMENT_BY_ID_QUERY, ISSUE_COMMENTS_QUERY, ISSUE_HISTORY_QUERY } from './documents.mjs'
import { buildLinearCapabilities } from './manifest.mjs'
import { createLinearTracker } from './tracker.mjs'

const WORKSPACE = process.env.PMKIT_LIVE_WORKSPACE

function skipReason() {
  if (process.env.PMKIT_LIVE !== '1') return 'set PMKIT_LIVE=1 to run the live check'
  if (!WORKSPACE) return 'set PMKIT_LIVE_WORKSPACE to the sandbox workspace URL key'
  try {
    linearCredential(process.env)
  } catch (error) {
    return `LINEAR_API_KEY is not usable: ${error.message}`
  }
  return false
}

const skip = skipReason()
const KEY = skip ? undefined : linearCredential(process.env).authorization

/** Wraps the global fetch and refuses any mutation, so the check stays read-only. */
async function guardedFetch(url, init) {
  const { query } = JSON.parse(init.body)
  if (isMutation(query)) throw new Error('client-live is read-only: refusing to send a mutation')
  return globalThis.fetch(url, init)
}

const tracker = (workspace) => ({ system: 'linear', scope: { workspace } })
const client = (options = {}) =>
  createLinearClient({ env: process.env, tracker: tracker(WORKSPACE), fetch: guardedFetch, ...options })

function assertNoKey(error) {
  assert.ok(isPmkitError(error), `expected a PmkitError, got ${error}`)
  for (const text of [error.message, error.nextStep, JSON.stringify(error.details ?? null)]) {
    assert.ok(!text.includes(KEY), 'an error holds the key')
  }
}

const ISSUES =
  'query LiveIssues($first: Int!, $after: String) { issues(first: $first, after: $after) { pageInfo { hasNextPage endCursor } nodes { id } } }'

test('the session pins to the expected workspace', { skip }, async () => {
  const session = await client().session()
  assert.equal(session.pinned, true)
  assert.equal(session.workspace.urlKey, WORKSPACE)
  assert.ok(!JSON.stringify(session).includes(KEY))
})

test('a wrong workspace is AUTH', { skip }, async () => {
  const error = await client({ tracker: tracker('pmkit-no-such-workspace') }).session().catch((caught) => caught)
  assert.equal(error.code, 'AUTH')
  assertNoKey(error)
})

test('a key Linear does not know is AUTH', { skip }, async () => {
  const env = { LINEAR_API_KEY: `lin_api_${'x'.repeat(40)}` }
  const error = await client({ env }).session().catch((caught) => caught)
  assert.equal(error.code, 'AUTH')
  assert.equal(error.message, 'Linear rejected LINEAR_API_KEY')
  assertNoKey(error)
})

test('paginate returns two distinct issues and rateLimit fills in', { skip }, async () => {
  const linear = client()
  const { nodes } = await linear.paginate(ISSUES, {}, { select: (data) => data.issues, pageSize: 1, limit: 2 })
  assert.equal(nodes.length, 2)
  assert.notEqual(nodes[0].id, nodes[1].id)
  assert.equal(typeof linear.rateLimit().requests.limit, 'number')
  assert.ok(!JSON.stringify(linear.rateLimit()).includes(KEY))
})

test('an unknown field is UPSTREAM with GRAPHQL_VALIDATION_FAILED', { skip }, async () => {
  const error = await client().request('query LiveBad { viewer { noSuchField } }').catch((caught) => caught)
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.details.linear.errors[0].code, 'GRAPHQL_VALIDATION_FAILED')
  assertNoKey(error)
})

test('an unknown issue id is UPSTREAM with INPUT_ERROR', { skip }, async () => {
  const document = 'query LiveIssue { issue(id: "00000000-0000-4000-8000-000000000000") { id } }'
  const error = await client().request(document).catch((caught) => caught)
  assert.equal(error.code, 'UPSTREAM')
  assert.equal(error.details.linear.errors[0].code, 'INPUT_ERROR')
  assertNoKey(error)
})

test('discovery reads the workspace and builds 20 capabilities', { skip }, async () => {
  const raw = await fetchDiscovery(client(), { now: () => new Date() })
  assert.equal(raw.workspace.urlKey, WORKSPACE)
  assert.ok(raw.teams.length >= 1, 'the workspace has a team')
  for (const state of raw.states) assert.notEqual(categoryOfType(state.type), null, 'a state has a type pmkit does not know')
  const view = discoveryView(raw, {})
  assert.deepEqual(Object.keys(view), [
    'workspace', 'team', 'teams', 'statuses', 'types', 'priorities', 'labels', 'members', 'agents', 'estimate', 'discoveredAt', 'warnings',
  ])
  assert.equal(buildLinearCapabilities(raw, {}).length, 20)
  assert.ok(!JSON.stringify(raw).includes(KEY))
})

test('Linear accepts every filter pmkit translates, and getIssue reads a result', { skip }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-live-'))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-live-repo-'))
  try {
    const env = { ...process.env, PMKIT_HOME: path.join(home, 'store'), HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') }
    const config = { root, pmkit: { tracker: tracker(WORKSPACE), git_host: { system: 'none' } } }
    const linear = createLinearTracker(config, { env, fetch: guardedFetch })
    const { labels } = await linear.discover()
    const first = (await linear.searchIssues({ limit: 1 })).issues[0]
    assert.ok(first, 'the workspace has an issue')
    const rows = [
      {}, { text: 'a' }, { categories: ['done'] }, { assignee: 'me' }, { assignee: 'none' },
      ...(labels.length > 0 ? [{ labels: [labels[0]] }] : []),
      { blocked: true }, { updatedAfter: '2026-01-01' }, { updatedBefore: '2099-01-01' }, { archived: true }, { sort: 'priority' },
      { parent: first.id },
    ]
    for (const row of rows) {
      const found = await linear.searchIssues({ ...row, limit: 1 }).catch((error) => {
        assertNoKey(error)
        throw new Error(`filter ${Object.keys(row).join(', ') || '(none)'} failed: ${error.code} ${error.message}`)
      })
      assert.ok(Array.isArray(found.issues), Object.keys(row).join(', '))
    }
    assert.equal((await linear.getIssue(first.id.toLowerCase())).id, first.id)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// PMK-36: history, comments and metric events. Reads only: guardedFetch refuses any mutation.

/** The tracker of the sandbox workspace and a private home, which `use` removes afterwards. */
async function withTracker(use, fetch = guardedFetch) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-live-'))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-live-repo-'))
  try {
    const env = { ...process.env, PMKIT_HOME: path.join(home, 'store'), HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') }
    // The team comes from the workspace, so no team key is written here.
    const { teams } = await fetchDiscovery(client(), { now: () => new Date() })
    const scope = { workspace: WORKSPACE, team: teams[0].key }
    const config = { root, pmkit: { tracker: { system: 'linear', scope }, git_host: { system: 'none' } } }
    return await use(createLinearTracker(config, { env, fetch }), env)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const REPLAYED = [['title', 'title'], ['type', 'type'], ['priority', 'priority'], ['estimate', 'estimate'], ['assignee', 'assignee'], ['parent', 'parent'], ['due', 'due']]
const normal = (value) => (value === undefined ? null : value)

test('getHistory on up to 10 sandbox issues gives sorted events whose replay matches getIssue', { skip }, async () => {
  const session = await client().session()
  assert.equal(session.workspace.urlKey, WORKSPACE, 'the key belongs to the expected workspace')
  await withTracker(async (linear) => {
    const { issues } = await linear.searchIssues({ limit: 10, archived: true })
    assert.ok(issues.length > 0, 'the workspace has an issue')
    let entries = 0
    let mappedEvents = 0
    for (const issue of issues) {
      const events = await linear.getHistory(issue.id)
      assert.equal(events[0].op, 'create', `${issue.id} starts with create`)
      const stamps = events.map((event) => event.at)
      assert.deepEqual(stamps, [...stamps].sort(), `${issue.id} is sorted`)
      const state = replay(events)
      for (const [key, field] of REPLAYED) assert.deepEqual(normal(state[key]), normal(issue[field]), `${issue.id} ${key}`)
      assert.equal(state.status, issue.status.name, `${issue.id} status`)
      assert.deepEqual(state.labels ?? [], issue.labels, `${issue.id} labels`)
      assert.deepEqual([...(state.related ?? [])].sort(), issue.related, `${issue.id} related`)
      // The entries pmkit reads (history entries with no mapped field give no event, as the spec's no-equivalent table says).
      const read = await client().paginate(ISSUE_HISTORY_QUERY, { id: issue.id }, { pageSize: 100, select: (data) => data.issue.history })
      entries += read.nodes.length
      mappedEvents += events.filter((event) => !['create', 'comment'].includes(event.op)).length
    }
    console.log(`live history: ${issues.length} issues, ${entries} entries, ${mappedEvents} events from them`)
  })
})

test('comments of a sandbox issue read back through the by-id document', { skip }, async () => {
  await withTracker(async (linear) => {
    const { issues } = await linear.searchIssues({ limit: 10, archived: true })
    let found = 0
    for (const issue of issues) {
      const comments = await linear.listComments(issue.id)
      for (const comment of comments.slice(0, 1)) {
        const node = (await client().request(COMMENT_BY_ID_QUERY, { id: comment.id })).comments.nodes[0]
        assert.equal(node.issue.identifier, issue.id)
        assert.equal(node.id, comment.id)
        found += 1
      }
      const direct = await client().paginate(ISSUE_COMMENTS_QUERY, { id: issue.id }, { pageSize: 100, select: (data) => data.issue.comments })
      assert.equal(direct.nodes.length, comments.length)
    }
    const missing = await client().request(COMMENT_BY_ID_QUERY, { id: '00000000-0000-4000-8000-000000000000' })
    assert.deepEqual(missing.comments.nodes, [], 'an unknown comment id is an empty list, not an error')
    // history-ops reads this error to tell a malformed comment id from another failure, so the live answer must keep its code and path.
    const malformed = await client().request(COMMENT_BY_ID_QUERY, { id: 'not-a-uuid' }).catch((caught) => caught)
    assert.equal(malformed.code, 'UPSTREAM')
    assert.equal(malformed.details.linear.errors[0].code, 'INPUT_ERROR')
    assert.equal(malformed.details.linear.errors[0].path[0], 'comments')
    console.log(`live comments: ${found} read by id`)
  })
})

test('metricEvents reads every issue of the team in a few pages', { skip }, async () => {
  const counting = async (url, init) => {
    if (operationName(JSON.parse(init.body).query) === 'PmkitIssueEvents') counting.pages += 1
    return guardedFetch(url, init)
  }
  counting.pages = 0
  await withTracker(async (linear) => {
    const events = await linear.metricEvents()
    const stamps = events.map((event) => event.at)
    assert.ok(events.length > 0)
    assert.deepEqual(stamps, [...stamps].sort())
    assert.ok(events.every((event) => typeof event.issue === 'string'))
    console.log(`live metric events: ${events.length} events, ${counting.pages} pages, truncated ${events.truncated === true}`)
  }, counting)
})
