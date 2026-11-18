// The live checks of the GitHub adapter (PMK-335): the targets they read from the environment, why a group is skipped, the
// guard that lets each check send only its planned writes, the preflight of a throwaway Project, and one function per check.
// Every check runs gh through an injected makeExec(env), so the unit tests drive it against the stateful fake GitHub and
// scripts/lib/github/client-live.mjs, the opt-in node --test entry, drives it against the real gh.
// See docs/specs/2026-11-18-pmk-335-github-live-checks-design.md and docs/runbooks/live-checks-github.md.

import { AssertionError } from 'node:assert'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PmkitError } from '../errors.mjs'
import { isMutation, operationName } from '../graphql.mjs'
import { createGithubClient, HOST_NAME } from './client.mjs'
import { addDays } from '../local/sprints.mjs'
import { ITERATION_FIELD_QUERY, iterationEnd, UPDATE_ITERATIONS } from './cycles.mjs'
import { fetchProject, needsVersionCheck, parseProject, parseRepo } from './discovery.mjs'
import { hostFeatures, issueDocuments } from './documents.mjs'
import { DRAFT_DOCUMENTS } from './draft-issues.mjs'
import { createGithubTracker } from './tracker.mjs'

/** The prefix a throwaway Project's title must start with, and the title of each draft a check adds. */
export const MARKER = 'pmkit-live'
/** A token GitHub cannot know: the shape of a classic token, all zeros. */
export const BAD_TOKEN = `ghp_${'0'.repeat(36)}`

// Each document starts with its operation, as the fake GitHub reads only the first definition.
export const LIVE_DOCUMENTS = Object.freeze({
  VIEWER: 'query PmkitLiveViewer { viewer { login } }',
  SCOPE: 'query PmkitLiveScope { viewer { projectsV2(first: 1) { totalCount } } }',
  PROJECT: `query PmkitLiveProject($owner: String!, $number: Int!) {
  repositoryOwner(login: $owner) { ... on ProjectV2Owner { projectV2(number: $number) { id title items(first: 1) { totalCount } } } }
}`,
  ADD_DRAFT: `mutation PmkitLiveAddDraft($input: AddProjectV2DraftIssueInput!) {
  addProjectV2DraftIssue(input: $input) { projectItem { id } }
}`,
  ITEMS: `query PmkitLiveItems($project: ID!, $field: String!, $first: Int!, $after: String) {
  node(id: $project) {
    ... on ProjectV2 {
      items(first: $first, after: $after) {
        totalCount
        nodes { id type fieldValueByName(name: $field) { ... on ProjectV2ItemFieldIterationValue { iterationId title startDate } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`,
})

const LIVE = 'set PMKIT_LIVE=1 to run the live check'
const SET = {
  repo: 'set PMKIT_LIVE_GITHUB_REPO to owner/name of a github.com repository',
  project: `set PMKIT_LIVE_GITHUB_PROJECT to owner/number of a throwaway Project whose title starts with ${MARKER}`,
  scopeless: 'set PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN to a classic token without the project scope to check the missing-scope error',
  ghes: 'no GHES host configured: set PMKIT_LIVE_GHES_HOST, PMKIT_LIVE_GHES_REPO and PMKIT_LIVE_GHES_PROJECT to convert a draft on GHES',
  ghesRepo: 'set PMKIT_LIVE_GHES_REPO to owner/name of a throwaway repository on the GHES host',
  ghesProject: `set PMKIT_LIVE_GHES_PROJECT to owner/number of a throwaway Project on the GHES host whose title starts with ${MARKER}`,
}

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
const repoOf = (value) => (text(value) && parseRepo(text(value)) ? text(value) : null)
const projectOf = (value) => (text(value) && parseProject(text(value)) ? text(value) : null)
const hostOf = (value) => (text(value) && HOST_NAME.test(text(value)) && needsVersionCheck(text(value)) ? text(value).toLowerCase() : null)

/** The checked targets: { github: { repo, project, scopeless }, ghes: { host, repo, project } }, each value or null. */
export function liveTargets(env) {
  return {
    github: { repo: repoOf(env.PMKIT_LIVE_GITHUB_REPO), project: projectOf(env.PMKIT_LIVE_GITHUB_PROJECT), scopeless: text(env.PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN) },
    ghes: { host: hostOf(env.PMKIT_LIVE_GHES_HOST), repo: repoOf(env.PMKIT_LIVE_GHES_REPO), project: projectOf(env.PMKIT_LIVE_GHES_PROJECT) },
  }
}

