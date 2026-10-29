// The local-migrate commands: the sides of a migration, the export run and the import run.
// See docs/superpowers/specs/2026-10-28-pmk-41-local-migrate-design.md, "Commands" and "Sides".
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { adapterFor } from '../adapters.mjs'
import { loadLocalConfig, loadPmkitConfig, withLocalDefaults } from '../config.mjs'
import { PmkitError } from '../errors.mjs'
import { lineDiff } from '../diff.mjs'
import { setMap, setScalar } from '../yaml-edit.mjs'
import { parseYaml } from '../yaml.mjs'
import { parseMappingFlags, proposeMappings } from '../mappings.mjs'
import { formatError } from '../local/migrations.mjs'
import { readLocalSnapshot } from '../local/migrate-reader.mjs'
import { importTarget, mapImport } from '../local/migrate-fields.mjs'
import { createLocalWriter } from '../local/migrate-writer.mjs'
import { readLinearSnapshot } from '../linear/migrate-reader.mjs'
import { CYCLES_QUERY, ISSUES_BY_IDS } from '../linear/documents.mjs'
import { PROJECT_STATUSES } from '../linear/projects.mjs'
import { exportTarget, mapExport } from '../linear/migrate-fields.mjs'
import { createLinearWriter } from '../linear/migrate-writer.mjs'
import { MIGRATIONS_DIR, chooseMap, createMapStore, listMaps, mapCounts, mapFileName, memoryMapStore, newMap, readMap, sameTarget } from './id-map.mjs'
import { sha256, stableStringify } from './snapshot.mjs'
import { planBudget, planMigration } from './plan.mjs'
import { previewJson, previewText } from './preview.mjs'
import { checkExpect, lowBudget, reconcile, runPlan } from './run.mjs'

const gitIn = (root, ...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })

function requireGit(root, name) {
  const inside = gitIn(root, 'rev-parse', '--is-inside-work-tree')
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    throw new PmkitError('NOT_CONFIGURED', 'this folder is not a git repository, or git is not installed', `${name} needs a git repository: git history is the only way back from a migration`)
  }
}

function requireClean(root, trackerPath) {
  const dirty = gitIn(root, 'status', '--porcelain', '--', trackerPath)
  if (dirty.status !== 0 || dirty.stdout.trim() !== '') {
    throw new PmkitError('CONFLICT', `there are uncommitted changes under ${trackerPath}`, `Commit or discard the changes under ${trackerPath} first`)
  }
}

/**
 * The Local side and the Linear side of a migration, checked in the order of the spec: git, the Local tracker and its format,
 * the clean tree, then the Linear side. The Local side is tracker.path on a Local repository and --path on any other.
 */
export function resolveSides(ctx, { direction, allowDirty = false }) {
  const name = `local-migrate ${direction}`
  requireGit(ctx.root, name)
  const { pmkit, system, pmkitProblems } = loadPmkitConfig(ctx.root, { adapters: ctx.adapters })
  const localPath = (system === 'local' ? pmkit.tracker.path ?? '.issues' : ctx.opt('path') ?? '.issues').split(path.sep).join('/')
  const config = loadLocalConfig(ctx.root, { ...pmkit, tracker: { system: 'local', path: localPath } }, pmkitProblems, { checkFormat: false })
  if (config.format.state !== 'current') throw formatError(config.format)
  if (!allowDirty) requireClean(ctx.root, localPath)
  const scope = system === 'linear' ? pmkit.tracker.scope ?? {} : {}
  const workspace = ctx.opt('workspace') ?? scope.workspace
  const team = ctx.opt('team') ?? scope.team
  if (typeof workspace !== 'string' || typeof team !== 'string') {
    throw new PmkitError('NOT_CONFIGURED', `${name} needs the Linear workspace and team`, 'Pass --workspace <key> --team <KEY>, or run it from a repository whose tracker.scope names them')
  }
  return { local: { root: ctx.root, path: localPath, config }, linear: { workspace, team, mappings: system === 'linear' ? pmkit.mappings ?? {} : {} } }
}

/**
 * The Linear tracker of the migration, from a config that names the workspace, the team and the mappings. Returns its
 * migration handle and a refreshed discovery, because the plan must see the team as it is.
 */
