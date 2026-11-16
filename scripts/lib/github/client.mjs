// The GitHub GraphQL client. See docs/specs/2026-11-16-pmk-85-github-graphql-client-design.md and ADR 0007.
// Every call runs `gh api graphql`, so the gh login is the credential. The client reads no variable from env and never sees a token.

import { PmkitError } from '../errors.mjs'
import { isMutation, operationName } from '../graphql.mjs'
import { hideAbsolutePaths } from '../paths.mjs'
import { defaultExec, INSTALL_STEP } from './host.mjs'

// Labels of letters, digits and dashes, joined by dots, with an optional port. A value that starts with - never matches.
const HOST_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/i
const MAX_PAGE = 100
const DELAYS = [500, 2000]
const RETRY_STEP = 'Retry, and check githubstatus.com if it keeps failing'
const CONFIRM_STEP = 'Check on GitHub whether the change was applied before you retry'
const ACCESS_STEP = 'Check that the gh account can read and write the repository and its Project'

const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
const firstLine = (text) => text.split(/\r?\n/).find((line) => line.trim()) ?? ''

/**
 * Splits the stdout of `gh api --include` into { status, headers, body }, with header names in lower case,
 * or returns null when stdout does not start with a status line, as when gh failed before GitHub answered.
 */
export function parseIncluded(stdout) {
  const status = /^HTTP\/[\d.]+ (\d{3})[^\r\n]*(?:\r?\n|$)/.exec(stdout ?? '')
  if (!status) return null
  const rest = stdout.slice(status[0].length)
  const blank = /(?:^|\r?\n)\r?\n/.exec(rest)
  const head = blank ? rest.slice(0, blank.index) : rest
  const headers = {}
  for (const line of head.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
  }
  return { status: Number(status[1]), headers, body: blank ? rest.slice(blank.index + blank[0].length) : '' }
}

/** ` -h <host>` for any host but github.com, because gh auth without -h acts on github.com. */
const hostStep = (host) => (host && host.toLowerCase() !== 'github.com' ? ` -h ${host}` : '')

/** The scope to ask for: the first one GitHub names, or project when it names a Project scope or none. */
function scopeOf(message) {
  const list = /following scopes: \[([^\]]*)\]/.exec(String(message ?? ''))?.[1] ?? ''
  const scopes = [...list.matchAll(/'([a-z_:]+)'/gi)].map((match) => match[1])
  if (scopes.length === 0 || scopes.some((scope) => /^(?:read:)?project$/.test(scope))) return 'project'
  return scopes[0]
}

