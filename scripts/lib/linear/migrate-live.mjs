// Opt-in live run of local-migrate export and undo against the test team of the sandbox workspace (PMK-41).
// It writes, so it is gated twice: PMKIT_LIVE=1 and PMKIT_LIVE_WORKSPACE, the URL key the key must belong to.
// `npm test` does not load it (the name does not end in .test.mjs). Without the gate, every test is skipped with one reason.
//
//   set -a; . ./.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WORKSPACE=<url key> node scripts/lib/linear/migrate-live.mjs
//
// The run uses PMK-39's sandbox helper: preflight checks the URL key and refuses a test team that holds items, and every
// request goes through createGuardedFetch with MIGRATE_ALLOWLIST, the 11 mutations export and undo send. Each rule accepts
// only the test team's id, its workflow states, the workspace's project statuses and type labels, and ids the run created.
// The run sends at most MIGRATE_CAP requests, plus MIGRATE_RESERVE for the deletes of cleanup.
// It does not create the test team: run contract-live.mjs once first.
//
// Steps: build a five-issue Local fixture in a temporary repository, run the export dry run, run the export with its
// digest in --expect, read the team back, run the undo dry run, run the undo with its digest, and check the team is empty.
// The after hook runs the undo again when the export wrote and the undo did not finish.

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
import { linearDescriptor } from './adapter.mjs'
import { createLinearClient } from './client.mjs'
import { linearCredential } from './credential.mjs'
import { skipReason } from './contract-live.mjs'
import { PROJECT_STATUSES } from './projects.mjs'
import { STATES_QUERY, TEST_TEAM, createGuardedFetch, listTestTeamItems, preflight } from './sandbox.mjs'

/** The mutations local-migrate export sends, then the ones local-migrate undo sends. */
export const EXPORT_MUTATIONS = Object.freeze(['issueLabelCreate', 'projectCreate', 'issueCreate', 'issueRelationCreate', 'commentCreate', 'commentResolve', 'projectUpdateCreate', 'issueArchive'])
export const UNDO_MUTATIONS = Object.freeze(['issueDelete', 'projectDelete', 'issueLabelDelete'])

/** The request budget of one run: the offline run sends 57 and the live run adds about 20 reads; the reserve keeps the cleanup deletes going past the cap. */
export const MIGRATE_CAP = 250
export const MIGRATE_RESERVE = 50

/**
 * What each mutation may name. `id`: the mutation takes `id: $id`, an id of that kind the run created. Otherwise it takes
 * `input: $input`: `team` names the key that must hold the test team's id, `teams` the key that must hold exactly that id,
 * `ids` the kinds each other id key may hold, and `create` the kind the run owns `input.id` as once the rule passes.
 * Kinds: `viewer` is the key's owner, `typeLabel` a type label preflight found, every other kind an id the guard owns.
 */
