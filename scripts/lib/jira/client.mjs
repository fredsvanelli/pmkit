// The Jira Cloud REST client. See docs/superpowers/specs/2026-11-22-pmk-75-jira-api-client-design.md and ADR 0013.

import { URLSearchParams } from 'node:url'
import { PmkitError } from '../errors.mjs'
import { secretKeyPaths } from '../user-store.mjs'
import { jiraCredential } from './credential.mjs'

export const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/
const API_PATH = /^\/rest\/(?:api\/3|agile\/1\.0)\/[^?#\s]*$/
const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE'])
const RETRY_STEP = 'Retry, and check status.atlassian.com if it keeps failing'
const CHANGE_STEP = 'Check in Jira whether the change was applied before you retry'
const DELAYS = [500, 2000]

function checkSite(tracker) {
  const site = tracker?.scope?.site
  if (site === undefined || site === null || site === '') throw new PmkitError('NOT_CONFIGURED', 'tracker.scope.site is not set', '/pmkit:setup')
  const host = typeof site === 'string' ? site.toLowerCase() : ''
  if (!HOST.test(host)) {
    throw new PmkitError(
      'NOT_CONFIGURED',
      'tracker.scope.site must be a host such as acme.atlassian.net',
      "Set tracker.scope.site in .pmkit/config.yaml to the site's host, with no https:// or path",
    )
  }
  return host
}

function checkCall(method, path) {
  if (!METHODS.has(method)) throw new TypeError(`unsupported method ${method}`)
  if (typeof path !== 'string' || !API_PATH.test(path) || /\/\.\.?(?:\/|$)/.test(path)) throw new TypeError('path must start with /rest/api/3/ or /rest/agile/1.0/ and hold no query string or dot segment')
}

function queryString(query = {}) {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    for (const item of Array.isArray(value) ? value : [value]) params.append(name, String(item))
  }
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}

/** Jira's error fields from a parsed body: errorMessages (a list) and errors (field to message). */
function jiraErrors(body) {
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  const errorMessages = isObject(body) && Array.isArray(body.errorMessages) ? body.errorMessages.filter((m) => typeof m === 'string') : []
  const errors = isObject(body) && isObject(body.errors) ? body.errors : {}
  return { errorMessages, errors }
}

/** The first of Jira's messages as one line of at most 200 characters. */
function jiraMessage({ errorMessages, errors }) {
  const first = [...errorMessages, ...Object.values(errors)].find((value) => typeof value === 'string' && value.trim() !== '')
  return first === undefined ? 'no message' : first.replace(/\s+/g, ' ').trim().slice(0, 200)
}

const brokenPage = (path) => new PmkitError('UPSTREAM', `Jira returned a broken page for ${path}`, RETRY_STEP)

function checkPageOptions({ pageSize, limit, maxPages }) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new TypeError('pageSize must be an integer from 1 to 100')
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new TypeError('limit must be an integer of at least 1')
  if (maxPages !== undefined && (!Number.isInteger(maxPages) || maxPages < 1)) throw new TypeError('maxPages must be an integer of at least 1')
}

/**
 * Reads where a page leaves the walk: { more, token, cursor, startAt, broken }. A page with nextPageToken is a token list
 * and one with nextPageCursor is a cursor list (Plans); each ends with its token or cursor, a cursor list also at last.
 * An offset list ends at isLast, an empty page or total.
 */
function nextPosition(page, list, { token, cursor, startAt }) {
  const next = page.nextPageToken
  if (typeof next === 'string' && next !== '') return { more: page.isLast !== true, token: next, startAt, broken: next === token }
  if (token !== undefined) return { more: false, token, startAt, broken: false }
  const nextCursor = page.nextPageCursor
  if (typeof nextCursor === 'string' && nextCursor !== '') return { more: page.last !== true, cursor: nextCursor, startAt, broken: nextCursor === cursor }
  if (cursor !== undefined) return { more: false, cursor, startAt, broken: false }
  const offset = startAt + list.length
  const atTotal = typeof page.total === 'number' && offset >= page.total
  // A cursor list's only page has no nextPageCursor and says last, not isLast.
  return { more: page.isLast !== true && page.last !== true && list.length > 0 && !atTotal, token, startAt: offset, broken: false }
}

