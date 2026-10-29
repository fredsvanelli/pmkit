import test from 'node:test'
import assert from 'node:assert/strict'
import { ACME_STATES, ACME_TEAM, ACME_TEAM_ID, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeWorkspace } from '../../fake-linear-api.mjs'
import { createLinearClient, isMutation } from './client.mjs'
import { fetchDiscovery } from './discovery.mjs'
import { readLinearSnapshot } from './migrate-reader.mjs'

const OTHER = { ...ACME_TEAM, id: 'team-other', key: 'OTHER', name: 'Other' }
const TEAMS = [{ ...ACME_TEAM, cyclesEnabled: true }, OTHER]
const STATES = [...ACME_STATES, { id: 'state-o1', name: 'Backlog', type: 'backlog', position: 0, team: { id: 'team-other' } }]
const PMKIT = { tracker: { system: 'linear', scope: { workspace: 'acme', team: 'ACME' } }, mappings: { types: { bug: 'Bug' } } }

function setup({ nestedPage = 50 } = {}) {
  const issues = fakeLinearIssues({ teams: TEAMS, states: STATES, nestedPage, cycles: [{ number: 1, startsAt: '2026-11-02T00:00:00.000Z', endsAt: '2026-11-16T00:00:00.000Z' }] })
  const projects = fakeLinearProjects({ issues, teams: TEAMS, states: STATES })
  const fetch = fakeLinearFetch({ ...fakeWorkspace({ teams: TEAMS, states: STATES }), ...issues.routes, ...projects.routes })
  const client = createLinearClient({ env: { LINEAR_API_KEY: FAKE_KEY }, tracker: PMKIT.tracker, fetch })
  const read = () => readLinearSnapshot({ client, discovery: () => fetchDiscovery(client), teamKey: 'ACME', pmkit: PMKIT, now: () => new Date('2026-10-28T20:00:00Z') })
  return { issues, projects, fetch, client, read }
}
const calls = (fetch, name) => fetch.calls.filter((call) => call.body.query.includes(`query ${name}(`))

test('the reader pages 100 issues at a time with archived ones', async () => {
  const { issues, fetch, read } = setup()
  for (let i = 0; i < 150; i++) issues.seed({ title: `t${i}` })
  const { snapshot } = await read()
  assert.equal(snapshot.issues.length, 150)
  const pages = calls(fetch, 'PmkitIssueEvents')
  assert.equal(pages.length, 2)
  assert.ok(pages.every((call) => call.body.variables.includeArchived === true && call.body.variables.first === 100))
})

test('nested history past its first page is completed', async () => {
  const { issues, fetch, read } = setup()
  const node = issues.seed({ title: 'busy' })
  for (let i = 0; i < 60; i++) issues.history(node.id, { fromTitle: `a${i}`, toTitle: `b${i}` })
  const { snapshot } = await read()
  assert.equal(calls(fetch, 'PmkitIssueHistory').length, 1)
  assert.equal(snapshot.issues[0].events.filter((event) => event.field === 'title').length, 60)
})

test('projects, their updates and the cycles are read', async () => {
  const { issues, projects, read } = setup()
  const project = projects.seed({ id: 'p-1', name: 'Epic', teamIds: [ACME_TEAM_ID] })
  projects.seedUpdate('p-1', { id: 'u-1', body: 'Fine', health: 'onTrack' })
  issues.seed({ title: 'child', projectId: 'p-1' })
  const { snapshot } = await read()
  assert.deepEqual(snapshot.epics.map((epic) => [epic.id, epic.uuid, epic.updates.map((update) => [update.id, update.health])]), [[project.identifier, 'p-1', [['u-1', 'on_track']]]])
  assert.deepEqual(snapshot.sprints.map((sprint) => [sprint.id, sprint.start, sprint.end]), [['1', '2026-11-02', '2026-11-15']])
  assert.equal(snapshot.issues[0].parent, project.identifier)
  assert.deepEqual(snapshot.scope, { workspace: 'acme', team: 'ACME' })
  assert.equal(snapshot.system, 'linear')
})

test('links come once each, comments keep their thread, and a relation to another team is left out and counted', async () => {
  const { issues, read } = setup()
  const a = issues.seed({ title: 'a' })
  const b = issues.seed({ title: 'b' })
  const other = issues.seed({ title: 'other', teamId: 'team-other' })
  issues.relate('blocks', a.id, b.id)
  issues.relate('related', a.id, b.id)
  issues.relate('blocks', a.id, other.id)
  const root = issues.comment(a.id, { body: 'q', resolvedAt: '2026-10-28T00:00:00Z' })
  issues.comment(a.id, { body: 'r', parentId: root.id })
  const { snapshot } = await read()
  assert.deepEqual(snapshot.links, [{ kind: 'blocks', from: 'ACME-1', to: 'ACME-2' }, { kind: 'related', from: 'ACME-1', to: 'ACME-2' }])
  assert.equal(snapshot.outside.links, 1)
  assert.equal(snapshot.issues.length, 2)
  const reply = snapshot.comments.find((comment) => comment.parent)
  assert.equal(reply.parent, root.id)
  assert.equal(snapshot.comments.find((comment) => comment.id === root.id).resolved, true)
})

test('the reader sends no mutation and counts its requests', async () => {
  const { issues, fetch, read } = setup()
  issues.seed({ title: 'a' })
  const { readRequests } = await read()
  assert.ok(fetch.calls.every((call) => !isMutation(call.body.query)))
  assert.equal(readRequests, fetch.calls.length)
})