const SPECS = {
  issueLabelCreate: { create: 'label', team: 'teamId', ids: { parentId: ['label'] } },
  projectCreate: { teams: 'teamIds', ids: { statusId: ['projectStatus'], leadId: ['viewer'], memberIds: ['viewer'] } },
  issueCreate: {
    team: 'teamId',
    ids: { stateId: ['state'], labelIds: ['label', 'typeLabel'], parentId: ['issue'], projectId: ['project'], assigneeId: ['viewer'] },
  },
  issueRelationCreate: { ids: { issueId: ['issue'], relatedIssueId: ['issue'] } },
  commentCreate: { ids: { issueId: ['issue'], parentId: ['comment'], projectUpdateId: ['update'] } },
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

/** The guarded fetch of the run, with MIGRATE_ALLOWLIST and the cap. Returns { fetch, guard }. */
export function migrateGuardedFetch({ fetch, workspace, cap = MIGRATE_CAP, reserve = MIGRATE_RESERVE }) {
  let guard = null
  const allowlist = migrateAllowlist((kind, id) => guard.own(kind, id))
  const made = createGuardedFetch({ fetch, workspace, allowlist, cap, reserve })
  guard = made.guard
  return made
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

/** The status and type flags of the export. The fixture uses no task or chore, so those types map to no label. */
export const MAPPING_FLAGS = Object.freeze(['--status', 'in_review=In Review', '--status', 'blocked=In Progress', '--type-label', 'feature=Feature',
  '--type-label', 'bug=Bug', '--type-label', 'task=none', '--type-label', 'chore=none'])

/**
 * The four CLI runs of the live test, in process, every request through `fetch`. Each returns { code, data, error }.
 * The real runs take the digest of their own dry run.
 */
export function migrateSteps({ root, env, fetch, workspace, team }) {
  const adapters = { ...ADAPTERS, linear: linearDescriptor({ fetch }) }
  const cli = async (args) => {
    const result = await runPmkit(args, { cwd: root, env, adapters })
    let parsed = null
    try {
      parsed = JSON.parse(result.stdout)
    } catch {
      parsed = null
    }
    return { code: result.code, data: parsed, error: parsed?.error ?? (result.code === 0 ? null : result.stderr || result.stdout) }
  }
  const exportArgs = ['local-migrate', 'export', '--workspace', workspace, '--team', team.key, ...MAPPING_FLAGS, '--json']
  const undoArgs = (file) => ['local-migrate', 'undo', ...(file ? ['--file', file] : []), '--json']
  return {
    exportDry: () => cli([...exportArgs, '--dry-run']),
    exportReal: (digest) => cli([...exportArgs, '--expect', digest]),
    undoDry: (file) => cli([...undoArgs(file), '--dry-run']),
    undoReal: (file, digest) => cli([...undoArgs(file), '--expect', digest]),
  }
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

function buildLiveRun({ env, fetch, workspace, write = (line) => console.log(line) }) {
  const { fetch: guarded, guard } = migrateGuardedFetch({ fetch, workspace })
  const client = createLinearClient({ env, tracker: { system: 'linear', scope: { workspace } }, fetch: guarded })
  const state = { team: null, home: null, root: null, steps: null, map: null, exported: false, undone: false }

  async function setUp() {
    state.home = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-migrate-live-'))
    const ready = await preflight({ client, env, workspace, guard })
    if (!ready.team) throw new Error(`the workspace has no ${TEST_TEAM.name} team; run contract-live.mjs once to create it`)
    assert.equal(ready.team.key, TEST_TEAM.key)
    state.team = ready.team
    await adoptTeamIds({ client, team: state.team, guard })
    // gitUserEmail reads the process environment, so the in-process runs need the git isolation of the CLI tests.
    process.env.GIT_CONFIG_GLOBAL = os.devNull
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    state.root = fs.mkdtempSync(path.join(state.home, 'repo-'))
    fs.cpSync(path.join(import.meta.dirname, '..', '..', '__fixtures__', 'basic'), state.root, { recursive: true })
    buildLiveFixture(state.root)
    const runEnv = { ...env, PMKIT_HOME: path.join(state.home, 'store'), HOME: state.home, XDG_CONFIG_HOME: path.join(state.home, '.config'), GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
    state.steps = migrateSteps({ root: state.root, env: runEnv, fetch: guarded, workspace, team: state.team })
  }

  async function undo() {
    const dry = await state.steps.undoDry(state.map)
    assert.equal(dry.code, 0, withoutKey(dry.error, env))
    const real = await state.steps.undoReal(state.map, dry.data.digest)
    assert.equal(real.code, 0, withoutKey(real.error, env))
    return { dry: dry.data, real: real.data }
  }

  async function tearDown() {
    try {
      if (state.exported && !state.undone) {
        write('the undo did not finish; running it again')
        await undo()
      }
      if (state.team) {
        const left = await listTestTeamItems({ client, team: state.team, guard })
        if (left.issues.length + left.projects.length > 0) write(`the test team still holds ${left.issues.length} issues and ${left.projects.length} projects; run contract-live.mjs cleanup`)
      }
    } catch (error) {
      write(`cleanup failed: ${withoutKey(error.message, env)}`)
    } finally {
      const stats = guard.stats()
      write(`requests ${stats.requests} of ${MIGRATE_CAP}, writes ${stats.writes}, complexity ${stats.complexity}, refused ${stats.refused.length}`)
      if (state.home) fs.rmSync(state.home, { recursive: true, force: true })
    }
  }

  describe('local-migrate export and undo against the test team', () => {
    before(setUp)
    after(tearDown)

    test('export writes the fixture after its own dry run', async () => {
      const dry = await state.steps.exportDry()
      assert.equal(dry.code, 0, withoutKey(dry.error, env))
      assert.match(dry.data.digest, /^sha256:/)
      state.exported = true
      const real = await state.steps.exportReal(dry.data.digest)
      assert.equal(real.code, 0, withoutKey(real.error, env))
      assert.equal(real.data.done, real.data.total)
      state.map = real.data.map
      const items = await listTestTeamItems({ client, team: state.team, guard })
      assert.deepEqual(items.issues.map((issue) => issue.title).sort(), [...FIXTURE_TITLES].sort())
      assert.equal(items.projects.length, 1)
    })

    test('undo removes what the export created after its own preview', async () => {
      assert.ok(state.map, 'the export did not finish')
      const before = await listTestTeamItems({ client, team: state.team, guard })
      const { dry, real } = await undo()
      state.undone = true
      const planned = (kind) => dry.removals.filter((removal) => removal.kind === kind).map((removal) => removal.uuid).sort()
      assert.deepEqual(planned('issue'), before.issues.map((issue) => issue.id).sort())
      assert.deepEqual(planned('epic'), before.projects.map((project) => project.id).sort())
      assert.equal(real.removed, dry.removals.length)
      const left = await listTestTeamItems({ client, team: state.team, guard })
      assert.deepEqual([left.issues.length, left.projects.length], [0, 0])
    })
  })
}

function main(env) {
  const reason = skipReason(env)
  if (reason) {
    test('local-migrate export and undo against the test team', { skip: reason }, () => {})
    return
  }
  buildLiveRun({ env, fetch: globalThis.fetch, workspace: env.PMKIT_LIVE_WORKSPACE })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.env)