/** The rate-limit reset as an ISO time: Retry-After seconds first, then X-RateLimit-Reset. Null when neither reads. */
function resetAt(headers, now) {
  const seconds = Number(headers.get('retry-after') ?? '')
  if (headers.get('retry-after')?.trim() && Number.isFinite(seconds) && seconds >= 0) return new Date(now() + seconds * 1000).toISOString()
  const raw = headers.get('x-ratelimit-reset')
  const date = raw ? new Date(raw) : null
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}

export function createJiraClient({
  env,
  tracker,
  fetch = globalThis.fetch,
  timeoutMs = 30_000,
  retries = 2,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}) {
  const secrets = secretKeyPaths(tracker ?? {})
  if (secrets.length > 0) {
    throw new PmkitError(
      'INVALID_INPUT',
      `.pmkit/config.yaml holds a secret-like key at ${secrets.join(', ')}`,
      'Remove it from .pmkit/config.yaml and keep the Jira token in JIRA_API_TOKEN',
    )
  }
  const site = checkSite(tracker)
  const authorization = jiraCredential(env).authorization

  /** A failure where the answer never came: retryable for a read, a hand-off to the user for a write. */
  function unanswered(reason, write, details) {
    if (write) return { error: new PmkitError('UPSTREAM', `Jira did not confirm the change: ${reason}`, CHANGE_STEP, details), retry: false }
    return { error: new PmkitError('UPSTREAM', `Jira did not answer: ${reason}`, RETRY_STEP, details), retry: true }
  }

  /** The reason a request failed without an answer. It never copies the fetch error's message, which can quote a header. */
  function reasonOf(error, signal) {
    if (error?.name === 'TimeoutError' || signal.reason?.name === 'TimeoutError') return `timed out after ${timeoutMs / 1000} s`
    const code = error?.cause?.code
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : 'network error'
  }

  /** Reads one HTTP answer into { data } or { error, retry }. Rows follow the spec's error table, in order. */
  function classify(method, path, status, headers, text) {
    const write = method !== 'GET'
    let body
    try {
      body = text === '' ? undefined : JSON.parse(text)
    } catch {
      body = undefined
    }
    const found = jiraErrors(body)
    const details = { jira: { status, ...found } }
    const captcha = (headers.get('x-seraph-loginreason') ?? '').includes('AUTHENTICATION_DENIED')
    const fail = (code, message, nextStep) => ({ error: new PmkitError(code, message, nextStep, details), retry: false })

    if (captcha) {
      details.jira.captcha = true
      return fail('AUTH', "Jira wants a CAPTCHA before it accepts this account's token", `Sign in to ${site} in a browser once to clear the CAPTCHA, then retry`)
    }
    if (status === 401) {
      return fail('AUTH', 'Jira rejected JIRA_EMAIL and JIRA_API_TOKEN; the token may have expired', 'Create an API token at id.atlassian.com and export JIRA_EMAIL and JIRA_API_TOKEN')
    }
    if (status === 403) return fail('AUTH', `Jira refused the request for this account: ${jiraMessage(found)}`, `Check that the token's owner has the permission in ${site}`)
    if (status === 429) {
      const at = resetAt(headers, now)
      return fail('RATE_LIMITED', "Jira's rate limit for this account is used up", at ? `Wait until ${at} and retry` : 'Wait a few minutes and retry')
    }
    if (status >= 300 && status < 400) {
      return fail('NOT_CONFIGURED', `Jira at ${site} redirected the request (HTTP ${status})`, 'Check tracker.scope.site in .pmkit/config.yaml; a renamed site needs its new host')
    }
    if (status === 400) return fail('INVALID_INPUT', `Jira rejected the request: ${jiraMessage(found)}`, "Check the request against Jira's message")
    if (status === 404) return fail('NOT_FOUND', `Jira found nothing at ${method} ${path}: ${jiraMessage(found)}`, "Check the key or id, and that the token's owner can see it")
    if (status === 409) return fail('CONFLICT', `Jira reported a conflict: ${jiraMessage(found)}`, 'Read the item again and retry')
    if (status >= 500) return unanswered(`HTTP ${status}`, write, details)
    if (status >= 200 && status < 300) {
      if (text === '') return { data: null }
      if (body !== undefined) return { data: body }
      if (write) return unanswered(`unreadable answer (HTTP ${status})`, true, details)
      return fail('UPSTREAM', `Jira returned an unreadable answer (HTTP ${status})`, RETRY_STEP)
    }
    return fail('UPSTREAM', `Jira answered HTTP ${status}: ${jiraMessage(found)}`, RETRY_STEP)
  }

  async function attempt(method, path, url, init) {
    const signal = AbortSignal.timeout(timeoutMs)
    let response
    let text
    try {
      response = await fetch(url, { ...init, method, redirect: 'manual', signal })
      text = await response.text()
    } catch (error) {
      return unanswered(reasonOf(error, signal), method !== 'GET')
    }
    return classify(method, path, response.status, response.headers, text)
  }

  // One logical call. A GET is sent again after a network failure, a timeout or HTTP 5xx; a write is sent once.
  async function send(method, path, { query, body } = {}, { authorize = true } = {}) {
    const headers = { Accept: 'application/json' }
    if (authorize) headers.Authorization = authorization
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const init = { headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }
    const url = `https://${site}${path}${queryString(query)}`
    const attempts = method === 'GET' ? retries + 1 : 1
    for (let index = 0; ; index += 1) {
      const result = await attempt(method, path, url, init)
      if (!result.error) return result.data
      if (!result.retry || index + 1 >= attempts) throw result.error
      await sleep(DELAYS[Math.min(index, DELAYS.length - 1)])
    }
  }

  function notCloud(deploymentType) {
    const name = typeof deploymentType === 'string' && /^\w{1,40}$/.test(deploymentType) ? deploymentType : 'Server or Data Center'
    return new PmkitError('NOT_SUPPORTED', `${site} runs Jira ${name}; pmkit supports Jira Cloud only`, 'Use a Jira Cloud site (ADR 0013)')
  }

  async function loadSession() {
    // serverInfo goes without the credential: the token reaches only a host that said it is Jira Cloud.
    let info
    try {
      info = await send('GET', '/rest/api/3/serverInfo', {}, { authorize: false })
    } catch (error) {
      // A Cloud site answers serverInfo anonymously, so a refusal means another deployment.
      if (error instanceof PmkitError && error.code === 'AUTH') throw notCloud(undefined)
      throw error
    }
    if (info?.deploymentType !== 'Cloud') throw notCloud(info?.deploymentType)
    const myself = await send('GET', '/rest/api/3/myself')
    if (typeof myself?.accountId !== 'string' || myself.accountId === '') {
      throw new PmkitError('UPSTREAM', 'Jira returned no account for this token', RETRY_STEP)
    }
    return { source: 'JIRA_API_TOKEN', site, viewer: { accountId: myself.accountId, displayName: myself.displayName ?? null } }
  }

  let sessionPromise
  function session() {
    sessionPromise ??= loadSession()
    return sessionPromise
  }

  async function request(method, path, options = {}) {
    checkCall(method, path)
    await session()
    return send(method, path, options)
  }

  /** Reads one Jira list, offset (startAt), token (nextPageToken) or cursor (nextPageCursor), into { items, hasMore }. */
  async function paginate(path, { query = {}, key = 'values', pageSize = 50, limit, maxPages } = {}) {
    checkCall('GET', path)
    checkPageOptions({ pageSize, limit, maxPages })
    // Without a limit, a careless call stops at 10 requests, as on Linear (PMK-30).
    const pageCap = maxPages ?? (limit === undefined ? 10 : Infinity)
    const items = []
    let position = { token: undefined, cursor: undefined, startAt: 0 }
    for (let pages = 1; ; pages += 1) {
      const maxResults = Math.min(pageSize, (limit ?? Infinity) - items.length)
      // startAt 0 is every offset list's default, so the first request also suits a token list.
      const where =
        position.token !== undefined
          ? { nextPageToken: position.token }
          : position.cursor !== undefined
            ? { cursor: position.cursor }
            : position.startAt > 0
              ? { startAt: position.startAt }
              : {}
      const page = await request('GET', path, { query: { ...query, maxResults, ...where } })
      const list = page?.[key]
      if (!Array.isArray(list)) throw brokenPage(path)
      items.push(...list)
      const next = nextPosition(page, list, position)
      if (next.broken) throw brokenPage(path)
      position = next
      if (!next.more || items.length >= (limit ?? Infinity) || pages >= pageCap) return { items: items.slice(0, limit), hasMore: next.more }
    }
  }

  return Object.freeze({ request, paginate, session })
}