/** The reason a variable stops a group: unset, malformed, or false when it holds a usable value. */
function variableReason(env, name, unset, valid, form) {
  if (!text(env[name])) return unset
  return valid(env[name]) ? false : `${name} must be ${form}`
}

const repoReason = (env, name, unset) => variableReason(env, name, unset, repoOf, 'owner/name, such as acme/widgets')
const projectReason = (env, name, unset) => variableReason(env, name, unset, projectOf, 'owner/number, such as acme/7')

function ghesReason(env) {
  if (!text(env.PMKIT_LIVE_GHES_HOST)) return SET.ghes
  if (!HOST_NAME.test(text(env.PMKIT_LIVE_GHES_HOST))) return 'PMKIT_LIVE_GHES_HOST must be a host name, such as github.example.com'
  if (!hostOf(env.PMKIT_LIVE_GHES_HOST)) return 'PMKIT_LIVE_GHES_HOST must name a GitHub Enterprise Server host, not github.com or GHE.com'
  return repoReason(env, 'PMKIT_LIVE_GHES_REPO', SET.ghesRepo) || projectReason(env, 'PMKIT_LIVE_GHES_PROJECT', SET.ghesProject)
}

/**
 * Why each group of checks cannot run, or false when it can: { errors, scope, discover, openCycle, ghes }. PMKIT_LIVE=1 comes
 * first for every group, so without it nothing reads another variable.
 */
export function skipReasons(env) {
  if (env.PMKIT_LIVE !== '1') return { errors: LIVE, scope: LIVE, discover: LIVE, openCycle: LIVE, ghes: LIVE }
  const github = repoReason(env, 'PMKIT_LIVE_GITHUB_REPO', SET.repo) || projectReason(env, 'PMKIT_LIVE_GITHUB_PROJECT', SET.project)
  return {
    errors: false,
    scope: text(env.PMKIT_LIVE_GITHUB_SCOPELESS_TOKEN) ? false : SET.scopeless,
    discover: github,
    openCycle: github,
    ghes: ghesReason(env),
  }
}

/** The value of a gh flag in args, or null. */
const flagValue = (args, ...names) => {
  const at = args.findIndex((arg) => names.includes(arg))
  return at >= 0 ? args[at + 1] ?? null : null
}

/**
 * An exec that refuses every write the check did not plan, before gh runs. allow maps a mutation's operation name to a
 * check of its variables; a mutation outside allow, or whose check is false, and any REST call but GET, throw.
 */
