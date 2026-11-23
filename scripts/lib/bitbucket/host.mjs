// The Bitbucket Cloud git host. See docs/superpowers/specs/2026-11-23-pmk-81-bitbucket-cloud-git-host-design.md ("The host").
// Every method returns the shape the GitHub host returns, so the commands read either host the same way.

import { PmkitError } from '../errors.mjs'
import { createGitLocal, refArg } from '../git-local.mjs'
import { createBitbucketClient } from './client.mjs'

const STATES = { OPEN: 'OPEN', MERGED: 'MERGED', DECLINED: 'CLOSED', SUPERSEDED: 'CLOSED' }
const BUCKETS = { SUCCESSFUL: 'pass', FAILED: 'fail', STOPPED: 'cancel', INPROGRESS: 'pending' }
// GitHub's status context states, which risks reads: FAILURE and ERROR fail, PENDING waits.
const CONTEXT_STATES = { SUCCESSFUL: 'SUCCESS', FAILED: 'FAILURE', STOPPED: 'ERROR', INPROGRESS: 'PENDING' }
const REVIEW_STATES = { approved: 'APPROVED', changes_requested: 'CHANGES_REQUESTED' }
const ALL_STATES = Object.keys(STATES)
// gh lists up to 200 open pull requests; the Bitbucket host reads as many.
const LIST_LIMIT = 200
// A pull request with more statuses than this is not a case pmkit meets; the limit only bounds the read.
const STATUS_LIMIT = 1000
// GitHub refuses a diff over its limit; Bitbucket answers these two, and a body over this size is treated the same.
const DIFF_REFUSED = new Set([406, 413])
const MAX_DIFF = 50 * 1024 * 1024

function prNumber(number) {
  if (!Number.isInteger(number) || number < 1) throw new PmkitError('INVALID_INPUT', `pull request number "${number}" is not valid`, 'Pass a pull request number')
  return number
}

/** The participants who approved or asked for changes, as GitHub reviews. */
function reviewsOf(raw) {
  return (raw.participants ?? [])
    .filter((p) => REVIEW_STATES[p.state])
    .map((p) => ({ author: { login: p.user?.nickname ?? null }, state: REVIEW_STATES[p.state], submittedAt: p.participated_on ?? null }))
}

/** A Bitbucket pull request in the GitHub host's view shape; with `detail`, also its base and reviews in `detail`. */
function toPullRequest(raw, { detail = false } = {}) {
  const pr = {
    number: raw.id,
    url: raw.links?.html?.href ?? null,
    title: raw.title,
    state: STATES[raw.state] ?? raw.state,
    isDraft: raw.draft === true,
    headRefName: raw.source?.branch?.name ?? null,
    author: { login: raw.author?.nickname ?? null, is_bot: raw.author?.type === 'app_user' },
    mergedAt: raw.state === 'MERGED' ? (raw.updated_on ?? null) : null,
  }
  return detail ? { ...pr, detail: { baseRefName: raw.destination?.branch?.name ?? null, reviews: reviewsOf(raw) } } : pr
}

export function createBitbucketHost({ root, env, repo, fetch, exec }) {
  // Created on the first Bitbucket call: the git-only methods must work without BITBUCKET_TOKEN.
  let client
  const api = () => (client ??= createBitbucketClient({ env, repo, fetch }))

  /** The pull request of a number or a head branch, or null. A head with several takes the open one, else the newest, as gh does. */
  async function getPullRequest(selector, { detail = false } = {}) {
    if (selector?.number !== undefined) {
      const number = prNumber(selector.number)
      try {
        return toPullRequest(await api().get(`pullrequests/${number}`), { detail })
      } catch (error) {
        if (error instanceof PmkitError && error.httpStatus === 404) return null
        throw error
      }
    }
    if (selector?.head === undefined || selector.head === '') {
      throw new PmkitError('INVALID_INPUT', 'getPullRequest needs a number or a head', 'Pass a pull request number or a branch name')
    }
    const head = refArg('head', selector.head)
    // Bitbucket's query language quotes strings with "; a quote or backslash in the name is escaped so it cannot end the string.
    const q = `source.branch.name="${head.replace(/[\\"]/g, '\\$&')}"`
    const page = await api().get('pullrequests', { q, state: ALL_STATES, sort: '-created_on', pagelen: 50 })
    const values = page?.values ?? []
    const found = values.find((pr) => pr.state === 'OPEN') ?? values[0]
    return found ? toPullRequest(found, { detail }) : null
  }

  const statuses = async (number) => (await api().list(`pullrequests/${number}/statuses`, { pagelen: 100 }, { limit: STATUS_LIMIT })).values

  return {
    system: 'bitbucket',
    ...createGitLocal({ root, env, exec }),

    getPullRequest,

    async openPullRequest({ title, body, head, base, draft }) {
      refArg('head', head)
      refArg('base', base)
      const created = await api().post('pullrequests', { title, description: body, source: { branch: { name: head } }, destination: { branch: { name: base } }, draft: draft === true })
      return toPullRequest(created)
    },

    async markReady(number) {
      return toPullRequest(await api().put(`pullrequests/${prNumber(number)}`, { draft: false }))
    },

    async prChecks(number) {
      return (await statuses(prNumber(number))).map((s) => ({
        name: s.name ?? s.key,
        state: s.state,
        bucket: BUCKETS[s.state] ?? null,
        link: s.url ?? null,
        // A Pipelines status links to its result page, whose number is the build number `ci logs --run` takes. Other CI has none.
        runId: Number(/\/pipelines\/results\/(\d+)/.exec(s.url ?? '')?.[1]) || null,
      }))
    },

    /** The base branch name and the head commit (Bitbucket's short hash, which branchHas reads) of a pull request. */
    async prRefs(number) {
      const raw = await api().get(`pullrequests/${prNumber(number)}`)
      return { baseRefName: raw.destination?.branch?.name ?? null, headRefOid: raw.source?.commit?.hash ?? null }
    },

    /** The diff text, or null when Bitbucket refuses its size; the caller then reads the local diff. */
    async prDiff(number) {
      let text
      try {
        text = await api().getText(`pullrequests/${prNumber(number)}/diff`)
      } catch (error) {
        if (error instanceof PmkitError && DIFF_REFUSED.has(error.httpStatus)) return null
        throw error
      }
      return text.length > MAX_DIFF ? null : text
    },

    /** The open pull requests, newest first, each with its build statuses as GitHub status contexts. */
    async listPullRequests() {
      const { values } = await api().list('pullrequests', { state: 'OPEN', sort: '-created_on', pagelen: 50 }, { limit: LIST_LIMIT })
      const prs = []
      for (const raw of values) {
        let statusCheckRollup
        try {
          statusCheckRollup = (await statuses(raw.id)).map((s) => ({ context: s.key, state: CONTEXT_STATES[s.state] ?? s.state }))
        } catch (error) {
          // A refused read leaves the checks unknown (risks counts the pull request as not failing); anything else stops the list.
          if (!(error instanceof PmkitError) || error.code !== 'UPSTREAM' || error.httpStatus !== 403) throw error
          statusCheckRollup = null
        }
        const { number, url, title, headRefName, isDraft, author } = toPullRequest(raw)
        prs.push({ number, url, title, headRefName, isDraft, updatedAt: raw.updated_on ?? null, author, statusCheckRollup })
      }
      return prs
    },
  }
}
