// The live checks of the GitHub adapter (PMK-335): the targets they read from the environment, why a group is skipped, the
// guard that lets each check send only its planned writes, the preflight of a throwaway Project, and one function per check.
// Every check runs gh through an injected makeExec(env), so the unit tests drive it against the stateful fake GitHub and
// scripts/lib/github/client-live.mjs, the opt-in node --test entry, drives it against the real gh.
// See docs/specs/2026-11-18-pmk-335-github-live-checks-design.md and docs/runbooks/live-checks-github.md.

import { PmkitError } from '../errors.mjs'
import { isMutation, operationName } from '../graphql.mjs'
import { HOST_NAME } from './client.mjs'
import { needsVersionCheck, parseProject, parseRepo } from './discovery.mjs'

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
