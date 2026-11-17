// The GitHub GraphQL client. See docs/specs/2026-11-16-pmk-85-github-graphql-client-design.md and ADR 0007.
// Every call runs `gh api graphql`, so the gh login is the credential. The client reads no variable from env and never sees a token.

import { PmkitError } from '../errors.mjs'
import { isMutation, paginateConnection } from '../graphql.mjs'
import { hideAbsolutePaths } from '../paths.mjs'
import { defaultExec, INSTALL_STEP } from './host.mjs'

// Labels of letters, digits and dashes, joined by dots, with an optional port. A value that starts with - never matches.
export const HOST_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/i
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
function noAnswer(result, { mutation, host, tool = 'gh api graphql' }) {
  const stderr = result.stderr ?? ''
  const details = { github: { status: null, errors: [] } }
  if (stderr.includes('gh auth login')) {
    return { error: new PmkitError('AUTH', 'GitHub CLI is not logged in', `gh auth login${hostStep(host)}`, details), retry: false }
  }
  const line = hideAbsolutePaths(oneLine(firstLine(stderr).replace(/^gh: /, '')))
  if (/^error connecting to /i.test(line)) return unconfirmed(line, mutation, details)
  const detail = line || `exit status ${result.status}`
  if (mutation) return unconfirmed(detail, true, details)
  return { error: new PmkitError('UPSTREAM', `${tool} failed: ${detail}`, 'Check the output of the same command in a terminal', details), retry: false }
}

/** The parts of an answer the error rows read: the reply, its errors, details, the first message and every text to search. */
function readReply(answer, stderr) {
  let reply
  try {
    reply = JSON.parse(answer.body)
  } catch {
    reply = undefined
  }
  const isObject = reply !== null && typeof reply === 'object' && !Array.isArray(reply)
  const errors = isObject && Array.isArray(reply.errors) ? reply.errors : []
  // A REST-style refusal (401, 403) carries { message } instead of errors.
  const restMessage = isObject && typeof reply.message === 'string' ? reply.message : ''
  return {
    reply: isObject ? reply : null,
    errors,
    types: errors.map((error) => error?.type),
    details: { github: { status: answer.status, errors: errors.map((error) => ({ type: error?.type ?? null, code: error?.extensions?.code ?? null, path: error?.path ?? null })) } },
    message: oneLine(errors[0]?.message ?? restMessage) || `HTTP ${answer.status}`,
    texts: [...errors.map((error) => String(error?.message ?? '')), restMessage, stderr].join('\n'),
  }
}

const isRateLimited = ({ types, texts }, status) => types.includes('RATE_LIMITED') || status === 429 || (status === 403 && /rate limit/i.test(texts))

/** The rows where GitHub refused the login, its token or its pace: AUTH or RATE_LIMITED, never retried. Null when none matches. */
function refusal(read, { status, headers }, host) {
  const fail = (code, text, nextStep) => ({ error: new PmkitError(code, text, nextStep, read.details), retry: false })
  if (status === 401) return fail('AUTH', 'GitHub rejected the token of the gh login', `Run gh auth login${hostStep(host)}, or fix the token in GH_TOKEN or GH_ENTERPRISE_TOKEN`)
  const scopes = read.errors.find((error) => error?.type === 'INSUFFICIENT_SCOPES')
  if (scopes) return fail('AUTH', `The gh login lacks a scope this query needs: ${oneLine(scopes.message)}`, `gh auth refresh -s ${scopeOf(scopes.message)}${hostStep(host)}`)
  if (/not accessible by personal access token/i.test(read.texts)) {
    return fail('AUTH', `GitHub refused the personal access token: ${read.message}`, `Give the token read and write access to Projects and Issues in its GitHub settings, or unset GH_TOKEN and run gh auth refresh -s project${hostStep(host)}`)
  }
  // GitHub's own wording, so a name that holds "SAML" in an echoed message does not match.
  if (/protected by organization SAML enforcement/i.test(read.texts)) {
    return fail('AUTH', `The organization's single sign-on blocks the gh token: ${read.message}`, "Authorize the gh token for the organization's single sign-on on GitHub, then retry")
  }
  if (isRateLimited(read, status)) return { error: rateLimited(headers, read.details), retry: false }
  if (read.types.includes('FORBIDDEN') || status === 403) return fail('AUTH', `GitHub refused the request for the gh login: ${read.message}`, ACCESS_STEP)
  return null
}