export async function linearHandle(ctx, linear) {
  const adapter = adapterFor('linear', ctx.adapters)
  const pmkit = { tracker: { system: 'linear', scope: { workspace: linear.workspace, team: linear.team } }, mappings: linear.mappings }
  const tracker = await adapter.create({ root: ctx.root, system: 'linear', pmkit }, { now: ctx.now, env: ctx.env })
  const view = await tracker.discover({ refresh: true })
  return { ...tracker.migration, view, raw: view.raw, pmkit, adapter }
}

/** The mappings of the export: the file's, then the flags'. An open question stops with NOT_CONFIGURED and the questions. */
function answerMappings(ctx, handle, linear, localConfig) {
  const defaults = withLocalDefaults({}).types
  const held = localConfig.local?.types ?? []
  const names = Array.isArray(held) ? held.map((type) => (typeof type === 'string' ? type : type?.name)) : Object.keys(held)
  const types = [...new Set([...defaults, ...names.filter((name) => typeof name === 'string')])]
  const description = handle.adapter.describe(handle.raw, handle.view, handle.view.viewer?.id ?? null, types)
  const current = { scope: { workspace: linear.workspace, team: linear.team }, status: linear.mappings.status ?? {}, fields: linear.mappings.fields ?? {}, types: linear.mappings.types }
  const proposal = proposeMappings(description, current, { workspace: linear.workspace, team: linear.team, ...parseMappingFlags(ctx) })
  if (proposal.questions.length > 0) {
    throw new PmkitError('NOT_CONFIGURED', `local-migrate export has open mapping questions: ${proposal.questions.map((question) => question.path).join(', ')}`,
      'Answer them with --type-label, --status or --field, then run the same command again', { mappings: proposal.questions })
  }
  const { status, fields, types: typeLabels } = proposal.values
  return { status, fields, types: typeLabels }
}

/** The records of the finished maps of the same target, by kind and key, so a second export links to them. */
function knownRecords(finished) {
  const known = {}
  for (const { map } of finished) {
    for (const [kind, entries] of Object.entries(map.records ?? {})) {
      for (const [key, entry] of Object.entries(entries)) if (entry.state === 'done') (known[kind] ??= {})[key] = entry
    }
  }
  return known
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function headerOf(snapshot, local, linear, target) {
  const updates = (snapshot.epics ?? []).reduce((sum, epic) => sum + (epic.updates?.length ?? 0), 0)
  return {
    source: `${local.path}/${snapshot.commit ? ` (commit ${snapshot.commit.slice(0, 7)})` : ''}`,
    target: `Linear team ${linear.team} in workspace ${linear.workspace}`,
    sourceCounts: [plural(snapshot.issues.length, 'issue'), plural(snapshot.epics.length, 'epic'), plural(snapshot.sprints.length, 'sprint'),
      plural(snapshot.links.length, 'link'), plural(snapshot.comments.length, 'comment'), plural(updates, 'status update')].join(', '),
    targetCounts: `team ${linear.team} has ${plural(target.states.length, 'state')}, ${plural(target.labels.size, 'label')} and ${plural(target.cycles.length, 'cycle')}`,
  }
}

/**
 * local-migrate export: the checks of resolveSides, the reads of step 0, the Local snapshot, the plan, then the dry run,
 * or the --expect check, the problem refusal, and the run that writes the map after every record.
 */
export async function runExport(ctx) {
  const { local, linear } = resolveSides(ctx, { direction: 'export' })
  const handle = await linearHandle(ctx, linear)
  const { client, discovery } = handle
  const { viewer } = await client.session()
  const as = ctx.opt('as')
  if (typeof as === 'string' && as !== viewer.id) {
    throw new PmkitError('INVALID_INPUT', `Linear records every write as the owner of LINEAR_API_KEY (${viewer.name})`, 'Drop --as, or use a key created by that member')
  }
  const mappings = answerMappings(ctx, handle, linear, local.config)
  const pmkit = { ...handle.pmkit, mappings }
  const team = handle.raw.teams.find((item) => item.key === linear.team)
  if (!team) throw new PmkitError('NOT_CONFIGURED', `the workspace has no team ${linear.team}`, 'Pass --team with a key the workspace has')
  const projectStatuses = (await client.request(PROJECT_STATUSES, {})).projectStatuses.nodes
  const cycles = team.cyclesEnabled
    ? (await client.paginate(CYCLES_QUERY, { filter: { and: [{ team: { key: { eq: team.key } } }] } }, { select: (data) => data.cycles, pageSize: 100 })).nodes
    : []
  const target = exportTarget({ raw: handle.raw, view: handle.view, pmkit, teamKey: linear.team, projectStatuses, cycles })

  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.root, encoding: 'utf8' })
  const snapshot = readLocalSnapshot({ root: ctx.root, config: local.config, commit: head.status === 0 ? head.stdout.trim() : null, now: () => new Date(ctx.now()) })
  const source = { system: 'local', path: local.path }
  const targetSide = { system: 'linear', workspace: linear.workspace, team: linear.team }
  const chosen = chooseMap(ctx.root, { direction: 'export', target: targetSide })
  const known = knownRecords(chosen.finished)
  const started = new Date(ctx.now()).toISOString()
  const at = () => new Date(ctx.now()).toISOString()
  const file = chosen.resume?.file ?? mapFileName(ctx.root, { date: started.slice(0, 10), direction: 'export', system: 'linear' })
  const map = chosen.resume?.map ?? newMap({ direction: 'export', started, source, target: targetSide, mappings })
  const store = ctx.dryRun ? memoryMapStore(file, structuredClone(map)) : createMapStore(ctx.root, file, map)
  const writer = createLinearWriter({ client, discovery, uuid: () => randomUUID() })
  if (chosen.resume) await reconcile(store, writer, { now: at })

  const mapped = mapExport(snapshot, target)
  const plan = planMigration({ direction: 'export', source, target: targetSide, snapshot, mapped, map: chosen.resume ? { file, map: store.map } : null, known })
  const budget = planBudget(plan, client.rateLimit())
  const header = headerOf(snapshot, local, linear, target)
  if (ctx.dryRun) return { data: previewJson(plan, budget), text: previewText(plan, budget, { dryRun: true, header }) }

  checkExpect(plan, ctx.opt('expect'))
  if (plan.problems.length > 0) {
    throw new PmkitError('INVALID_INPUT', `the export has ${plural(plan.problems.length, 'problem')}, the first: ${plan.problems[0].key} ${plan.problems[0].message}`,
      'Fix the problems in the Local tracker, commit, and run the dry run again', { problems: plan.problems })
  }
  const written = await runPlan({ plan, store, writer, known, now: at })
  const next = `commit ${file}`
  const text = [previewText(plan, budget, { header }), '', `done: ${written.done} of ${written.total}`, `next: ${next}`].join('\n')
  return { data: { ...previewJson(plan, budget), map: file, done: written.done, total: written.total, next }, text }
}

