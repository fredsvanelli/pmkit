// A fake `gh` for tests: it answers `gh api ... meta` and `gh api ... graphql` from a fixture, as the real gh prints them.
// Unit tests call answerGh through an injected exec; the E2E test puts a gh wrapper that calls it first on PATH.
// scripts/fake-gh.mjs is a different fake: it serves the git host commands (pr, run, api) of scripts/lib/github/host.mjs.
//
// A fixture: { meta: { installed_version } | null, graphql: { <operation name>: <reply body> }, login: false, issues }
// A reply body is what GitHub returns, { data } or { errors }. An operation the fixture lacks answers with an UPSTREAM-shaped error,
// unless the fixture has `issues`, the toJSON() of a fake GitHub (scripts/fake-github-issues.mjs): that fake answers, and its new
// state replaces fixture.issues, so a caller that saves the fixture keeps the state between runs.
import { fakeGithubIssuesFrom } from './fake-github-issues.mjs'

const operationOf = (query) => /^\s*(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(query ?? '')?.[1] ?? null

/** The --hostname value of a gh api argv, or null. */
export const hostnameOf = (args) => {
  const at = args.indexOf('--hostname')
  return at >= 0 ? args[at + 1] : null
}

/** What gh prints for args and stdin under the fixture: { status, stdout, stderr }. */
export function answerGh(args, input, fixture) {
  return answerGhWith(args, input, fixture, (name, body) => {
    const canned = fixture.graphql?.[name]
    if (canned !== undefined && canned !== null) return name === 'PmkitRepo' ? withNamedLabels(canned, body.variables ?? {}) : canned
    if (!fixture.issues) return { errors: [{ message: `fake gh has no answer for ${name}` }] }
    const fake = fakeGithubIssuesFrom(fixture.issues)
    const reply = fake.handle(name, body.variables ?? {}, body.query)
    fixture.issues = fake.toJSON()
    return reply
  })
}

/**
 * A repository reply with the labels read by name: each variable l0, l1, ... answers from every label of the reply, the ones
 * past the first page included (repoReply keeps them in allLabels). GitHub matches a label name without case.
 */
export function withNamedLabels(reply, variables) {
  const repository = reply?.data?.repository
  if (!repository) return reply
  const all = repository.allLabels ?? repository.labels?.nodes ?? []
  const named = Object.entries(variables).filter(([key]) => /^l\d+$/.test(key))
  const { allLabels, ...rest } = repository
  const found = Object.fromEntries(named.map(([key, wanted]) => [key, all.find((label) => label.name.toLowerCase() === String(wanted).toLowerCase()) ?? null]))
  return { ...reply, data: { ...reply.data, repository: { ...rest, ...found } } }
}

const REASONS = { 200: 'OK', 201: 'Created', 204: 'No Content', 404: 'Not Found', 422: 'Unprocessable Entity' }

/** What gh prints for args and stdin, with each GraphQL reply from answer(operationName, body): { status, stdout, stderr }.
 * An optional rest(method, path, body) answers the other api calls with { status, body } (an HTTP status and a JSON body), or
 * null for a call it does not know; it prints as gh does with --include, and gh exits 1 on a 4xx or 5xx. */
export function answerGhWith(args, input, fixture, answer, rest) {
  if (args[0] !== 'api') return { status: 1, stdout: '', stderr: `fake gh: unknown command ${args[0]}` }
  if (fixture.login === false) return { status: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' }
  const words = args.slice(1).filter((arg, index, list) => arg !== '--hostname' && list[index - 1] !== '--hostname')
  if (words[0] === 'meta') {
    if (!fixture.meta) return { status: 1, stdout: '{"message":"Not Found"}', stderr: 'gh: Not Found (HTTP 404)' }
    return { status: 0, stdout: JSON.stringify(fixture.meta), stderr: '' }
  }
  if (words[0] === 'graphql') {
    let body
    try {
      body = JSON.parse(input ?? '')
    } catch {
      return { status: 1, stdout: '', stderr: 'fake gh: stdin is not JSON' }
    }
    const name = operationOf(body.query)
    const reply = answer(name, body)
    const failed = Array.isArray(reply.errors)
    const head = 'HTTP/2.0 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nX-Ratelimit-Limit: 5000\r\nX-Ratelimit-Remaining: 4999\r\n\r\n'
    return { status: failed ? 1 : 0, stdout: `${head}${JSON.stringify(reply)}`, stderr: failed ? `gh: ${reply.errors[0].message}` : '' }
  }
  const reply = rest ? restReply(rest, args.slice(1), input) : null
  if (reply) return reply
  return { status: 1, stdout: '', stderr: `fake gh: unknown api call ${words.join(' ')}` }
}

/** The gh output of a REST call answered by rest, or null when rest does not know the call. */
function restReply(rest, args, input) {
  const valueFlags = ['--hostname', '--method', '-X', '--input', '-H', '--header', '-f', '-F', '--field', '--raw-field', '--jq', '-q', '--template', '-t']
  const path = args.find((arg, index) => !arg.startsWith('-') && !valueFlags.includes(args[index - 1]))
  const flagAt = args.findIndex((arg) => arg === '--method' || arg === '-X')
  const method = flagAt >= 0 ? args[flagAt + 1] : 'GET'
  let body = null
  if (args.includes('--input') && input) {
    try {
      body = JSON.parse(input)
    } catch {
      return { status: 1, stdout: '', stderr: 'fake gh: stdin is not JSON' }
    }
  }
  const answered = rest(method, path, body)
  if (!answered) return null
  const head = `HTTP/2.0 ${answered.status} ${REASONS[answered.status] ?? 'Status'}\r\nContent-Type: application/json; charset=utf-8\r\nX-Ratelimit-Limit: 5000\r\nX-Ratelimit-Remaining: 4999\r\n\r\n`
  const failed = answered.status >= 400
  return { status: failed ? 1 : 0, stdout: `${head}${JSON.stringify(answered.body)}`, stderr: failed ? `gh: ${answered.body?.message ?? 'error'} (HTTP ${answered.status})` : '' }
}

/** An exec for createGithubClient and the discovery that answers from the fixture and records each call. */
export function fakeGhExec(fixture) {
  const calls = []
  const exec = (cmd, args, { input } = {}) => {
    calls.push({ cmd, args, input })
    return answerGh(args, input, fixture)
  }
  return { exec, calls }
}

const page = (nodes, hasNextPage = false) => ({ nodes, pageInfo: { hasNextPage } })

/** A repository reply: the viewer, the repository with its id, issue types, issue fields and labels. */
export function repoReply({ owner = 'acme', name = 'widgets', ownerType = 'Organization', types, fields, labels, typesMore = false, fieldsMore = false } = {}) {
  return {
    data: {
      viewer: { id: 'U_1', login: 'octocat', name: 'The Octocat' },
      repository: {
        id: 'R_1',
        nameWithOwner: `${owner}/${name}`,
        owner: { login: owner, __typename: ownerType },
        issueTypes: page(types ?? [
          { id: 'IT_1', name: 'Task', description: 'A specific piece of work', isEnabled: true },
          { id: 'IT_2', name: 'Bug', description: 'An unexpected problem', isEnabled: true },
          { id: 'IT_3', name: 'Feature', description: 'A request', isEnabled: true },
          { id: 'IT_4', name: 'Epic', description: 'Old', isEnabled: false },
        ], typesMore),
        ...(fields === null ? {} : {
          issueFields: page(fields ?? [
            { __typename: 'IssueFieldSingleSelect', id: 'IF_1', name: 'Priority', dataType: 'SINGLE_SELECT', options: [{ id: 'O1', name: 'P0' }, { id: 'O2', name: 'P1' }] },
            { __typename: 'IssueFieldNumber', id: 'IF_2', name: 'Effort', dataType: 'NUMBER' },
            { __typename: 'IssueFieldDate', id: 'IF_3', name: 'Start date', dataType: 'DATE' },
            { __typename: 'IssueFieldDate', id: 'IF_4', name: 'Target date', dataType: 'DATE' },
          ], fieldsMore),
        }),
        ...labelLists((labels ?? ['bug', 'documentation']).map((label, index) => ({ id: `LA_${index + 1}`, name: label }))),
      },
    },
  }
}

/** The first 100 labels as GitHub pages them, and every label for the reads by name. */
const labelLists = (all) => ({ labels: page(all.slice(0, 100), all.length > 100), ...(all.length > 100 ? { allLabels: all } : {}) })

/** A Project reply with its fields. status lists the Status options. */
export function projectReply({ number = 7, title = 'Roadmap', status = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done'], extra } = {}) {
  return {
    data: {
      repositoryOwner: {
        projectV2: {
          id: 'PVT_1',
          number,
          title,
          url: `https://github.com/orgs/acme/projects/${number}`,
          fields: page(extra ?? [
            { __typename: 'ProjectV2Field', id: 'PF_0', name: 'Title', dataType: 'TITLE', isIssueField: false },
            { __typename: 'ProjectV2SingleSelectField', id: 'PF_1', name: 'Status', dataType: 'SINGLE_SELECT', isIssueField: false, options: status.map((option, i) => ({ id: `S${i}`, name: option })) },
            { __typename: 'ProjectV2Field', id: 'PF_2', name: 'Story points', dataType: 'NUMBER', isIssueField: false },
            { __typename: 'ProjectV2SingleSelectField', id: 'PF_3', name: 'Priority', dataType: 'SINGLE_SELECT', isIssueField: true, options: [{ id: 'O1', name: 'P0' }] },
            { __typename: 'ProjectV2IterationField', id: 'PF_4', name: 'Sprint', dataType: 'ITERATION', isIssueField: false },
            { __typename: 'ProjectV2Field', id: 'PF_5', name: 'Due', dataType: 'DATE', isIssueField: false },
          ]),
        },
      },
    },
  }
}

/** The users of the repository GitHub can assign, on one page. */
export function assignableReply(users = [{ id: 'U_1', login: 'octocat', name: 'The Octocat' }, { id: 'U_2', login: 'hubot', name: 'Hubot' }]) {
  return { data: { repository: { assignableUsers: { nodes: users, pageInfo: { hasNextPage: false, endCursor: null } } } } }
}

/** The linked Projects of the repository. */
export function linkedReply(projects = [{ number: 7, title: 'Roadmap', owner: 'acme' }]) {
  return { data: { repository: { projectsV2: page(projects.map(({ number, title, owner }) => ({ number, title, owner: { login: owner } }))) } } }
}

export const SCOPE_ERROR = {
  errors: [{ type: 'INSUFFICIENT_SCOPES', message: "Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project'], but your token has only been granted the: ['repo'] scopes." }],
}

/** The fixture of a repository on github.com with a Project. */
export function standardFixture(overrides = {}) {
  return {
    meta: null,
    graphql: { PmkitRepo: repoReply(), PmkitProject: projectReply(), PmkitLinkedProjects: linkedReply(), PmkitAssignableUsers: assignableReply() },
    ...overrides,
  }
}