/** A body that is not a GraphQL envelope, or one with no errors and no data. Null when the body is readable. */
function unreadable(read, status, mutation) {
  const hasEnvelope = read.reply !== null && (read.reply.data !== undefined || read.reply.errors !== undefined)
  const hasData = read.reply?.data !== null && typeof read.reply?.data === 'object'
  if (hasEnvelope && (read.errors.length > 0 || hasData)) return null
  // An unreadable answer to a mutation does not say whether GitHub applied the change.
  if (mutation) return unconfirmed(`unreadable answer (HTTP ${status})`, true, read.details)
  return { error: new PmkitError('UPSTREAM', `GitHub returned an unreadable answer (HTTP ${status})`, 'Update the GitHub CLI and retry', read.details), retry: false }
}

/** The GraphQL errors of a readable answer, and a status that is not 2xx. Null for a success. */
function answerError(read, status, mutation) {
  const fail = (code, text, nextStep) => ({ error: new PmkitError(code, text, nextStep, read.details), retry: false })
  const notFound = read.errors.find((error) => error?.type === 'NOT_FOUND')
  if (notFound) return fail('NOT_FOUND', `GitHub found nothing: ${oneLine(notFound.message)}`, 'Check the owner, repository and Project number, and that the gh account can see them')
  // A parse or validation error has no type: GitHub refused the document itself.
  if (read.errors.length > 0 && !read.types[0]) return fail('UPSTREAM', `GitHub rejected pmkit's query: ${read.message}`, 'Update pmkit; if it still fails, report the query error')
  if (read.errors.length > 0) return fail('UPSTREAM', `GitHub answered with an error: ${read.message}`, "Check the request against GitHub's message")
  if (status >= 200 && status < 300) return null
  if (mutation) return unconfirmed(`HTTP ${status}`, true, read.details)
  return fail('UPSTREAM', `GitHub answered HTTP ${status}`, RETRY_STEP)
}

/**
 * Reads one answer. Returns { data } on success, or { error, retry } where retry says whether a query may be sent again.
 * The rows follow the order of the spec's error table.
 */
function classify(answer, stderr, { mutation, host }) {
  const read = readReply(answer, stderr)
  const refused = refusal(read, answer, host)
  if (refused) return refused
  if (answer.status >= 500) return unconfirmed(`HTTP ${answer.status}`, mutation, read.details)
  return unreadable(read, answer.status, mutation) ?? answerError(read, answer.status, mutation) ?? { data: read.reply.data }
}

/**
 * Reads the answer to a REST call. Returns { data } (the parsed body) or { error, retry }, like classify.
 * A taken milestone title is CONFLICT; any other 4xx is UPSTREAM with the message of GitHub.
 */