/** The issue and epic folders of the Local tracker. The import writes only into a tracker that has none. */
function heldRecords(root, trackerPath) {
  const held = []
  for (const kind of ['issues', 'epics']) {
    const dir = path.join(root, trackerPath, kind)
    if (!fs.existsSync(dir)) continue
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) held.push(entry.name)
  }
  return held
}

/** The Local IDs an import map wrote or started to write, so a resume accepts them. */
function writtenTargets(map) {
  const ids = []
  for (const entries of Object.values(map.records ?? {})) {
    for (const entry of Object.values(entries)) if ((entry.state === 'sent' || entry.state === 'done') && typeof entry.id === 'string') ids.push(entry.id)
  }
  return ids
}

/**
 * A resume accepts its own uncommitted writes (plan Decision 9): HEAD must still be the commit the map recorded, and every
 * changed path must sit under the tracker folder or be the map file. Anything else gives the clean-tree CONFLICT.
 */
function requireOwnChanges(root, trackerPath, resume, commit) {
  const refuse = () => {
    throw new PmkitError('CONFLICT', `there are uncommitted changes under ${trackerPath}`, `Commit or discard the changes under ${trackerPath} first`)
  }
  if (!resume.map.target?.commit || resume.map.target.commit !== commit) refuse()
  const status = gitIn(root, 'status', '--porcelain', '--untracked-files=all')
  if (status.status !== 0) refuse()
  const changed = status.stdout.split('\n').filter(Boolean).map((line) => line.slice(3).replace(/^"|"$/g, ''))
  if (!changed.every((file) => file.startsWith(`${trackerPath}/`) || file === resume.file)) refuse()
}