// Linear refuses a query whose complexity is over 10000. Its documented rule: a field 0.1 point, an object 1 point, and a
// connection multiplies its children by its `first`, so nested connections multiply. The total is rounded up.
function complexity(query, variables) {
  const tokens = query.match(/\.\.\.|[{}():!$@,[\]]|"(?:[^"\\]|\\.)*"|-?\d+|\w+/g)
  let at = 0
  const take = () => tokens[at++]
  const value = () => {
    const token = take()
    if (token === '$') return variables[take()]
    if (token === '{' || token === '[') {
      for (let depth = 1; depth > 0;) depth += { '{': 1, '[': 1, '}': -1, ']': -1 }[take()] ?? 0
      return null
    }
    return /^-?\d+$/.test(token) ? Number(token) : token === 'true' ? true : token === 'false' ? false : token
  }
  const args = () => {
    const found = {}
    if (tokens[at] !== '(') return found
    take()
    while (tokens[at] !== ')') {
      const name = take()
      take()
      found[name] = value()
      if (tokens[at] === ',') take()
    }
    take()
    return found
  }
  const included = () => {
    let keep = true
    while (tokens[at] === '@') {
      take()
      const name = take()
      const { if: condition } = args()
      if ((name === 'include' && condition !== true) || (name === 'skip' && condition === true)) keep = false
    }
    return keep
  }
  const fragments = {}
  const selection = () => {
    take()
    const fields = []
    while (tokens[at] !== '}') {
      if (tokens[at] === '...') {
        take()
        const spread = take()
        if (included()) fields.push({ spread })
        continue
      }
      const name = take()
      const found = args()
      const keep = included()
      const children = tokens[at] === '{' ? selection() : null
      if (keep) fields.push({ name, args: found, children })
    }
    take()
    return fields
  }
  let operation
  while (at < tokens.length) {
    const token = take()
    if (token === 'fragment') {
      const name = take()
      take()
      take()
      fragments[name] = selection()
    } else if (token === 'query') {
      while (tokens[at] !== '{') take()
      operation = selection()
    }
  }
  const cost = (fields) => fields.reduce((sum, field) => {
    if (field.spread) return sum + cost(fragments[field.spread])
    if (!field.children) return sum + 0.1
    const connection = field.children.some((child) => child.name === 'nodes')
    return sum + 1 + (connection ? field.args.first ?? 50 : 1) * cost(field.children)
  }, 0)
  return Math.ceil(cost(operation) - 1e-9)
}

// Linear accepted the issue page at first 100 in the PMK-41 live read-back, though the rule above gives it 233001. The
// ceiling keeps it from growing unnoticed.
const LIVE_ACCEPTED = { PmkitIssueEvents: 233001 }

test('every query the reader sends stays under Linear complexity limit with a margin', async () => {
  const { issues, projects, fetch, client } = setup({ nestedPage: 2 })
  const parent = issues.seed({ title: 'parent', labelIds: ['label-bug', 'label-feature', 'label-docs'] })
  for (let i = 0; i < 3; i++) {
    const child = issues.seed({ title: `child ${i}`, parentId: parent.id })
    issues.relate('blocks', parent.id, child.id)
    issues.relate('related', child.id, parent.id)
    issues.comment(parent.id, { body: `c${i}` })
    issues.history(parent.id, { fromTitle: `a${i}`, toTitle: `b${i}` })
  }
  projects.seed({ id: 'p-1', name: 'Epic', teamIds: [ACME_TEAM_ID] })
  projects.seedUpdate('p-1', { id: 'u-1', body: 'Fine', health: 'onTrack' })
  // Discovery is the export's read too, so the reader gets it already made and only the reader's own queries are counted.
  const found = await fetchDiscovery(client)
  const from = fetch.calls.length
  await readLinearSnapshot({ client, discovery: async () => found, teamKey: 'ACME', pmkit: PMKIT, now: () => new Date('2026-10-28T20:00:00Z') })
  const names = new Set()
  for (const call of fetch.calls.slice(from)) {
    const name = call.body.query.match(/query (\w+)/)[1]
    names.add(name)
    const estimate = complexity(call.body.query, call.body.variables ?? {})
    if (name in LIVE_ACCEPTED) assert.ok(estimate <= LIVE_ACCEPTED[name], `${name} costs ${estimate}`)
    else assert.ok(estimate < 8000, `${name} with ${JSON.stringify(call.body.variables)} costs ${estimate}`)
  }
  for (const name of ['PmkitIssueEvents', 'PmkitProjects', 'PmkitProjectUpdates', 'PmkitCycles', 'PmkitIssueHistory', 'PmkitIssueComments', 'PmkitIssueChildrenPage', 'PmkitIssueRelationsPage']) {
    assert.ok(names.has(name), `the run sent ${name}`)
  }
})

test('projects past the first page are all read', async () => {
  const { projects, fetch, read } = setup()
  for (let i = 0; i < 12; i++) projects.seed({ id: `p-${i}`, name: `Epic ${i}`, teamIds: [ACME_TEAM_ID] })
  const { snapshot } = await read()
  assert.equal(snapshot.epics.length, 12)
  assert.equal(calls(fetch, 'PmkitProjects').length, 2)
})