export function guardExec(exec, allow = {}) {
  return (cmd, args, options = {}) => {
    if (cmd === 'gh' && args[0] === 'api') {
      if (args.includes('graphql')) {
        const body = JSON.parse(options.input ?? '{}')
        if (isMutation(body.query)) {
          const name = operationName(body.query) ?? '(anonymous)'
          if (!Object.hasOwn(allow, name) || allow[name](body.variables ?? {}) !== true) throw new Error(`the live check refused ${name}`)
        }
      } else {
        const method = flagValue(args, '--method', '-X') ?? 'GET'
        if (method !== 'GET') throw new Error(`the live check refused ${method} ${args.find((arg, index) => index > 0 && !arg.startsWith('-') && !['--method', '-X', '--hostname'].includes(args[index - 1]))}`)
      }
    }
    return exec(cmd, args, options)
  }
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * Checks the throwaway Project a variable names before any write: it exists, its title starts with the marker and it holds no
 * item. Returns { id, title }; any other Project is INVALID_INPUT whose next step names the variable.
 */
export async function preflightProject(client, value, variable) {
  const refuse = (message, nextStep) => new PmkitError('INVALID_INPUT', message, nextStep)
  let node
  try {
    node = (await client.request(LIVE_DOCUMENTS.PROJECT, parseProject(value)))?.repositoryOwner?.projectV2
  } catch (error) {
    if (error?.code !== 'NOT_FOUND') throw error
  }
  if (!node?.id) throw refuse(`GitHub has no Project ${value}, or the gh account cannot see it`, `Create the Project, or name another one in ${variable}`)
  if (!String(node.title).startsWith(MARKER)) throw refuse(`the title of the Project ${value} does not start with ${MARKER}`, `Rename a throwaway Project to start with ${MARKER}, or name one in ${variable}`)
  const count = node.items?.totalCount ?? 0
  if (count > 0) throw refuse(`the Project ${value} holds ${plural(count, 'item')}; empty it, or name another Project`, `Delete its items on GitHub, or name an empty throwaway Project in ${variable}`)
  return { id: node.id, title: node.title }
}

// Criterion 1: the error shapes of the client against github.com. Each check builds its own environment for gh, sends one read
// and writes nothing.

const TOKEN_VARIABLES = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']
const withoutTokens = (env) => Object.fromEntries(Object.entries(env).filter(([name]) => !TOKEN_VARIABLES.includes(name)))
const fail = (message) => { throw new AssertionError({ message }) }

/** A github.com client over makeExec(env), behind a guard that allows no write. */
const githubClient = (env, makeExec) => createGithubClient({ env, host: 'github.com', exec: guardExec(makeExec(env)), retries: 0 })

/** The error a promise rejects with, or null when it resolves. */
async function rejection(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  return null
}

/** Fails unless error has the code, and the message and next step when given. */
function expectError(error, { code, message, nextStep }) {
  const matches = error?.code === code && (message === undefined || error.message === message) && (nextStep === undefined || error.nextStep === nextStep)
  if (matches) return
  const wanted = `${code}${message === undefined ? '' : ` "${message}"`}${nextStep === undefined ? '' : ` with the next step "${nextStep}"`}`
  const got = error ? `${error.code ?? error.name} "${error.message}"${error.nextStep ? ` with the next step "${error.nextStep}"` : ''}` : 'an answer with no error'
  fail(`expected ${wanted}, got ${got}`)
}

/** gh with no token and a config folder with no login answers AUTH with the step gh auth login. */
export async function checkNoLogin({ env, makeExec }) {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-live-gh-'))
  try {
    const child = { ...withoutTokens(env), GH_CONFIG_DIR: config }
    expectError(await rejection(githubClient(child, makeExec).request(LIVE_DOCUMENTS.VIEWER)), { code: 'AUTH', message: 'GitHub CLI is not logged in', nextStep: 'gh auth login' })
    return { asserted: ['gh with no login answers AUTH "GitHub CLI is not logged in" with the next step "gh auth login"'] }
  } finally {
    fs.rmSync(config, { recursive: true, force: true })
  }
}

/** A token GitHub does not know answers AUTH: GitHub refuses it with HTTP 401. */
export async function checkRejectedToken({ env, makeExec }) {
  const error = await rejection(githubClient({ ...withoutTokens(env), GH_TOKEN: BAD_TOKEN }, makeExec).request(LIVE_DOCUMENTS.VIEWER))
  expectError(error, { code: 'AUTH', message: 'GitHub rejected the token of the gh login' })
  if (error.details?.github?.status !== 401) fail(`expected HTTP 401 in the error details, got ${error.details?.github?.status}`)
  return { asserted: ['a token GitHub does not know answers AUTH "GitHub rejected the token of the gh login" (HTTP 401)'] }
}

/** A repository whose owner cannot exist answers NOT_FOUND, with GitHub's NOT_FOUND type in the details. */
export async function checkNotFound({ env, makeExec, random = () => randomBytes(4).toString('hex') }) {
  const owner = `${MARKER}-no-such-owner-${random()}`
  const error = await rejection(githubClient(env, makeExec).request(DRAFT_DOCUMENTS.TARGET, { owner, name: 'x' }))
  expectError(error, { code: 'NOT_FOUND' })
  const type = error.details?.github?.errors?.[0]?.type
  if (type !== 'NOT_FOUND') fail(`expected the GitHub error type NOT_FOUND in the details, got ${type}`)
  return { asserted: ['a repository whose owner does not exist answers NOT_FOUND, type NOT_FOUND'] }
}

/** One read fills the GraphQL rate bucket from GitHub's headers: limit, remaining and used as numbers, the resource and the reset time. */
export async function checkRateHeaders({ env, makeExec }) {
  const client = githubClient(env, makeExec)
  await client.request(LIVE_DOCUMENTS.VIEWER)
  const rate = client.rateLimit()
  if (!rate) fail('GitHub sent no rate-limit headers')
  for (const key of ['limit', 'remaining', 'used']) if (typeof rate[key] !== 'number') fail(`the rate limit has no number ${key}: ${JSON.stringify(rate)}`)
  if (rate.resource !== 'graphql') fail(`expected the rate-limit resource graphql, got ${rate.resource}`)
  if (Number.isNaN(Date.parse(rate.resetAt ?? ''))) fail(`expected an ISO reset time, got ${rate.resetAt}`)
  return { asserted: [`the rate limit reads ${rate.remaining} of ${rate.limit} left on ${rate.resource}, reset at ${rate.resetAt}`] }
}

/** A classic token without the project scope answers AUTH with the step gh auth refresh -s project, and the token is in no text. */
export async function checkMissingScope({ env, makeExec }) {
  const token = liveTargets(env).github.scopeless
  const error = await rejection(githubClient({ ...withoutTokens(env), GH_TOKEN: token }, makeExec).request(LIVE_DOCUMENTS.SCOPE))
  const texts = [error?.message, error?.nextStep, JSON.stringify(error?.details ?? null)].join('\n')
  if (texts.includes(token)) fail('the scopeless token appears in the error the client built')
  expectError(error, { code: 'AUTH', nextStep: 'gh auth refresh -s project' })
  return { asserted: ['a token without the project scope answers AUTH with the next step "gh auth refresh -s project"'] }
}

// Criterion 2: discover against a github.com repository with a Project.

/** A tracker of the target with its discovery cache in a temporary PMKIT_HOME. gh keeps the user's HOME, so it keeps its login. */
async function withTracker({ env, makeExec, host, repo, project, mappings = {}, allow = {}, now = () => new Date() }, use) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-live-home-'))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-live-repo-'))
  try {
    const config = { root, pmkit: { tracker: { system: 'github', scope: { host, repo, project } }, git_host: { system: 'none' }, mappings } }
    const tracker = createGithubTracker(config, { env: { ...env, PMKIT_HOME: home }, exec: guardExec(makeExec(env), allow), now })
    return await use(tracker, config)
  } finally {
    for (const dir of [home, root]) fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** discover reads the repository and its Project: issue types, issue fields, Project fields with an iteration field, Status options. */
export async function checkDiscover({ env, makeExec, write = () => {} }) {
  const { repo, project } = liveTargets(env).github
  return withTracker({ env, makeExec, host: 'github.com', repo, project }, async (tracker) => {
    const view = await tracker.discover({ refresh: true })
    if (view.repo.toLowerCase() !== repo.toLowerCase()) fail(`discover read ${view.repo}, not ${repo}`)
    if (`${view.project?.owner}/${view.project?.number}`.toLowerCase() !== project.toLowerCase()) fail(`discover read no Project ${project}`)
    for (const key of ['issueTypes', 'issueFields', 'projectFields', 'labels', 'members']) if (!Array.isArray(view[key])) fail(`discover returned no ${key} list`)
    const iterations = view.projectFields.filter((field) => field.dataType === 'ITERATION')
    if (iterations.length === 0) fail(`the Project ${project} has no iteration field; add one, as the runbook says`)
    if (view.statusOptions.length === 0) fail(`the Project ${project} has no Status option`)
    const { capabilities } = await tracker.capabilities()
    if (!Array.isArray(capabilities) || capabilities.length === 0) fail('capabilities built no manifest')
    write(`issue types ${view.issueTypes.length}, issue fields ${view.issueFields.length}, Project fields ${view.projectFields.length} (iteration ${iterations.length}), Status options ${view.statusOptions.length}, capabilities ${capabilities.length}`)
    return { asserted: ['discover read the repository and the Project', 'the Project has an iteration field and Status options', 'capabilities built the manifest'] }
  })
}

// Criterion 3: openCycle keeps the iteration of every item, on a throwaway Project of github.com.

const MAX_ITEMS = 6
const ITEM_PAGE = 100
const byStart = (a, b) => a.startDate.localeCompare(b.startDate)
const keepIteration = ({ id, title, startDate, duration }) => ({ id, title, startDate, duration })

/** Runs every cleanup step, even after one fails, and returns the messages of the steps that failed. */
async function cleanUp(steps) {
  const failed = []
  for (const [what, step] of steps) {
    try {
      await step()
    } catch (error) {
      failed.push(`${what}: ${error.message}`)
    }
  }
  return failed
}

/** Runs body, then cleanup; a cleanup failure is reported with the body's own failure, or fails a body that passed. */
async function withCleanup(body, cleanup, write) {
  let result
  let failure = null
  try {
    result = await body()
  } catch (error) {
    failure = error
  }
  const failed = await cleanup()
  for (const line of failed) write(`cleanup failed, ${line}; see "Clean up after a stopped run" in docs/runbooks/live-checks-github.md`)
  if (failure) throw failure
  if (failed.length > 0) fail(`the check passed, but its cleanup failed: ${failed.join('; ')}`)
  return result
}

/** The iteration id of each item of a Project in the field, as Map<item id, iteration id or null>. */
async function itemIterations(client, projectId, field) {
  const { nodes } = await client.paginate(LIVE_DOCUMENTS.ITEMS, { project: projectId, field }, { select: (data) => data.node.items, pageSize: ITEM_PAGE })
  return new Map(nodes.map((node) => [node.id, node.fieldValueByName?.iterationId ?? null]))
}

/**
 * Adds one draft per iteration (up to 6) to the throwaway Project, sets each draft's iteration, runs openCycle through the tracker,
 * and reads every draft back: each must keep its iteration id. Afterwards it deletes the drafts and sends the original iterations
 * back with their ids, which removes the one openCycle added.
 */
export async function checkOpenCycle({ env, makeExec, write = () => {}, now = () => new Date() }) {
  const { repo, project: target } = liveTargets(env).github
  const reader = createGithubClient({ env, host: 'github.com', exec: guardExec(makeExec(env)), retries: 0 })
  const project = await preflightProject(reader, target, 'PMKIT_LIVE_GITHUB_PROJECT')
  const fieldRead = (await fetchProject(reader, target)).project.fields.find((field) => field.dataType === 'ITERATION')
  if (!fieldRead) fail(`the Project ${target} has no iteration field; add one, as the runbook says`)
  const field = (await reader.request(ITERATION_FIELD_QUERY, { project: project.id, field: fieldRead.name }))?.node?.field
  const kept = field?.configuration
  const all = [...(kept?.completedIterations ?? []), ...(kept?.iterations ?? [])].map(keepIteration).sort(byStart)
  if (all.length === 0) fail(`the iteration field ${fieldRead.name} of ${target} has no iteration; add one in the Project settings`)

  const added = new Set()
  const sameProject = (input) => input?.projectId === project.id
  const allow = {
    PmkitLiveAddDraft: ({ input }) => sameProject(input),
    PmkitSetProjectField: ({ input }) => sameProject(input) && input.fieldId === field.id && added.has(input.itemId),
    PmkitDeleteProjectItem: ({ input }) => sameProject(input) && added.has(input.itemId),
    PmkitUpdateIterations: ({ input }) => input?.fieldId === field.id,
  }
  const writer = createGithubClient({ env, host: 'github.com', exec: guardExec(makeExec(env), allow), retries: 0 })
  const docs = issueDocuments(hostFeatures({ host: 'github.com', ghesVersion: null }))
  const expected = new Map()
  let opened = false

  const body = async () => {
    for (const [index, iteration] of all.slice(0, MAX_ITEMS).entries()) {
      const item = (await writer.request(LIVE_DOCUMENTS.ADD_DRAFT, { input: { projectId: project.id, title: `${MARKER} openCycle check ${index + 1}` } })).addProjectV2DraftIssue.projectItem.id
      added.add(item)
      await writer.request(docs.SET_PROJECT_FIELD, { input: { projectId: project.id, itemId: item, fieldId: field.id, value: { iterationId: iteration.id } } })
      expected.set(item, iteration.id)
    }
    const start = addDays(all.map(iterationEnd).sort().at(-1), 1)
    const sprint = await withTracker({ env, makeExec, host: 'github.com', repo, project: target, mappings: { fields: { sprint: `project:${fieldRead.name}` } }, allow, now }, async (tracker) => {
      const viewer = (await tracker.discover()).viewer.id
      opened = true
      return (await tracker.openCycle({ start, name: `${MARKER} ${start}` }, viewer)).after
    })
    const read = await itemIterations(reader, project.id, fieldRead.name)
    const lost = [...expected].filter(([item, iteration]) => read.get(item) !== iteration).map(([item]) => item)
    if (lost.length > 0) fail(`openCycle cleared the iteration of ${lost.length} of ${expected.size} items: ${lost.join(', ')}`)
    return { asserted: [`openCycle added the sprint ${sprint.id}`, `${expected.size} items kept their iteration`] }
  }

  const restore = async () => {
    await writer.request(UPDATE_ITERATIONS, { input: { fieldId: field.id, iterationConfiguration: { startDate: all[0].startDate, duration: kept.duration, iterations: all } } })
    const current = (await reader.request(ITERATION_FIELD_QUERY, { project: project.id, field: fieldRead.name })).node.field.configuration
    const ids = [...current.completedIterations, ...current.iterations].map((iteration) => iteration.id).sort()
    const wanted = all.map((iteration) => iteration.id).sort()
    if (ids.join() !== wanted.join()) throw new Error(`the field holds the iterations ${ids.join(', ')}, not ${wanted.join(', ')}`)
    write(`restored the ${all.length} iterations of the field ${fieldRead.name}`)
  }

  const cleanup = () => cleanUp([
    ...[...added].map((item) => [`deleting the draft ${item}`, () => writer.request(docs.DELETE_PROJECT_ITEM, { input: { projectId: project.id, itemId: item } })]),
    ...(opened ? [[`restoring the iterations of ${fieldRead.name}`, restore]] : []),
  ])
  return withCleanup(body, cleanup, write)
}