/** The Local member the owner of LINEAR_API_KEY becomes after the people step, or null when no record names that user. */
function actorOf(mapped, viewer) {
  const created = mapped.records.member.find((record) => record.key === viewer.id)
  if (created) return created.target
  const matched = (mapped.people ?? []).find((person) => person.id === viewer.id)
  return matched?.note?.match(/^matches member (\S+)$/)?.[1] ?? null
}

/**
 * local-migrate import: the checks of resolveSides, the empty-tracker check, the Linear snapshot, the plan, then the dry run,
 * or the --expect check, the problem refusal, and the run that writes the Local files and the map after every record.
 */
export async function runImport(ctx) {
  const { local, linear } = resolveSides(ctx, { direction: 'import', allowDirty: true })
  const targetSide = { system: 'local', path: local.path }
  const chosen = chooseMap(ctx.root, { direction: 'import', target: targetSide })
  const head = gitIn(ctx.root, 'rev-parse', 'HEAD')
  const commit = head.status === 0 ? head.stdout.trim() : null
  if (chosen.resume) requireOwnChanges(ctx.root, local.path, chosen.resume, commit)
  else requireClean(ctx.root, local.path)
  const own = new Set(chosen.resume ? writtenTargets(chosen.resume.map) : [])
  if (heldRecords(ctx.root, local.path).some((name) => !own.has(name))) {
    throw new PmkitError('CONFLICT', 'import needs a Local tracker with no issues and no epics',
      `Move the old records out with git rm -r ${local.path}/issues ${local.path}/epics ${local.path}/sprints, commit, and run the import again`)
  }
  const source = { system: 'linear', workspace: linear.workspace, team: linear.team }
  const exportMaps = listMaps(ctx.root).filter((entry) => entry.map.direction === 'export' && sameTarget(entry.map.target, source)).map((entry) => entry.map)
  // A Local repository has no mappings in its config. The map being resumed, else the newest finished export map of the
  // same team, gives them, so the type labels and the native estimate come back.
  if (Object.keys(linear.mappings).length === 0) linear.mappings = chosen.resume?.map.mappings ?? exportMaps.find((map) => map.finished)?.mappings ?? {}
  const handle = await linearHandle(ctx, linear)
  const { client, discovery } = handle
  const { viewer } = await client.session()
  const { snapshot, readRequests } = await readLinearSnapshot({ client, discovery, teamKey: linear.team, pmkit: handle.pmkit, now: () => new Date(ctx.now()) })
  const target = importTarget({ local: local.config.local, mappings: linear.mappings, exportMaps })
  const mapped = mapImport(snapshot, target, { readRequests })

  const known = knownRecords(chosen.finished)
  const started = new Date(ctx.now()).toISOString()
  const at = () => new Date(ctx.now()).toISOString()
  const file = chosen.resume?.file ?? mapFileName(ctx.root, { date: started.slice(0, 10), direction: 'import', system: 'linear' })
  const map = chosen.resume?.map ?? newMap({ direction: 'import', started, source, target: { ...targetSide, commit }, mappings: linear.mappings })
  const store = ctx.dryRun ? memoryMapStore(file, structuredClone(map)) : createMapStore(ctx.root, file, map)
  const makeWriter = ctx.adapters?.local?.migrateWriter ?? createLocalWriter
  const writer = makeWriter({ root: ctx.root, config: local.config, actor: actorOf(mapped, viewer), now: () => new Date(ctx.now()) })
  if (chosen.resume) await reconcile(store, writer, { now: at })

  const plan = planMigration({ direction: 'import', source, target: targetSide, snapshot, mapped, map: chosen.resume ? { file, map: store.map } : null, known })
  const budget = planBudget(plan, client.rateLimit())
  const header = {
    source: `Linear team ${linear.team} in workspace ${linear.workspace}`,
    target: `${local.path}/`,
    sourceCounts: [plural(snapshot.issues.length, 'issue'), plural(snapshot.epics.length, 'project'), plural(snapshot.sprints.length, 'cycle'),
      plural(snapshot.comments?.length ?? 0, 'comment'), plural(snapshot.people?.length ?? 0, 'user')].join(', '),
    targetCounts: `${local.path}/ has ${plural(target.memberIds.length, 'member')} and no issues`,
  }
  if (ctx.dryRun) return { data: previewJson(plan, budget), text: previewText(plan, budget, { dryRun: true, header }) }

  checkExpect(plan, ctx.opt('expect'))
  if (plan.problems.length > 0) {
    throw new PmkitError('INVALID_INPUT', `the import has ${plural(plan.problems.length, 'problem')}, the first: ${plan.problems[0].key} ${plan.problems[0].message}`,
      'Fix the problems in Linear, and run the dry run again', { problems: plan.problems })
  }
  const written = await runPlan({ plan, store, writer, known, now: at })
  const next = `commit ${local.path}/ and ${file}`
  const text = [previewText(plan, budget, { header }), '', `done: ${written.done} of ${written.total}`, `next: ${next}`].join('\n')
  return { data: { ...previewJson(plan, budget), map: file, done: written.done, total: written.total, next }, text }
}