const toNumber = (raw) => {
  if (raw === undefined || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** The rate-limit headers of an answer, or null when it has none. resetMs is in milliseconds. */
function readRate(headers) {
  if (headers['x-ratelimit-limit'] === undefined && headers['x-ratelimit-remaining'] === undefined) return null
  const reset = toNumber(headers['x-ratelimit-reset'])
  return {
    limit: toNumber(headers['x-ratelimit-limit']),
    remaining: toNumber(headers['x-ratelimit-remaining']),
    used: toNumber(headers['x-ratelimit-used']),
    resource: headers['x-ratelimit-resource'] ?? null,
    resetMs: reset === null ? null : reset * 1000,
  }
}

const isoOf = (ms) => (ms === null || Number.isNaN(new Date(ms).getTime()) ? null : new Date(ms).toISOString())

function rateLimitError(nextStep, details) {
  return new PmkitError('RATE_LIMITED', "GitHub's rate limit for this login is used up", nextStep, details)
}

/** The wait a rate-limited answer asks for: Retry-After first, then the reset time when the limit is at 0. */
function rateLimited(headers, details) {
  const after = toNumber(headers['retry-after'])
  if (after !== null) return rateLimitError(`Wait ${after} s and retry`, details)
  const rate = readRate(headers)
  const resetAt = rate?.remaining === 0 ? isoOf(rate.resetMs) : null
  return rateLimitError(resetAt ? `Wait until ${resetAt} and retry` : 'Wait a few minutes and retry', details)
}

/** A failure where the answer never came: retried for a query, handed to the user for a mutation. */
function unconfirmed(reason, mutation, details) {
  if (mutation) return { error: new PmkitError('UPSTREAM', `GitHub did not confirm the change: ${reason}`, CONFIRM_STEP, details), retry: false }
  return { error: new PmkitError('UPSTREAM', `GitHub did not answer: ${reason}`, RETRY_STEP, details), retry: true }
}

/** A gh run that printed no answer: no login, no connection, or a failure of gh itself. */
function noAnswer(result, { mutation, host }) {
  const stderr = result.stderr ?? ''
  const details = { github: { status: null, errors: [] } }
  if (stderr.includes('gh auth login')) {
    return { error: new PmkitError('AUTH', 'GitHub CLI is not logged in', `gh auth login${hostStep(host)}`, details), retry: false }
  }
  const line = hideAbsolutePaths(oneLine(firstLine(stderr).replace(/^gh: /, '')))
  if (/^error connecting to /i.test(line)) return unconfirmed(line, mutation, details)
  const detail = line || `exit status ${result.status}`
  if (mutation) return unconfirmed(detail, true, details)
  return { error: new PmkitError('UPSTREAM', `gh api graphql failed: ${detail}`, 'Check the output of the same command in a terminal', details), retry: false }
}

/**
 * Reads one answer. Returns { data } on success, or { error, retry } where retry says whether a query may be sent again.
 * The rows follow the order of the spec's error table.
 */
function classify(answer, stderr, { mutation, host }) {
  const { status, headers } = answer
  let reply
  try {
    reply = JSON.parse(answer.body)
  } catch {
    reply = undefined
  }
  const isObject = reply !== null && typeof reply === 'object' && !Array.isArray(reply)
  const errors = isObject && Array.isArray(reply.errors) ? reply.errors : []
  const details = {
    github: { status, errors: errors.map((error) => ({ type: error?.type ?? null, code: error?.extensions?.code ?? null, path: error?.path ?? null })) },
  }
  // A REST-style refusal (401, 403) carries { message } instead of errors.
  const restMessage = isObject && typeof reply.message === 'string' ? reply.message : ''
  const message = oneLine(errors[0]?.message ?? restMessage) || `HTTP ${status}`
  const texts = [...errors.map((error) => String(error?.message ?? '')), restMessage, stderr].join('\n')
  const types = errors.map((error) => error?.type)
  const fail = (code, text, nextStep) => ({ error: new PmkitError(code, text, nextStep, details), retry: false })

  if (status === 401) return fail('AUTH', 'GitHub rejected the token of the gh login', `Run gh auth login${hostStep(host)}, or fix the token in GH_TOKEN or GH_ENTERPRISE_TOKEN`)
  const scopes = errors.find((error) => error?.type === 'INSUFFICIENT_SCOPES')
  if (scopes) return fail('AUTH', `The gh login lacks a scope this query needs: ${oneLine(scopes.message)}`, `gh auth refresh -s ${scopeOf(scopes.message)}${hostStep(host)}`)
  if (/not accessible by personal access token/i.test(texts)) {
    return fail('AUTH', `GitHub refused the personal access token: ${message}`, `Give the token read and write access to Projects and Issues in its GitHub settings, or unset GH_TOKEN and run gh auth refresh -s project${hostStep(host)}`)
  }
  if (/\bSAML\b/.test(texts)) return fail('AUTH', `The organization's single sign-on blocks the gh token: ${message}`, "Authorize the gh token for the organization's single sign-on on GitHub, then retry")
  if (types.includes('RATE_LIMITED') || status === 429 || (status === 403 && /rate limit/i.test(texts))) return { error: rateLimited(headers, details), retry: false }
  if (types.includes('FORBIDDEN') || status === 403) return fail('AUTH', `GitHub refused the request for the gh login: ${message}`, ACCESS_STEP)
  if (status >= 500) return unconfirmed(`HTTP ${status}`, mutation, details)
  const hasEnvelope = isObject && (reply.data !== undefined || reply.errors !== undefined)
  const hasData = isObject && reply.data !== null && typeof reply.data === 'object'
  if (!hasEnvelope || (errors.length === 0 && !hasData)) {
    // An unreadable answer to a mutation does not say whether GitHub applied the change.
    if (mutation) return unconfirmed(`unreadable answer (HTTP ${status})`, true, details)
    return fail('UPSTREAM', `GitHub returned an unreadable answer (HTTP ${status})`, 'Update the GitHub CLI and retry')
  }
  const notFound = errors.find((error) => error?.type === 'NOT_FOUND')
  if (notFound) return fail('NOT_FOUND', `GitHub found nothing: ${oneLine(notFound.message)}`, 'Check the owner, repository and Project number, and that the gh account can see them')
  // A parse or validation error has no type: GitHub refused the document itself.
  if (errors.length > 0 && !errors[0]?.type) return fail('UPSTREAM', `GitHub rejected pmkit's query: ${message}`, 'Update pmkit; if it still fails, report the query error')
  if (errors.length > 0) return fail('UPSTREAM', `GitHub answered with an error: ${message}`, "Check the request against GitHub's message")
  if (status < 200 || status >= 300) {
    if (mutation) return unconfirmed(`HTTP ${status}`, true, details)
    return fail('UPSTREAM', `GitHub answered HTTP ${status}`, RETRY_STEP)
  }
  return { data: reply.data }
}

export function createGithubClient({
  root,
  env,
  host,
  exec,
  timeoutMs = 30_000,
  retries = 2,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}) {
  if (host !== undefined && host !== null && (typeof host !== 'string' || !HOST_NAME.test(host))) {
    throw new PmkitError('INVALID_INPUT', `GitHub host "${String(host)}" is not a host name`, 'Use a host name such as github.example.com, with no scheme or path')
  }
  const run = exec ?? defaultExec({ root, env })
  const args = ['api', ...(host ? ['--hostname', host] : []), 'graphql', '--include', '--input', '-']
  let rate = null

  /** Throws RATE_LIMITED, with no call, when the last answer said the limit is at 0 until a future time. */
  function assertRoom() {
    if (rate?.remaining === 0 && rate.resetMs !== null && rate.resetMs > now()) {
      throw rateLimitError(`Wait until ${isoOf(rate.resetMs)} and retry`)
    }
  }

  function attempt(query, variables, mutation) {
    let result
    try {
      result = run('gh', args, { input: JSON.stringify({ query, variables }), timeout: timeoutMs })
    } catch (error) {
      if (error?.code === 'ENOENT') throw new PmkitError('NOT_CONFIGURED', 'gh is not installed', INSTALL_STEP)
      if (error?.code === 'ENOBUFS') throw new PmkitError('UPSTREAM', 'gh api graphql output is too large to read', 'Ask for fewer nodes per page')
      if (error?.code === 'ETIMEDOUT') return unconfirmed(`timed out after ${timeoutMs / 1000} s`, mutation, { github: { status: null, errors: [] } })
      throw error
    }
    const answer = parseIncluded(result.stdout ?? '')
    if (!answer) return noAnswer(result, { mutation, host })
    rate = readRate(answer.headers) ?? rate
    return classify(answer, result.stderr ?? '', { mutation, host })
  }

  // One logical call. A query is sent again after a timeout, no connection or HTTP 5xx; a mutation is sent once.
  async function send(query, variables) {
    const mutation = isMutation(query)
    const attempts = mutation ? 1 : retries + 1
    for (let index = 0; ; index += 1) {
      assertRoom()
      const result = attempt(query, variables, mutation)
      if (!result.error) return result.data
      if (!result.retry || index + 1 >= attempts) throw result.error
      await sleep(DELAYS[Math.min(index, DELAYS.length - 1)])
    }
  }

  async function request(document, variables = {}) {
    if (typeof document !== 'string' || document.trim() === '') throw new TypeError('request needs a GraphQL document')
    return send(document, variables)
  }

  const positiveInteger = (value) => Number.isInteger(value) && value >= 1

  async function paginate(document, variables = {}, options = {}) {
    const { select, pageSize = MAX_PAGE, limit, maxPages } = options
    if (typeof select !== 'function') throw new TypeError('paginate needs a select function')
    if (!positiveInteger(pageSize) || pageSize > MAX_PAGE) throw new TypeError(`pageSize must be an integer from 1 to ${MAX_PAGE}`)
    if (maxPages !== undefined && !positiveInteger(maxPages)) throw new TypeError('maxPages must be an integer of at least 1')
    if (limit !== undefined && !positiveInteger(limit)) throw new TypeError('limit must be an integer of at least 1')
    const cap = maxPages ?? (limit === undefined ? 10 : Infinity)
    const broken = () => new PmkitError('UPSTREAM', `GitHub returned a broken page for ${operationName(document) ?? 'an anonymous query'}`, RETRY_STEP)
    const nodes = []
    let after = null
    for (let pages = 1; ; pages += 1) {
      const first = limit === undefined ? pageSize : Math.min(pageSize, limit - nodes.length)
      const data = await request(document, { ...variables, first, after })
      let connection
      try {
        connection = select(data)
      } catch {
        throw broken()
      }
      if (!Array.isArray(connection?.nodes) || connection.pageInfo === null || typeof connection.pageInfo !== 'object') throw broken()
      nodes.push(...connection.nodes)
      if (connection.pageInfo.hasNextPage !== true) return { nodes: nodes.slice(0, limit), hasMore: false }
      const cursor = connection.pageInfo.endCursor
      if (typeof cursor !== 'string' || cursor === '' || cursor === after) throw broken()
      if ((limit !== undefined && nodes.length >= limit) || pages >= cap) return { nodes: nodes.slice(0, limit), hasMore: true }
      after = cursor
    }
  }

  function rateLimit() {
    if (!rate) return null
    return { limit: rate.limit, remaining: rate.remaining, used: rate.used, resource: rate.resource, resetAt: isoOf(rate.resetMs) }
  }

  return Object.freeze({ request, paginate, rateLimit })
}
