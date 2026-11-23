// The Bitbucket Cloud REST client. See docs/superpowers/specs/2026-11-23-pmk-81-bitbucket-cloud-git-host-design.md and ADR 0018.
// Every request goes to https://api.bitbucket.org/2.0/repositories/<workspace>/<repo_slug>, and nowhere else.

import { URLSearchParams } from 'node:url'
import { BITBUCKET_REPO } from '../config.mjs'
import { PmkitError } from '../errors.mjs'
import { bitbucketCredential } from './credential.mjs'

const API = 'https://api.bitbucket.org'
const PATH = /^[a-z_]+(\/[A-Za-z0-9{}_-]+)*$/
const RETRY_STEP = 'Retry, and check bitbucket.status.atlassian.com if it keeps failing'
const CHANGE_STEP = 'Check the pull request on Bitbucket before you retry'
const DELAYS = [500, 2000]
const MAX_REDIRECTS = 3

function checkRepo(repo) {
  const parts = typeof repo === 'string' && BITBUCKET_REPO.test(repo) ? repo.split('/') : []
  // '.' and '..' pass the character class but would walk out of the repository path.
  if (parts.length !== 2 || parts.some((part) => part === '.' || part === '..')) {
    throw new PmkitError('NOT_CONFIGURED', 'git_host.repo must be workspace/repo_slug', 'Set git_host.repo in .pmkit/config.yaml to workspace/repo_slug')
  }
  return parts
}