/** The map of status and undo: the one --file names, else the newest under .pmkit/migrations/. */
function pickMap(ctx) {
  const file = ctx.opt('file')
  if (typeof file === 'string') return { file, map: readMap(ctx.root, file) }
  const maps = listMaps(ctx.root)
  if (maps.length === 0) {
    throw new PmkitError('NOT_FOUND', `no migration map in ${MIGRATIONS_DIR}`, 'Run pmkit local-migrate export --dry-run or pmkit local-migrate import --dry-run')
  }
  return maps[0]
}

const sideName = (side) => (side.system === 'local' ? `Local ${side.path ?? '.issues'}/` : `Linear team ${side.team} in workspace ${side.workspace}`)

function nextOf(file, map, counts) {
  if (!map.finished) return `Run pmkit local-migrate ${map.direction} again to resume`
  const kinds = Object.values(counts.kinds)
  if (kinds.length > 0 && kinds.every((kind) => kind.done === 0 && kind.sent === 0 && kind.failed === 0)) return 'Nothing: pmkit local-migrate undo removed what the map lists'
  return `Commit ${file}, then run pmkit local-migrate switch`
}

/** local-migrate status: the map's sides, its counts by kind and state, its failures and the next step. It sends no request. */
export async function runStatus(ctx) {
  // Loading the config lets a read print the config warning before its own error, as every read does.
  ctx.config()
  const { file, map } = pickMap(ctx)
  const counts = mapCounts(map)
  const next = nextOf(file, map, counts)
  const data = { file, direction: map.direction, source: map.source, target: map.target, started: map.started, finished: map.finished, kinds: counts.kinds, failed: counts.failed, next }
  const text = [
    `map: ${file}`,
    `${map.direction} ${sideName(map.source)} ${map.direction === 'export' ? 'to' : 'into'} ${sideName(map.target)}`,
    `started: ${map.started}`,
    `finished: ${map.finished ?? 'not finished'}`,
    '',
    ...Object.entries(counts.kinds).map(([kind, c]) => `${kind.padEnd(8)} ${c.done} done, ${c.sent} sent, ${c.failed} failed, ${c.removed} removed`),
    ...(counts.failed.length > 0 ? ['', 'failed', ...counts.failed.map((item) => `  ${item.kind} ${item.key}: ${item.error?.code ?? 'UPSTREAM'} ${item.error?.message ?? ''}`.trimEnd())] : []),
    '',
    `next: ${next}`,
  ]
  return { data, text: text.join('\n') }
}

export const UNDO_READ_REQUESTS = 10
const UNDO_KINDS = [['issue', 'issues'], ['epic', 'projects'], ['label', 'labels']]
const IMPORT_UNDO = ['git restore --source=HEAD -- .issues .pmkit/migrations', 'git clean -fd -- .issues']

/**
 * The removals of an export undo, newest first within a kind: every `done` issue, project, and label the export
 * created. An issue Linear no longer has, or has in its trash, is `gone` and costs no request.
 */
async function undoRemovals(client, map) {
  const doneOf = (kind) => Object.entries(map.records[kind] ?? {})
    .filter(([, entry]) => entry.state === 'done' && entry.uuid && (kind !== 'label' || entry.created === true))
    .reverse()
  const issues = doneOf('issue')
  const nodes = new Map()
  const ids = issues.map(([, entry]) => entry.uuid)
  for (let i = 0; i < ids.length; i += 100) {
    for (const node of (await client.request(ISSUES_BY_IDS, { ids: ids.slice(i, i + 100) })).issues.nodes) nodes.set(node.id, node)
  }
  return UNDO_KINDS.flatMap(([kind]) => doneOf(kind).map(([key, entry]) => {
    const removal = { kind, key, uuid: entry.uuid, id: entry.id ?? entry.uuid, changed: false, gone: false }
    if (kind === 'issue') {
      const node = nodes.get(entry.uuid)
      removal.gone = !node || node.trashed === true
      removal.changed = !removal.gone && Boolean(entry.at) && Date.parse(node.updatedAt) > Date.parse(entry.at)
    }
    return removal
  }))
}

