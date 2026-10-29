// Opt-in live run of local-migrate export, import and undo against the test team of the sandbox workspace (PMK-41).
// It writes, so it is gated twice: PMKIT_LIVE=1 and PMKIT_LIVE_WORKSPACE, the URL key the key must belong to.
// `npm test` does not load it (the name does not end in .test.mjs). Without the gate, every test is skipped with one reason.
//
//   set -a; . ./.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=<url key> node scripts/lib/linear/migrate-live.mjs
//
// The run uses PMK-39's sandbox helper: preflight checks the URL key against PMKIT_LIVE_WORKSPACE and refuses a test team
// that holds items, findOrCreateTestTeam must find the same team, and every request goes through createGuardedFetch with
// the 11 mutations export and undo send. Each rule accepts only the test team's id, its workflow states, the workspace's
// project statuses and type labels, and ids the run created. Every create must choose its id, and the guard owns that id
// from then on. The run sends at most MIGRATE_CAP requests, plus MIGRATE_RESERVE for the deletes of cleanup.
// It does not create the test team: run contract-live.mjs once first.
//
// Steps: build a five-issue Local fixture in a temporary repository; run the export dry run and the export with its digest,
// with the connection cut after the second mutation was sent; rerun both, which resume from the map by UUID; check the team
// holds each issue once; read the issues and the project back and compare them with the Local source; import the team into a
// new Local repository and compare the two trackers; run the undo dry run and the undo; check the team is empty.
// The after hook runs on failure too: it reruns the undo when the export wrote and the undo did not finish, then trashes the
// issues and projects the run created that are still there and deletes the labels it created.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { run as runPmkit } from '../../pmkit.mjs'
import { ADAPTERS } from '../adapters.mjs'
import { createLocalTracker } from '../local/tracker.mjs'
import { commitAll } from '../../migrate-fixture.mjs'
import { loadConfig } from '../config.mjs'
import { readLocalSnapshot } from '../local/migrate-reader.mjs'
import { readMap } from '../migrate/id-map.mjs'
import { linearDescriptor } from './adapter.mjs'
import { createLinearClient, isMutation } from './client.mjs'
import { linearCredential } from './credential.mjs'
import { skipReason } from './contract-live.mjs'
import { ISSUE_EVENTS_QUERY, LABEL_DELETE } from './documents.mjs'
import { PRIORITY_TO_LINEAR } from './issues.mjs'
import { HEALTH_FROM_LINEAR, PROJECTS_QUERY, PROJECT_STATUSES, PROJECT_UPDATES_QUERY } from './projects.mjs'
import {
  ISSUE_DELETE, PROJECT_DELETE, STATES_QUERY, TEST_TEAM, createGuardedFetch, findOrCreateTestTeam, listTestTeamItems, preflight, readMutation,
} from './sandbox.mjs'

/** The mutations local-migrate export sends, then the ones local-migrate undo sends. */
export const EXPORT_MUTATIONS = Object.freeze(['issueLabelCreate', 'projectCreate', 'issueCreate', 'issueRelationCreate', 'commentCreate', 'commentResolve', 'projectUpdateCreate', 'issueArchive'])
export const UNDO_MUTATIONS = Object.freeze(['issueDelete', 'projectDelete', 'issueLabelDelete'])

/** The request budget of one run (estimate in progress.md); the reserve keeps the cleanup deletes going past the cap. */
export const MIGRATE_CAP = 250
export const MIGRATE_RESERVE = 50

/**
 * What each mutation may name. `id`: the mutation takes `id: $id`, an id of that kind the run created. Otherwise it takes
 * `input: $input`: `team` names the key that must hold the test team's id, `teams` the key that must hold exactly that id,
 * `ids` the kinds each other id key may hold, and `create` the kind the run owns `input.id` as once the rule passes.
 * Every create chooses its id, as the migration writer does, so the run owns it even when the answer is lost.
 * Kinds: `viewer` is the key's owner, `typeLabel` a type label preflight found, every other kind an id the guard owns.
 */