function classifyRest(answer, stderr, { mutation, host, path, body }) {
  const read = readReply(answer, stderr)
  const refused = refusal(read, answer, host)
  if (refused) return refused
  if (answer.status >= 500) return unconfirmed(`HTTP ${answer.status}`, mutation, read.details)
  const fail = (code, text, nextStep) => ({ error: new PmkitError(code, text, nextStep, read.details), retry: false })
  if (answer.status >= 200 && answer.status < 300) {
    if (answer.body.trim() === '') return { data: null }
    try {
      return { data: JSON.parse(answer.body) }
    } catch {
      // Falls through to the unreadable row.
    }
    if (mutation) return unconfirmed(`unreadable answer (HTTP ${answer.status})`, true, read.details)
    return fail('UPSTREAM', `GitHub returned an unreadable answer (HTTP ${answer.status})`, 'Update the GitHub CLI and retry')
  }
  const taken = Array.isArray(read.reply?.errors) && read.reply.errors.some((error) => error?.code === 'already_exists')
  if (taken && /\/milestones$/.test(path)) {
    return fail('CONFLICT', `GitHub already has a milestone titled ${body?.title}`, 'Use another title, or reuse the existing milestone')
  }
  return fail('UPSTREAM', `GitHub answered with an error: ${read.message}`, "Check the request against GitHub's message")
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

  /** One gh run, read by classifier. The same row handles a gh failure, a timeout and a bad answer for GraphQL and REST. */
  function attempt(ghArgs, input, mutation, classifier, tool) {
    let result
    try {
      result = run('gh', ghArgs, { ...(input === undefined ? {} : { input }), timeout: timeoutMs })
    } catch (error) {
      if (error?.code === 'ENOENT') throw new PmkitError('NOT_CONFIGURED', 'gh is not installed', INSTALL_STEP)
      if (error?.code === 'ENOBUFS') throw new PmkitError('UPSTREAM', 'gh api graphql output is too large to read', 'Ask for fewer nodes per page')
      if (error?.code === 'ETIMEDOUT') return unconfirmed(`timed out after ${timeoutMs / 1000} s`, mutation, { github: { status: null, errors: [] } })
      throw error
    }
    const answer = parseIncluded(result.stdout ?? '')
    if (!answer) return noAnswer(result, { mutation, host, tool })
    rate = readRate(answer.headers) ?? rate
    return classifier(answer, result.stderr ?? '')
  }

  const attemptGraphql = (query, variables, mutation) =>
    attempt(args, JSON.stringify({ query, variables }), mutation, (answer, stderr) => classify(answer, stderr, { mutation, host }), 'gh api graphql')

  // One logical call. A query is sent again after a timeout, no connection or HTTP 5xx; a mutation is sent once.
  async function withRetries(mutation, once) {
    const attempts = mutation ? 1 : retries + 1
    for (let index = 0; ; index += 1) {
      assertRoom()
      const result = once()
      if (!result.error) return result.data
      if (!result.retry || index + 1 >= attempts) throw result.error
      await sleep(DELAYS[Math.min(index, DELAYS.length - 1)])
    }
  }

  const send = (query, variables) => {
    const mutation = isMutation(query)
    return withRetries(mutation, () => attemptGraphql(query, variables, mutation))
  }

  /** One REST call. A method other than GET is a write: sent once, and an answer that is missing is unconfirmed. */
  async function rest(method, path, body) {
    if (typeof method !== 'string' || !/^[A-Z]+$/.test(method)) throw new TypeError('rest needs an HTTP method in capitals')
    if (typeof path !== 'string' || path === '' || path.startsWith('-')) throw new TypeError('rest needs a path')
    const mutation = method !== 'GET'
    const ghArgs = ['api', ...(host ? ['--hostname', host] : []), '--method', method, path, '--include', ...(body === undefined ? [] : ['--input', '-'])]
    const input = body === undefined ? undefined : JSON.stringify(body)
    return withRetries(mutation, () =>
      attempt(ghArgs, input, mutation, (answer, stderr) => classifyRest(answer, stderr, { mutation, host, path, body }), 'gh api'),
    )
  }

  async function request(document, variables = {}) {
    if (typeof document !== 'string' || document.trim() === '') throw new TypeError('request needs a GraphQL document')
    return send(document, variables)
  }

  const paginate = (document, variables = {}, options = {}) =>
    paginateConnection(request, document, variables, options, {
      maxPageSize: MAX_PAGE,
      broken: (name) => new PmkitError('UPSTREAM', `GitHub returned a broken page for ${name}`, RETRY_STEP),
    })

  function rateLimit() {
    if (!rate) return null
    return { limit: rate.limit, remaining: rate.remaining, used: rate.used, resource: rate.resource, resetAt: isoOf(rate.resetMs) }
  }

  return Object.freeze({ request, paginate, rest, rateLimit })
}