function undoText(file, map, removals, requests, digest, { dryRun }) {
  const out = [`undo ${file}: delete what the export created in ${sideName(map.target)}`, `requests: ${requests}`]
  for (const [kind, title] of UNDO_KINDS) {
    const list = removals.filter((removal) => removal.kind === kind)
    if (list.length === 0) continue
    const width = Math.max(...list.map((removal) => removal.id.length))
    out.push('', title, ...list.map((removal) => `  ${removal.id.padEnd(width)}  ${removal.key}${removal.gone ? '  already gone' : ''}${removal.changed ? '  changed since the migration' : ''}`))
  }
  if (removals.length === 0) out.push('', 'nothing to delete')
  out.push('', `digest: ${digest}`)
  if (dryRun) out.push('dry run: nothing was written')
  return out.join('\n')
}

/**
 * local-migrate undo. On an export map: the full preview of every issue, project and created label it deletes, then,
 * with --expect, one delete at a time, each written to the map as `removed`, so a rerun resumes. On an import map:
 * the git commands that restore the tracker; nothing is written.
 */
export async function runUndo(ctx) {
  const { file, map } = pickMap(ctx)
  if (map.direction === 'import') {
    const text = ['The import wrote only files git can restore. Run:', ...IMPORT_UNDO.map((command) => `  ${command}`), '', 'This command writes nothing.'].join('\n')
    return { data: { file, direction: 'import', commands: IMPORT_UNDO }, text }
  }
  const linear = { workspace: map.target.workspace, team: map.target.team, mappings: {} }
  const { client, discovery } = await linearHandle(ctx, linear)
  const removals = await undoRemovals(client, map)
  const sent = removals.filter((removal) => !removal.gone)
  const requests = UNDO_READ_REQUESTS + sent.length
  const digest = `sha256:${sha256(stableStringify({ undo: file, removals: removals.map(({ kind, key, uuid, changed, gone }) => ({ kind, key, uuid, changed, gone })) }))}`
  const strip = (removal) => ({ kind: removal.kind, key: removal.key, uuid: removal.uuid, id: removal.id, changed: removal.changed, gone: removal.gone })
  const data = { file, direction: 'export', removals: removals.map(strip), changed: removals.filter((removal) => removal.changed).length, requests, digest }
  if (ctx.dryRun) return { data, text: undoText(file, map, removals, requests, digest, { dryRun: true }) }

  const expect = ctx.opt('expect')
  if (typeof expect !== 'string') {
    throw new PmkitError('INVALID_INPUT', 'local-migrate undo deletes records in Linear and needs the digest of its preview', 'Run pmkit local-migrate undo --dry-run, then pass its digest with --expect')
  }
  checkExpect({ digest }, expect)
  const store = createMapStore(ctx.root, file, map)
  const writer = createLinearWriter({ client, discovery, uuid: () => randomUUID() })
  let removed = 0
  for (const removal of removals) {
    const entry = store.entry(removal.kind, removal.key)
    if (!removal.gone) {
      const rate = client.rateLimit()
      if (lowBudget(rate)) {
        const resetAt = rate.requests?.resetAt ?? rate.complexity?.resetAt ?? 'the reset'
        throw new PmkitError('RATE_LIMITED', `stopped before Linear's request limit: ${removed} of ${removals.length} records are removed`, `Run pmkit local-migrate undo --dry-run again after ${resetAt} to resume`)
      }
      try {
        await writer.remove(removal.kind, entry)
      } catch (caught) {
        const error = caught instanceof PmkitError ? caught : new PmkitError('UPSTREAM', caught.message, 'Fix the cause, then run pmkit local-migrate undo --dry-run again to resume')
        error.nextStep = 'Fix the cause, then run pmkit local-migrate undo --dry-run again to resume'
        throw error
      }
    }
    store.set(removal.kind, removal.key, { ...entry, state: 'removed' })
    removed++
  }
  const next = `commit ${file}`
  return { data: { ...data, removed, next }, text: [undoText(file, map, removals, requests, digest, { dryRun: false }), '', `removed: ${removed} of ${removals.length}`, `next: ${next}`].join('\n') }
}