const SPECS = {
  issueLabelCreate: { create: 'label', team: 'teamId', ids: { parentId: ['label'] } },
  projectCreate: { create: 'project', teams: 'teamIds', ids: { statusId: ['projectStatus'], leadId: ['viewer'], memberIds: ['viewer'] } },
  issueCreate: {
    create: 'issue',
    team: 'teamId',
    ids: { stateId: ['state'], labelIds: ['label', 'typeLabel'], parentId: ['issue'], projectId: ['project'], assigneeId: ['viewer'] },
  },
  issueRelationCreate: { create: 'relation', ids: { issueId: ['issue'], relatedIssueId: ['issue'] } },
  commentCreate: { create: 'comment', ids: { issueId: ['issue'], parentId: ['comment'], projectUpdateId: ['update'] } },
  commentResolve: { id: 'comment' },
  projectUpdateCreate: { create: 'update', ids: { projectId: ['project'] } },
  issueArchive: { id: 'issue' },
  issueDelete: { id: 'issue' },
  projectDelete: { id: 'project' },
  issueLabelDelete: { id: 'label' },
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function fits(kind, value, ctx) {
  if (kind === 'viewer') return typeof value === 'string' && value === ctx.viewerId
  if (kind === 'typeLabel') return ctx.labelIds.includes(value)
  return ctx.owned(kind, value)
}

function rule(root, spec, own) {
  return (variables, ctx) => {
    if (typeof ctx.teamId !== 'string') return 'the test team is not known'
    if (spec.id) {
      if (variables.input !== undefined) return `${root} takes no input`
      return ctx.owned(spec.id, variables.id) ? null : `${variables.id} is not a ${spec.id} the run created`
    }
    if (variables.id !== undefined) return `${root} takes no id variable`
    const input = variables.input
    if (!isObject(input)) return 'the input is not an object'
    if (input.id !== undefined && typeof input.id !== 'string') return 'input.id is not a string'
    if (spec.create && typeof input.id !== 'string') return `${root} must choose its id`
    if (spec.team && input[spec.team] !== ctx.teamId) return `${spec.team} is not the test team`
    if (spec.teams && !(Array.isArray(input[spec.teams]) && input[spec.teams].length === 1 && input[spec.teams][0] === ctx.teamId)) {
      return `${spec.teams} is not exactly the test team`
    }
    for (const [key, value] of Object.entries(input)) {
      if (key === 'id' || key === spec.team || key === spec.teams || !/Ids?$/.test(key)) continue
      const kinds = spec.ids?.[key]
      if (!kinds) return `the input key ${key} is not one the run checks`
      if (value === null || value === undefined) continue
      const values = key.endsWith('Ids') ? value : [value]
      if (!Array.isArray(values)) return `${key} is not a list`
      for (const id of values) if (!kinds.some((kind) => fits(kind, id, ctx))) return `${key} ${id} is not the test team's or the run's`
    }
    if (spec.create) own(spec.create, input.id)
    return null
  }
}

/** The allowlist of the run, for createGuardedFetch. `own(kind, id)` is the guard's own, called when a create passes. */
export function migrateAllowlist(own) {
  return Object.freeze(Object.fromEntries(Object.entries(SPECS).map(([root, spec]) => [root, rule(root, spec, own)])))
}

/**
 * The guarded fetch of the run, with MIGRATE_ALLOWLIST and the cap. Returns { fetch, guard, created }, where created(kind)
 * lists the ids of that kind whose create passed the guard: the only ids the cleanup deletes.
 */
export function migrateGuardedFetch({ fetch, workspace, cap = MIGRATE_CAP, reserve = MIGRATE_RESERVE }) {
  let guard = null
  const made = new Map()
  const allowlist = migrateAllowlist((kind, id) => {
    guard.own(kind, id)
    if (!made.has(kind)) made.set(kind, new Set())
    made.get(kind).add(id)
  })
  const guarded = createGuardedFetch({ fetch, workspace, allowlist, cap, reserve })
  guard = guarded.guard
  return { ...guarded, created: (kind) => [...(made.get(kind) ?? [])] }
}

/**
 * Wraps `fetch` so the `count`th mutation reaches Linear and its answer is lost, as a dropped connection would leave it.
 * From then on every request fails without being sent, so the runner cannot look the create up and its map entry stays
 * `sent`, as when the process dies, until heal() is called. Returns { fetch, cut, heal }: cut() is null until the cut,
 * then { root, uuid } of the lost mutation.
 */
export function interruptAfter(fetch, count) {
  let mutations = 0
  let lost = null
  let down = false
  async function cutting(url, init) {
    // The client reads guardRefusal as "nothing was sent" and does not retry, so the run stops at once.
    if (down) throw Object.assign(new Error('the live run cut the connection'), { guardRefusal: true })
    let body = null
    try {
      body = JSON.parse(init.body)
    } catch {
      body = null
    }
    if (lost || typeof body?.query !== 'string' || !isMutation(body.query)) return fetch(url, init)
    mutations += 1
    const response = await fetch(url, init)
    if (mutations < count) return response
    lost = { root: readMutation(body.query).root, uuid: body.variables?.input?.id ?? body.variables?.id ?? null }
    down = true
    throw new Error(`the live run cut the connection after mutation ${count} was sent`)
  }
  return { fetch: cutting, cut: () => lost, heal: () => { down = false } }
}

/** Owns the ids the export may name that the run did not create: the test team's states and the project statuses. */
export async function adoptTeamIds({ client, team, guard }) {
  const states = (await client.request(STATES_QUERY, { id: team.id })).team.states.nodes
  for (const state of states) guard.own('state', state.id)
  const statuses = (await client.request(PROJECT_STATUSES, {})).projectStatuses.nodes
  for (const status of statuses) guard.own('projectStatus', status.id)
  return { states: states.length, statuses: statuses.length }
}

/** The titles of the fixture's issues. */
export const FIXTURE_TITLES = Object.freeze(['Migrate the parent', 'Migrate the child', 'Migrate the blocker', 'Migrate the blocked issue', 'Migrate the related issue'])

/**
 * Writes the five-issue fixture into `root`, a Local tracker repository, and commits it: one epic, a parent and its child,
 * a blocker, a related link, a comment and a status update. It uses the types feature and bug, the two type labels
 * preflight requires.
 */
export function buildLiveFixture(root, { now = () => new Date() } = {}) {
  const tracker = createLocalTracker(root, { now, index: false })
  const actor = 'fred'
  const create = (input) => tracker.createIssue(input, actor).after.id
  const epic = tracker.createDeliverable({ title: 'Migrate the epic', description: 'The live migration fixture.' }, actor).after.id
  const [parentTitle, childTitle, blockerTitle, blockedTitle, relatedTitle] = FIXTURE_TITLES
  const parent = create({ title: parentTitle, type: 'feature', parent: epic, priority: 'high' })
  const child = create({ title: childTitle, type: 'bug', parent, description: 'The child of the parent.' })
  const blocker = create({ title: blockerTitle, type: 'feature' })
  const blocked = create({ title: blockedTitle, type: 'bug' })
  const related = create({ title: relatedTitle, type: 'feature' })
  tracker.link(blocker, blocked, 'blocks', actor)
  tracker.link(related, parent, 'related', actor)
  tracker.comment(child, 'A comment the export attributes.', actor)
  tracker.publishStatusUpdate({ epic, health: 'on_track', body: 'The fixture is ready.' }, actor)
  commitAll(root, 'live migration fixture')
  return { epic, parent, child, blocker, blocked, related }
}

/** The type label each fixture type maps to, as MAPPING_FLAGS says. */
const TYPE_LABEL = Object.freeze({ feature: 'Feature', bug: 'Bug' })

/** The status and type flags of the export. The fixture uses no task or chore, so those types map to no label. */
export const MAPPING_FLAGS = Object.freeze(['--status', 'in_review=In Review', '--status', 'blocked=In Progress', '--type-label', 'feature=Feature',
  '--type-label', 'bug=Bug', '--type-label', 'task=none', '--type-label', 'chore=none'])

/**
 * The CLI runs of the live test, in process, every request through `fetch`. Each returns { code, data, error }.
 * The real runs take the digest of their own dry run. The import runs in `target`, another Local repository.
 */
export function migrateSteps({ root, env, fetch, workspace, team }) {
  const adapters = { ...ADAPTERS, linear: linearDescriptor({ fetch }) }
  const cli = async (args, cwd = root) => {
    const result = await runPmkit(args, { cwd, env, adapters })
    let parsed = null
    try {
      parsed = JSON.parse(result.stdout)
    } catch {
      parsed = null
    }
    return { code: result.code, data: parsed, error: parsed?.error ?? (result.code === 0 ? null : result.stderr || result.stdout) }
  }
  const exportArgs = ['local-migrate', 'export', '--workspace', workspace, '--team', team.key, ...MAPPING_FLAGS, '--json']
  const importArgs = ['local-migrate', 'import', '--workspace', workspace, '--team', team.key, '--json']
  const undoArgs = (file) => ['local-migrate', 'undo', ...(file ? ['--file', file] : []), '--json']
  return {
    exportDry: () => cli([...exportArgs, '--dry-run']),
    exportReal: (digest) => cli([...exportArgs, '--expect', digest]),
    importDry: (target) => cli([...importArgs, '--dry-run'], target),
    importReal: (target, digest) => cli([...importArgs, '--expect', digest], target),
    undoDry: (file) => cli([...undoArgs(file), '--dry-run']),
    undoReal: (file, digest) => cli([...undoArgs(file), '--expect', digest]),
  }
}

const FIXTURE_DIR = path.join(import.meta.dirname, '..', '..', '__fixtures__', 'basic')

/**
 * Makes `root`, an empty folder, the Local repository the import writes into: the basic fixture with no issues, the
 * tracker config of `source`, and the export map at `map`, so the import takes the type labels back from it. Commits it.
 */
export function importRepository({ source, map, root }) {
  fs.cpSync(FIXTURE_DIR, root, { recursive: true })
  fs.mkdirSync(path.dirname(path.join(root, map)), { recursive: true })
  fs.copyFileSync(path.join(source, map), path.join(root, map))
  fs.copyFileSync(path.join(source, '.issues', 'config.yaml'), path.join(root, '.issues', 'config.yaml'))
  commitAll(root, 'export map')
  return root
}

/** The Local snapshot of a repository, as the export and the import read it. */
export const localSnapshot = (root) => readLocalSnapshot({ root, config: loadConfig(root) })

/** Reads the team back from Linear: { issues, projects }, the issues with their relations and comments, each project with its updates. */
export async function readBack({ client, team }) {
  const filter = { team: { key: { eq: team.key } } }
  const { nodes } = await client.paginate(ISSUE_EVENTS_QUERY, { filter, includeArchived: true }, { select: (data) => data.issues, pageSize: 100 })
  const issues = nodes.filter((node) => node.trashed !== true)
  const projectFilter = { accessibleTeams: { some: { key: { eq: team.key } } } }
  const { nodes: projectNodes } = await client.paginate(PROJECTS_QUERY, { filter: projectFilter, withLists: false }, { select: (data) => data.projects, pageSize: 50 })
  const projects = []
  for (const node of projectNodes) {
    const { nodes: updates } = await client.paginate(PROJECT_UPDATES_QUERY, { id: node.id }, { select: (data) => data.project.projectUpdates, pageSize: 50 })
    projects.push({ ...node, updates })
  }
  return { issues, projects }
}

/** The first line the export writes above a comment body. */
const ATTRIBUTION = /^Comment by \S.* on \d{4}-\d{2}-\d{2} in (\S+)\n\n/
const LINKS = ['blocks', 'related', 'duplicate']
const show = (value) => JSON.stringify(value ?? null)

/**
 * Compares what Linear holds after the export with the Local source, through the export map. Returns one line per
 * difference: a missing or duplicated record, a field, a parent, a link, a comment or its attribution line, the project.
 */
export function compareReadBack({ source, map, linear }) {
  const found = []
  const records = map.records ?? {}
  const byUuid = new Map(linear.issues.map((node) => [node.id, node]))
  const identifier = (id) => records.issue?.[id]?.id ?? null
  const nodeOf = (id) => byUuid.get(records.issue?.[id]?.uuid)
  if (linear.issues.length !== source.issues.length) found.push(`Linear holds ${linear.issues.length} issues, the Local source ${source.issues.length}`)
  for (const issue of source.issues) {
    const node = nodeOf(issue.id)
    if (!node) {
      found.push(`${issue.id} is not in Linear under the UUID of its map entry`)
      continue
    }
    const differ = (field, want, got) => {
      if (show(want) !== show(got)) found.push(`${issue.id} ${field}: Local ${show(want)}, Linear ${show(got)}`)
    }
    differ('title', issue.title, node.title)
    differ('description', (issue.description ?? '').trim(), (node.description ?? '').trim())
    differ('priority', PRIORITY_TO_LINEAR[issue.priority] ?? 0, node.priority ?? 0)
    differ('state type', issue.status?.category, node.state?.type)
    differ('type label', TYPE_LABEL[issue.type] ?? null, (node.labels?.nodes ?? []).map((label) => label.name).find((name) => Object.values(TYPE_LABEL).includes(name)))
    differ('created', Date.parse(issue.created), Date.parse(node.createdAt))
    const epic = issue.parent ? records.epic?.[issue.parent] : null
    differ('parent', epic ? null : identifier(issue.parent), node.parent?.identifier)
    if (epic) differ('project', epic.uuid, node.project?.id)
  }
  const relations = linear.issues.flatMap((node) => (node.relations?.nodes ?? []).filter((relation) => LINKS.includes(relation.type))
    .map((relation) => ({ kind: relation.type, from: node.identifier, to: relation.relatedIssue?.identifier })))
  if (relations.length !== source.links.length) found.push(`Linear holds ${relations.length} links, the Local source ${source.links.length}`)
  for (const link of source.links) {
    const [from, to] = [identifier(link.from), identifier(link.to)]
    const ends = (relation) => (relation.from === from && relation.to === to) || (link.kind === 'related' && relation.from === to && relation.to === from)
    if (!relations.some((relation) => relation.kind === link.kind && ends(relation))) found.push(`the ${link.kind} link ${link.from} to ${link.to} is not in Linear`)
  }
  const comments = linear.issues.flatMap((node) => (node.comments?.nodes ?? []).map((comment) => ({ ...comment, issue: node.id })))
  if (comments.length !== source.comments.length) found.push(`Linear holds ${comments.length} comments, the Local source ${source.comments.length}`)
  for (const comment of source.comments) {
    const uuid = records.issue?.[comment.issue]?.uuid
    const match = comments.find((entry) => entry.issue === uuid && (entry.body === comment.body || entry.body?.endsWith(`\n\n${comment.body}`)))
    if (!match) found.push(`the comment ${comment.id} is not in Linear`)
    else if (ATTRIBUTION.exec(match.body)?.[1] !== comment.issue) found.push(`the comment ${comment.id} has no attribution line naming ${comment.issue}`)
  }
  if (linear.projects.length !== source.epics.length) found.push(`Linear holds ${linear.projects.length} projects, the Local source ${source.epics.length}`)
  for (const epic of source.epics) {
    const project = linear.projects.find((node) => node.id === records.epic?.[epic.id]?.uuid)
    if (!project) {
      found.push(`${epic.id} is not in Linear under the UUID of its map entry`)
      continue
    }
    if (project.name !== epic.title) found.push(`${epic.id} title: Local ${show(epic.title)}, Linear ${show(project.name)}`)
    const description = (project.content || project.description || '').trim()
    if (description !== (epic.description ?? '').trim()) found.push(`${epic.id} description: Local ${show(epic.description)}, Linear ${show(description)}`)
    const want = (epic.updates ?? []).map(({ health, body }) => ({ health, body: body.trim() }))
    const got = project.updates.map((update) => ({ health: HEALTH_FROM_LINEAR[update.health] ?? update.health, body: (update.body ?? '').trim() }))
    if (show(want) !== show(got)) found.push(`${epic.id} status updates: Local ${show(want)}, Linear ${show(got)}`)
  }
  return found
}

/**
 * The fields an import may change, each a row of the losses tables: Linear replaces the history, so an issue loses the
 * completion time Local reads from its events and an epic its creation time; Linear names the branch; the export drops
 * milestones and estimates outside the scale. Status updates are compared by health and body only.
 */
export const IMPORT_LOSSES = Object.freeze({ issues: ['completed', 'branch', 'milestone', 'estimate'], epics: ['created', 'updates'] })

/** Compares the Local source with the tracker the import wrote. Returns one line per difference. Sprints and people are not compared: the test team has its own cycles and users. */
export function compareImport({ before, after }) {
  const found = []
  for (const kind of ['issues', 'epics']) {
    const back = new Map(after[kind].map((record) => [record.id, record]))
    const ids = (list) => list.map((record) => record.id).sort()
    if (show(ids(after[kind])) !== show(ids(before[kind]))) found.push(`the ${kind} ids differ: Local ${show(ids(before[kind]))}, imported ${show(ids(after[kind]))}`)
    for (const record of before[kind]) {
      const other = back.get(record.id)
      if (!other) continue
      for (const field of Object.keys({ ...record, ...other })) {
        if (IMPORT_LOSSES[kind].includes(field) || show(record[field]) === show(other[field])) continue
        found.push(`${record.id} ${field}: Local ${show(record[field])}, imported ${show(other[field])}`)
      }
    }
  }
  const sorted = (links) => links.map(({ kind, from, to }) => `${kind} ${from} ${to}`).sort()
  if (show(sorted(after.links)) !== show(sorted(before.links))) found.push(`the links differ: Local ${show(sorted(before.links))}, imported ${show(sorted(after.links))}`)
  const comment = ({ id, ...rest }) => rest
  if (show(after.comments.map(comment)) !== show(before.comments.map(comment))) found.push(`the comments differ: Local ${show(before.comments.map(comment))}, imported ${show(after.comments.map(comment))}`)
  const updates = (snapshot) => snapshot.epics.flatMap((epic) => (epic.updates ?? []).map(({ health, body }) => ({ epic: epic.id, health, body })))
  if (show(updates(after)) !== show(updates(before))) found.push(`the status updates differ: Local ${show(updates(before))}, imported ${show(updates(after))}`)
  return found
}

/**
 * Removes what the run created and the undo left: the issues and projects among `created` that the test team still holds,
 * then, when `labels` is true, the labels the run created. It never deletes an id the run did not create, and a failed
 * delete does not stop the others. Returns what it removed, the ids it could not remove, and the count of items the team
 * holds that the run did not create.
 */
export async function trashCreated({ client, team, created, labels }) {
  const ours = { issue: new Set(created('issue')), project: new Set(created('project')) }
  const { issues, projects } = await listTestTeamItems({ client, team })
  const removed = { issues: 0, projects: 0, labels: 0 }
  const failed = []
  const remove = async (document, id, kind) => {
    try {
      await client.request(document, { id })
      removed[kind] += 1
    } catch {
      failed.push(id)
    }
  }
  for (const issue of issues.filter((item) => ours.issue.has(item.id))) await remove(ISSUE_DELETE, issue.id, 'issues')
  for (const project of projects.filter((item) => ours.project.has(item.id))) await remove(PROJECT_DELETE, project.id, 'projects')
  if (labels) {
    // A label the undo deleted, or one Linear never created, fails here; only the count of the others matters.
    for (const id of created('label')) {
      try {
        await client.request(LABEL_DELETE, { id })
        removed.labels += 1
      } catch {
        // Nothing to remove.
      }
    }
  }
  const foreign = issues.filter((item) => !ours.issue.has(item.id)).length + projects.filter((item) => !ours.project.has(item.id)).length
  return { removed, failed, foreign }
}

/** Replaces the key in a text, so no error the run prints holds it. */
export function withoutKey(text, env) {
  let key = null
  try {
    key = linearCredential(env).authorization
  } catch {
    key = null
  }
  const value = typeof text === 'string' ? text : JSON.stringify(text)
  return key ? value.split(key).join('[LINEAR_API_KEY]') : value
}

/**
 * The live run without node:test: { setUp, tearDown, cases, state }. cases lists [name, fn] in order; each fn needs the
 * ones before it. tearDown runs after a failure too. buildLiveRun registers them; the offline tests run them over a fake.
 */
export function createLiveRun({ env, fetch, workspace, write = (line) => console.log(line) }) {
  const { fetch: guarded, guard, created } = migrateGuardedFetch({ fetch, workspace })
  const cut = interruptAfter(guarded, 2)
  const client = createLinearClient({ env, tracker: { system: 'linear', scope: { workspace } }, fetch: guarded })
  const state = { team: null, home: null, root: null, steps: null, map: null, exported: false, undone: false }
  const check = (result) => assert.equal(result.code, 0, withoutKey(result.error, env))

  async function setUp() {
    state.home = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-migrate-live-'))
    // preflight checks organization.urlKey against PMKIT_LIVE_WORKSPACE and refuses a test team that holds items.
    const ready = await preflight({ client, env, workspace, guard })
    if (!ready.team) throw new Error(`the workspace has no ${TEST_TEAM.name} team; run contract-live.mjs once to create it`)
    assert.equal(ready.team.key, TEST_TEAM.key)
    // The guard refuses teamCreate and workflowStateCreate, so this finds the team and its states or stops before a write.
    let helper
    try {
      helper = await findOrCreateTestTeam({ client, guard })
    } catch (error) {
      throw new Error(`the test team is not ready: ${withoutKey(error.message, env)}; run contract-live.mjs once`)
    }
    assert.deepEqual(helper.team, ready.team, 'the helper and preflight name the same test team')
    state.team = helper.team
    await adoptTeamIds({ client, team: state.team, guard })
    // gitUserEmail reads the process environment, so the in-process runs need the git isolation of the CLI tests.
    process.env.GIT_CONFIG_GLOBAL = os.devNull
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    state.root = fs.mkdtempSync(path.join(state.home, 'repo-'))
    fs.cpSync(FIXTURE_DIR, state.root, { recursive: true })
    buildLiveFixture(state.root)
    const runEnv = { ...env, PMKIT_HOME: path.join(state.home, 'store'), HOME: state.home, XDG_CONFIG_HOME: path.join(state.home, '.config'), GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
    state.steps = migrateSteps({ root: state.root, env: runEnv, fetch: cut.fetch, workspace, team: state.team })
  }

  async function undo() {
    const dry = await state.steps.undoDry(state.map)
    check(dry)
    const real = await state.steps.undoReal(state.map, dry.data.digest)
    check(real)
    return { dry: dry.data, real: real.data }
  }

  async function tearDown() {
    cut.heal()
    try {
      if (state.exported && !state.undone) {
        write('the undo did not finish; running it again')
        try {
          await undo()
          state.undone = true
        } catch (error) {
          write(`the undo failed again: ${withoutKey(error.message, env)}`)
        }
      }
      if (state.team) {
        const { removed, failed, foreign } = await trashCreated({ client, team: state.team, created, labels: !state.undone })
        if (removed.issues + removed.projects + removed.labels > 0) write(`trashed what the undo left: ${removed.issues} issues, ${removed.projects} projects, ${removed.labels} labels`)
        if (failed.length > 0) write(`could not trash ${failed.length} items the run created: ${failed.join(', ')}; run contract-live.mjs cleanup`)
        if (foreign > 0) write(`the test team holds ${foreign} items this run did not create; run contract-live.mjs cleanup`)
      }
    } catch (error) {
      write(`cleanup failed: ${withoutKey(error.message, env)}`)
    } finally {
      const stats = guard.stats()
      write(`requests ${stats.requests} of ${MIGRATE_CAP}, writes ${stats.writes}, complexity ${stats.complexity}, refused ${stats.refused.length}`)
      write(`rate ${JSON.stringify(stats.rate)}`)
      if (state.home) fs.rmSync(state.home, { recursive: true, force: true })
    }
  }

  const cases = [
    ['an export cut after two mutations resumes from its map by UUID and creates nothing twice', async () => {
      const dry = await state.steps.exportDry()
      check(dry)
      assert.match(dry.data.digest, /^sha256:/)
      state.exported = true
      const failed = await state.steps.exportReal(dry.data.digest)
      assert.notEqual(failed.code, 0, 'the cut export stops')
      const lost = cut.cut()
      assert.ok(lost?.uuid, 'the second mutation was sent and its answer lost')
      cut.heal()
      const again = await state.steps.exportDry()
      check(again)
      const real = await state.steps.exportReal(again.data.digest)
      check(real)
      assert.equal(real.data.done, real.data.total)
      state.map = real.data.map
      const entries = Object.values(readMap(state.root, state.map).records).flatMap((records) => Object.values(records))
      assert.ok(entries.every((entry) => entry.state === 'done'))
      assert.equal(entries.filter((entry) => entry.uuid === lost.uuid).length, 1, 'the resume kept the lost create by its UUID')
      const items = await listTestTeamItems({ client, team: state.team })
      assert.equal(items.issues.length, FIXTURE_TITLES.length, 'no issue was created twice')
      assert.equal(items.projects.length, 1)
    }],

    ['Linear holds the parents, links, project, dates and attribution lines of the Local source', async () => {
      assert.ok(state.map, 'the export did not finish')
      const linear = await readBack({ client, team: state.team })
      assert.deepEqual(linear.issues.map((node) => node.title).sort(), [...FIXTURE_TITLES].sort())
      const found = compareReadBack({ source: localSnapshot(state.root), map: readMap(state.root, state.map), linear })
      assert.deepEqual(found, [])
    }],

    ['import brings the team back into a new Local tracker with the same records', async () => {
      assert.ok(state.map, 'the export did not finish')
      const target = importRepository({ source: state.root, map: state.map, root: fs.mkdtempSync(path.join(state.home, 'import-')) })
      const dry = await state.steps.importDry(target)
      check(dry)
      const real = await state.steps.importReal(target, dry.data.digest)
      check(real)
      assert.equal(real.data.done, real.data.total)
      assert.deepEqual(compareImport({ before: localSnapshot(state.root), after: localSnapshot(target) }), [])
    }],

    ['undo removes what the export created after its own preview', async () => {
      assert.ok(state.map, 'the export did not finish')
      const before = await listTestTeamItems({ client, team: state.team })
      const { dry, real } = await undo()
      state.undone = true
      const planned = (kind) => dry.removals.filter((removal) => removal.kind === kind).map((removal) => removal.uuid).sort()
      assert.deepEqual(planned('issue'), before.issues.map((issue) => issue.id).sort())
      assert.deepEqual(planned('epic'), before.projects.map((project) => project.id).sort())
      assert.equal(real.removed, dry.removals.length)
      const left = await listTestTeamItems({ client, team: state.team })
      assert.deepEqual([left.issues.length, left.projects.length], [0, 0])
    }],
  ]

  return { setUp, tearDown, cases, state }
}

function buildLiveRun(options) {
  const run = createLiveRun(options)
  describe('local-migrate export, import and undo against the test team', () => {
    before(run.setUp)
    after(run.tearDown)
    for (const [name, fn] of run.cases) test(name, fn)
  })
}

function main(env) {
  const reason = skipReason(env)
  if (reason) {
    test('local-migrate export, import and undo against the test team', { skip: reason }, () => {})
    return
  }
  buildLiveRun({ env, fetch: globalThis.fetch, workspace: env.PMKIT_LIVE_WORKSPACE })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.env)
