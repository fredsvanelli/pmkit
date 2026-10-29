// The local-migrate commands: the sides of a migration, the export run and the import run.
// See docs/superpowers/specs/2026-10-28-pmk-41-local-migrate-design.md, "Commands" and "Sides".
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { adapterFor } from '../adapters.mjs'
import { loadLocalConfig, loadPmkitConfig, withLocalDefaults } from '../config.mjs'
import { PmkitError } from '../errors.mjs'
import { parseMappingFlags, proposeMappings } from '../mappings.mjs'
import { formatError } from '../local/migrations.mjs'
import { readLocalSnapshot } from '../local/migrate-reader.mjs'
import { importTarget, mapImport } from '../local/migrate-fields.mjs'
import { createLocalWriter } from '../local/migrate-writer.mjs'
import { readLinearSnapshot } from '../linear/migrate-reader.mjs'
import { CYCLES_QUERY } from '../linear/documents.mjs'
import { PROJECT_STATUSES } from '../linear/projects.mjs'
import { exportTarget, mapExport } from '../linear/migrate-fields.mjs'
import { createLinearWriter } from '../linear/migrate-writer.mjs'
import { chooseMap, createMapStore, listMaps, mapFileName, memoryMapStore, newMap, sameTarget } from './id-map.mjs'
import { planBudget, planMigration } from './plan.mjs'
import { previewJson, previewText } from './preview.mjs'
import { checkExpect, reconcile, runPlan } from './run.mjs'

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
export function resolveSides(ctx, { direction }) {
  const name = `local-migrate ${direction}`
  requireGit(ctx.root, name)
  const { pmkit, system, pmkitProblems } = loadPmkitConfig(ctx.root, { adapters: ctx.adapters })
  const localPath = (system === 'local' ? pmkit.tracker.path ?? '.issues' : ctx.opt('path') ?? '.issues').split(path.sep).join('/')
  const config = loadLocalConfig(ctx.root, { ...pmkit, tracker: { system: 'local', path: localPath } }, pmkitProblems, { checkFormat: false })
  if (config.format.state !== 'current') throw formatError(config.format)
  requireClean(ctx.root, localPath)
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
  const { local, linear } = resolveSides(ctx, { direction: 'import' })
  if (heldRecords(ctx.root, local.path).length > 0) {
    throw new PmkitError('CONFLICT', 'import needs a Local tracker with no issues and no epics',
      `Move the old records out with git rm -r ${local.path}/issues ${local.path}/epics ${local.path}/sprints, commit, and run the import again`)
  }
  const handle = await linearHandle(ctx, linear)
  const { client, discovery } = handle
  const { viewer } = await client.session()
  const { snapshot, readRequests } = await readLinearSnapshot({ client, discovery, teamKey: linear.team, pmkit: handle.pmkit, now: () => new Date(ctx.now()) })
  const source = { system: 'linear', workspace: linear.workspace, team: linear.team }
  const targetSide = { system: 'local', path: local.path }
  const exportMaps = listMaps(ctx.root).filter((entry) => entry.map.direction === 'export' && sameTarget(entry.map.target, source)).map((entry) => entry.map)
  const target = importTarget({ local: local.config.local, mappings: linear.mappings, exportMaps })
  const mapped = mapImport(snapshot, target, { readRequests })

  const chosen = chooseMap(ctx.root, { direction: 'import', target: targetSide })
  const known = knownRecords(chosen.finished)
  const started = new Date(ctx.now()).toISOString()
  const at = () => new Date(ctx.now()).toISOString()
  const file = chosen.resume?.file ?? mapFileName(ctx.root, { date: started.slice(0, 10), direction: 'import', system: 'linear' })
  const map = chosen.resume?.map ?? newMap({ direction: 'import', started, source, target: targetSide, mappings: linear.mappings })
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