function checkPath(path) {
  // '' is the repository itself, which setup reads to check the token and the repo.
  if (path !== '' && (typeof path !== 'string' || !PATH.test(path))) throw new TypeError('path must be relative to the repository, such as pullrequests/7')
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

export function createBitbucketClient({
  env,
  repo,
  fetch = globalThis.fetch,
  timeoutMs = 30_000,
  retries = 2,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const [workspace, slug] = checkRepo(repo)
  const authorization = bitbucketCredential(env).authorization
  const token = authorization.slice('Bearer '.length)
  const base = `/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}`

  const urlOf = (path, query) => `${API}${base}${path === '' ? '' : `/${path.split('/').map(encodeURIComponent).join('/')}`}${queryString(query)}`

  /**
   * True when a URL Bitbucket handed back (a next link, a redirect) stays on this repository on api.bitbucket.org.
   * Bitbucket names workspaces and slugs case-insensitively and its links may be lowercase where git_host.repo is not.
   */
  function inRepository(url) {
    const path = url.pathname
    const sameRepo = path.slice(0, base.length).toLowerCase() === base.toLowerCase() && (path.length === base.length || path[base.length] === '/')
    return url.origin === API && url.username === '' && url.password === '' && sameRepo
  }

  /** Bitbucket's error.message from a body as one line of at most 200 characters, with the token cut out in case it is echoed. */
  function bitbucketMessage(text) {
    let body
    try {
      body = JSON.parse(text)
    } catch {
      return 'no message'
    }
    const message = body?.error?.message
    if (typeof message !== 'string' || message.trim() === '') return 'no message'
    return message.split(token).join('[token]').replace(/\s+/g, ' ').trim().slice(0, 200)
  }

  /** A failure where the answer never came: retryable for a read, a hand-off to the user for a write. */
  function unanswered(reason, write) {
    const details = { bitbucket: { reason } }
    if (write) return { error: new PmkitError('UPSTREAM', 'Bitbucket did not confirm the change', CHANGE_STEP, details), retry: false }
    return { error: new PmkitError('UPSTREAM', `Bitbucket did not answer: ${reason}`, RETRY_STEP, details), retry: true }
  }

  /** The reason a request failed without an answer. It never copies the fetch error's message, which can quote a header. */
  function reasonOf(error, signal) {
    if (error?.name === 'TimeoutError' || signal.reason?.name === 'TimeoutError') return `timed out after ${timeoutMs / 1000} s`
    const code = error?.cause?.code
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : 'network error'
  }

  /** An HTTP answer that is not a success, as a PmkitError. httpStatus lets readers that tolerate a refused read keep doing so. */
  function httpError(method, path, status, text) {
    const message = bitbucketMessage(text)
    const fail = (code, summary, nextStep) => {
      const error = new PmkitError(code, summary, nextStep, { bitbucket: { status, message } })
      error.httpStatus = status
      return error
    }
    if (status === 401) {
      return fail('AUTH', 'Bitbucket refused BITBUCKET_TOKEN (HTTP 401): it may have expired or lack a scope', 'Create an Atlassian API token with the Bitbucket scopes and export it as BITBUCKET_TOKEN (/pmkit:setup)')
    }
    if (status === 429) return fail('RATE_LIMITED', "Bitbucket's rate limit for this token is used up", 'Wait a few minutes and retry')
    if (status === 404 && method === 'GET' && path === '') {
      return fail('NOT_CONFIGURED', `git_host.repo ${workspace}/${slug} was not found or the token cannot read it`, '/pmkit:setup')
    }
    if (status === 403) return fail('UPSTREAM', `Bitbucket refused ${method} ${path || 'the repository'} (HTTP 403): ${message}`, `Check that BITBUCKET_TOKEN has the scopes /pmkit:setup lists and can reach ${workspace}/${slug}`)
    if (status >= 300 && status < 400) return fail('UPSTREAM', `Bitbucket redirected ${method} ${path || 'the repository'} (HTTP ${status})`, RETRY_STEP)
    return fail('UPSTREAM', `Bitbucket answered HTTP ${status} to ${method} ${path || 'the repository'}: ${message}`, 'Check the number or name in the request, then retry')
  }

  /**
   * One request: { response, text } or { error, retry }. A text read follows a redirect only while it stays in the
   * repository, so the token never goes to another host; every other call refuses redirects.
   */
  async function attempt(method, path, url, init, { follow }) {
    const signal = AbortSignal.timeout(timeoutMs)
    const write = method !== 'GET'
    let target = url
    for (let hops = 0; ; hops += 1) {
      let response
      let text
      try {
        response = await fetch(target, { ...init, method, redirect: 'manual', signal })
        text = await response.text()
      } catch (error) {
        return unanswered(reasonOf(error, signal), write)
      }
      const status = response.status
      if (follow && status >= 300 && status < 400 && hops < MAX_REDIRECTS) {
        let next
        try {
          next = new URL(response.headers.get('location') ?? '', API)
        } catch {
          next = null
        }
        if (next && inRepository(next)) {
          target = next.href
          continue
        }
      }
      if (status >= 500) {
        const result = unanswered(`HTTP ${status}`, write)
        result.error.httpStatus = status
        return result
      }
      if (status < 200 || status >= 300) return { error: httpError(method, path, status, text), retry: false }
      return { text }
    }
  }

  // One logical call. A GET is sent again after a network failure, a timeout or HTTP 5xx; a write is sent once.
  async function send(method, path, url, { body, text: asText = false } = {}) {
    const headers = { Accept: asText ? 'text/plain' : 'application/json', Authorization: authorization }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const init = { headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }
    const attempts = method === 'GET' ? retries + 1 : 1
    for (let index = 0; ; index += 1) {
      const result = await attempt(method, path, url, init, { follow: asText })
      if (!result.error) {
        if (asText) return result.text
        if (result.text === '') return null
        try {
          return JSON.parse(result.text)
        } catch {
          if (method !== 'GET') throw unanswered('unreadable answer', true).error
          throw new PmkitError('UPSTREAM', `Bitbucket returned an unreadable answer to ${method} ${path || 'the repository'}`, RETRY_STEP)
        }
      }
      if (!result.retry || index + 1 >= attempts) throw result.error
      await sleep(DELAYS[Math.min(index, DELAYS.length - 1)])
    }
  }

  async function get(path, query) {
    checkPath(path)
    return send('GET', path, urlOf(path, query))
  }

  async function getText(path) {
    checkPath(path)
    return send('GET', path, urlOf(path), { text: true })
  }

  async function post(path, body) {
    checkPath(path)
    return send('POST', path, urlOf(path), { body })
  }

  async function put(path, body) {
    checkPath(path)
    return send('PUT', path, urlOf(path), { body })
  }

  /** Reads a paged list into { values, cut }, following next links that stay in the repository, up to limit values. */
  async function list(path, query, { limit } = {}) {
    checkPath(path)
    if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be an integer of at least 1')
    const broken = () => new PmkitError('UPSTREAM', `Bitbucket returned a broken page for ${path || 'the repository'}`, RETRY_STEP)
    const values = []
    let url = urlOf(path, query)
    for (;;) {
      const page = await send('GET', path, url)
      if (!Array.isArray(page?.values)) throw broken()
      values.push(...page.values)
      const next = page.next
      if (next === undefined || next === null) return { values: values.slice(0, limit), cut: values.length > limit }
      if (values.length >= limit) return { values: values.slice(0, limit), cut: true }
      // An empty page that points on could loop forever; a next link elsewhere would carry the token there.
      if (page.values.length === 0 || typeof next !== 'string') throw broken()
      let nextUrl
      try {
        nextUrl = new URL(next)
      } catch {
        throw new PmkitError('UPSTREAM', `Bitbucket returned a next link that is not a URL for ${path}`, RETRY_STEP)
      }
      if (!inRepository(nextUrl)) throw new PmkitError('UPSTREAM', `Bitbucket returned a next link outside ${workspace}/${slug} for ${path}`, RETRY_STEP)
      url = nextUrl.href
    }
  }

  return Object.freeze({ get, getText, list, post, put })
}
