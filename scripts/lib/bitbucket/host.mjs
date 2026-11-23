// The Bitbucket Cloud git host. See docs/superpowers/specs/2026-11-23-pmk-81-bitbucket-cloud-git-host-design.md ("The host").
// Every method returns the shape the GitHub host returns, so the commands read either host the same way.

import { PmkitError } from '../errors.mjs'
import { createGitLocal, refArg } from '../git-local.mjs'
import { FAILED_RUN } from '../risks.mjs'
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
// A completed pipeline's result as a GitHub run conclusion; FAILED and ERROR are members of FAILED_RUN.
const CONCLUSIONS = { SUCCESSFUL: 'success', FAILED: 'failure', ERROR: 'failure', STOPPED: 'cancelled' }
const FAILED_STEP = new Set(['FAILED', 'ERROR'])
// gh run list reads 50 runs; `ci logs --run` searches the 500 newest pipelines (spec Q5).
const RUN_LIMIT = 50
const RUN_PAGE = 100
const RUN_PAGES = 5
const STEP_LIMIT = 1000
const ENVIRONMENT_LIMIT = 1000
// The newest deploys of every environment are read, then filtered and sorted here, so neither rests on a server-side filter.
const DEPLOY_SCAN = 500
const DEPLOY_STATES = { SUCCESSFUL: 'success', FAILED: 'failure', STOPPED: 'inactive' }

/** A deployment's state as a GitHub deployment status state, or null when Bitbucket names one pmkit does not know. */
function deployState(state) {
  if (state?.name === 'COMPLETED') return DEPLOY_STATES[state.status?.name] ?? null
  if (state?.name === 'IN_PROGRESS') return 'in_progress'
  if (state?.name === 'UNDEPLOYED') return 'pending'
  return null
}

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

  /** A Bitbucket pipeline as a GitHub workflow run; a run not COMPLETED has no conclusion yet. */
  function toRun(raw) {
    const completed = raw.state?.name === 'COMPLETED'
    const result = raw.state?.result?.name
    return {
      databaseId: raw.build_number,
      workflowName: raw.target?.selector?.pattern ?? raw.target?.selector?.type ?? null,
      status: raw.state?.name ? raw.state.name.toLowerCase() : null,
      conclusion: completed && result ? (CONCLUSIONS[result] ?? result.toLowerCase()) : null,
      url: `https://bitbucket.org/${repo}/pipelines/results/${raw.build_number}`,
      createdAt: raw.created_on ?? null,
      headSha: raw.target?.commit?.hash ?? null,
    }
  }

  const branchPipelines = async (branch) =>
    (await api().list('pipelines', { 'target.branch': refArg('branch', branch), sort: '-created_on', pagelen: RUN_LIMIT }, { limit: RUN_LIMIT })).values

  /** The pipeline of a build number among the 500 newest, read a page at a time so a recent run costs one read. */
  async function pipelineOf(runId) {
    for (let page = 1; page <= RUN_PAGES; page += 1) {
      const answer = await api().get('pipelines', { sort: '-created_on', pagelen: RUN_PAGE, page })
      const found = (answer?.values ?? []).find((p) => p.build_number === runId)
      if (found) return found
      if (!answer?.next) break
    }
    throw new PmkitError('INVALID_INPUT', `pipeline run ${runId} was not found in ${RUN_PAGE * RUN_PAGES} newest runs`, 'Pass the build number of a recent pipeline, or use --branch')
  }

  /** The log of each failed step, under a "== <step name> ==" line. */
  async function failedStepsLog(uuid) {
    const { values } = await api().list(`pipelines/${uuid}/steps`, { pagelen: 100 }, { limit: STEP_LIMIT })
    const parts = []
    for (const step of values.filter((s) => FAILED_STEP.has(s.state?.result?.name))) {
      let text
      try {
        text = await api().getText(`pipelines/${uuid}/steps/${step.uuid}/log`)
      } catch (error) {
        // A step that failed before it ran has no log; Bitbucket answers 404.
        if (!(error instanceof PmkitError) || error.httpStatus !== 404 || error.code !== 'UPSTREAM') throw error
        text = '(Bitbucket has no log for this step)\n'
      }
      parts.push(`== ${step.name ?? step.uuid} ==\n${text}`)
    }
    return parts.join('\n')
  }

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

    /** The 50 newest pipelines of a branch as GitHub workflow runs. */
    async listRuns({ branch }) {
      return (await branchPipelines(branch)).map(toRun)
    },

    /** A pipeline run with its failed steps' log: the given build number, or the newest failed run of a branch (null when none). */
    async ciLogs({ branch, runId } = {}) {
      let raw
      let newerRun
      if (runId !== undefined) {
        if (!Number.isInteger(runId) || runId < 1) throw new PmkitError('INVALID_INPUT', `run id "${runId}" is not valid`, 'Pass the build number of a pipeline')
        raw = await pipelineOf(runId)
      } else {
        const pipelines = await branchPipelines(branch)
        raw = pipelines.find((p) => FAILED_RUN.has(toRun(p).conclusion))
        if (!raw) return null
        // As on GitHub: a newer successful run of the same pipeline makes this failure old news.
        const failed = toRun(raw)
        const newest = pipelines
          .map(toRun)
          .filter((r) => r.workflowName === failed.workflowName && r.status === 'completed' && r.conclusion === 'success' && Date.parse(r.createdAt) > Date.parse(failed.createdAt))
          .reduce((a, r) => (a === null || Date.parse(r.createdAt) > Date.parse(a.createdAt) ? r : a), null)
        newerRun = newest ? { runId: newest.databaseId, conclusion: newest.conclusion, createdAt: newest.createdAt, headSha: newest.headSha } : null
      }
      const run = toRun(raw)
      // A run that succeeded or has not finished has no failed step to read.
      const log = run.conclusion !== null && run.conclusion !== 'success' ? await failedStepsLog(raw.uuid) : ''
      const { databaseId, workflowName, url, conclusion, status, createdAt, headSha } = run
      return { runId: databaseId, workflowName, url, conclusion, status, createdAt, headSha, ...(newerRun === undefined ? {} : { newerRun }), log }
    },

    /**
     * The deployments, newest first, as GitHub deployments. A Bitbucket release names a pipeline, not a git ref, so
     * ref is null and a ref filter matches nothing.
     */
    async listDeploys({ environment, ref, limit = 20 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new PmkitError('INVALID_INPUT', `limit "${limit}" is not valid`, 'Use a whole number from 1 to 100')
      }
      if (ref !== undefined) return []
      const environments = (await api().list('environments', { pagelen: 100 }, { limit: ENVIRONMENT_LIMIT })).values
      const names = new Map(environments.map((e) => [e.uuid, e.name]))
      const { values } = await api().list('deployments', { sort: '-release.created_on', pagelen: 100 }, { limit: DEPLOY_SCAN })
      const createdAt = (d) => d.release?.created_on ?? d.state?.started_on ?? null
      return values
        .map((d) => {
          const state = deployState(d.state)
          const deploy = { id: d.uuid, environment: names.get(d.environment?.uuid) ?? null, ref: null, sha: d.release?.commit?.hash ?? null, createdAt: createdAt(d), state, url: d.release?.url ?? null }
          return state === null ? { ...deploy, statusError: `Bitbucket returned deployment state ${d.state?.status?.name ?? d.state?.name ?? 'none'}` } : deploy
        })
        .filter((d) => environment === undefined || d.environment === environment)
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
        .slice(0, limit)
    },
  }
}