const CONFIG_FILE = '.pmkit/config.yaml'
const SWITCH_DIRECTION = { linear: 'export', local: 'import' }

/** The map switch reads: --file, else the newest map of the direction --to needs. No map is NOT_FOUND; a map of the other direction is INVALID_INPUT. */
function switchMap(ctx, to) {
  const wrong = new PmkitError('INVALID_INPUT', `switch --to ${to} needs a finished ${SWITCH_DIRECTION[to]} map`, 'Run pmkit local-migrate status to list the maps')
  const file = ctx.opt('file')
  // With no map at all, pickMap gives the NOT_FOUND of status and undo.
  const picked = typeof file === 'string' ? pickMap(ctx) : (listMaps(ctx.root).length === 0 ? pickMap(ctx) : listMaps(ctx.root).find((entry) => entry.map.direction === SWITCH_DIRECTION[to]))
  if (!picked || picked.map.direction !== SWITCH_DIRECTION[to]) throw wrong
  const { failed } = mapCounts(picked.map)
  if (!picked.map.finished) throw new PmkitError('CONFLICT', `the migration in ${picked.file} is not finished`, 'Run pmkit local-migrate status')
  if (failed.length > 0) throw new PmkitError('CONFLICT', `the migration in ${picked.file} has ${plural(failed.length, 'failed record')}`, 'Run pmkit local-migrate status')
  return picked
}

/** The edits of .pmkit/config.yaml for the switch, as [key path, edit] pairs. */
function switchEdits(map, to) {
  if (to === 'local') return [[['tracker', 'system'], (text, key) => setScalar(text, key, 'local')], [['tracker', 'path'], (text, key) => setScalar(text, key, map.target.path ?? '.issues')]]
  const edits = [
    [['tracker', 'system'], (text, key) => setScalar(text, key, 'linear')],
    [['tracker', 'scope', 'workspace'], (text, key) => setScalar(text, key, map.target.workspace)],
    [['tracker', 'scope', 'team'], (text, key) => setScalar(text, key, map.target.team)],
  ]
  for (const name of ['status', 'fields', 'types']) {
    const value = map.mappings?.[name]
    if (value && typeof value === 'object' && !Array.isArray(value)) edits.push([['mappings', name], (text, key) => setMap(text, key, value)])
  }
  return edits
}

/**
 * local-migrate switch: writes tracker.system and the side of a finished map to .pmkit/config.yaml. --to linear writes
 * the scope and the mappings, --to local the path. It sends no request, writes no other file and never commits.
 */
export async function runSwitch(ctx) {
  const to = ctx.opt('to')
  if (!Object.hasOwn(SWITCH_DIRECTION, to)) throw new PmkitError('INVALID_INPUT', 'local-migrate switch needs --to linear or --to local', 'Run pmkit local-migrate switch --to linear --dry-run or pmkit local-migrate switch --to local --dry-run')
  const { file, map } = switchMap(ctx, to)
  const full = path.join(ctx.root, CONFIG_FILE)
  const before = fs.readFileSync(full, 'utf8')
  const from = parseYaml(before)?.tracker?.system ?? null
  if (from === to) {
    const data = { file, from, to, changes: [], diff: '', written: false }
    return { data, text: `tracker.system is already ${to} in ${CONFIG_FILE}; nothing to write` }
  }
  let after = before
  const changes = []
  for (const [key, apply] of switchEdits(map, to)) {
    const next = apply(after, key)
    if (next !== after) changes.push(key.join('.'))
    after = next
  }
  const diff = lineDiff(before, after)
  const written = !ctx.dryRun
  if (written) fs.writeFileSync(full, after)
  const next = written ? `Commit ${CONFIG_FILE}` : `Run pmkit local-migrate switch --to ${to} to write it`
  const data = { file, from, to, changes, diff, written, next }
  const text = [`switch ${CONFIG_FILE} from ${from} to ${to}, from ${file}`, '', diff.trimEnd(), '', written ? `written: ${CONFIG_FILE}` : 'dry run: nothing written', `next: ${next}`]
  return { data, text: text.join('\n') }
}
