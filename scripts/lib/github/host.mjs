import { spawnSync } from 'node:child_process'
import { PmkitError } from '../errors.mjs'
import { FAILED_RUN } from '../risks.mjs'

// A failed run log can pass the 1 MiB default of spawnSync. 256 MiB leaves room for the largest logs.
const MAX_OUTPUT = 256 * 1024 * 1024
// Only the diff reads have a time limit. A push can run a pre-push hook or git-lfs for longer, and a timeout would kill git but not the hook.
const DIFF_TIMEOUT_MS = 120 * 1000

const VIEW_FIELDS = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const LIST_FIELDS = 'number,url,title,headRefName,isDraft,updatedAt,author,statusCheckRollup'
const RUN_FIELDS = 'databaseId,workflowName,status,conclusion,url,createdAt,headSha'
const THREADS_QUERY = 'query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { pageInfo { hasNextPage } nodes { isResolved isOutdated path line comments(first: 1) { nodes { url body author { login } } } } } } } }'
const INSTALL_STEP = 'Install the GitHub CLI (https://cli.github.com) and run gh auth login'

/** Runs a command in root with spawnSync. A missing binary throws the spawn error (code ENOENT). */
export const defaultExec =
  ({ root, env }) =>
  (cmd, args, { input, timeout } = {}) => {
    const result = spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8', input, maxBuffer: MAX_OUTPUT, timeout })
    if (result.error) throw result.error
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  }

const firstLine = (text) => text.split(/\r?\n/).find((line) => line.trim()) ?? ''

function failure(cmd, args, result) {
  const stderr = result.stderr ?? ''
  if (stderr.includes('gh auth login')) {
    return new PmkitError('AUTH', 'GitHub CLI is not logged in', 'gh auth login')
  }
  if (/rate limit/i.test(stderr)) {
    return new PmkitError('RATE_LIMITED', 'GitHub rate limit reached', 'Wait a few minutes and retry')
  }
  const detail = firstLine(stderr) || `exit status ${result.status}`
  const error = new PmkitError('UPSTREAM', `${cmd} ${args.slice(0, 2).join(' ')} failed: ${detail}`, 'Check the output of the same command in a terminal')
  // gh api ends its error line with "(HTTP 404)" or starts it with "HTTP 502:". The free text may name a branch, so only these two spots count.
  const http = /\(HTTP (\d{3})\)\s*$/.exec(detail) ?? /^(?:gh: )?HTTP (\d{3})\b/.exec(detail)
  if (http) error.httpStatus = Number(http[1])
  return error
}

/** Refuses a ref that git or gh would read as an option. */
function refArg(what, value) {
  if (typeof value !== 'string' || value === '' || value.startsWith('-')) {
    throw new PmkitError('INVALID_INPUT', `${what} "${value}" is not a valid branch name`, 'Use a branch name that does not start with -')
  }
  return value
}

export function createGithubHost({ root, env, exec = defaultExec({ root, env }) }) {
  /** Runs exec and maps a missing binary to NOT_CONFIGURED. Returns the raw result. */
  const run = (cmd, args, options) => {
    try {
      return exec(cmd, args, options)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new PmkitError('NOT_CONFIGURED', `${cmd} is not installed`, INSTALL_STEP)
      }
      if (error?.code === 'ENOBUFS') {
        throw new PmkitError('UPSTREAM', `${cmd} ${args.slice(0, 2).join(' ')} output is too large to read`, 'Read it in the GitHub web UI, or run the same command in a terminal and page the output')
      }
      if (error?.code === 'ETIMEDOUT') {
        throw new PmkitError('UPSTREAM', `${cmd} ${args.slice(0, 2).join(' ')} timed out`, 'Check the network and retry')
      }
      throw error
    }
  }

  /** Runs exec and throws a PmkitError on a non-zero status. */
  const check = (cmd, args, options) => {
    const result = run(cmd, args, options)
    if (result.status !== 0) throw failure(cmd, args, result)
    return result
  }

  const parse = (text, what) => {
    try {
      return JSON.parse(text)
    } catch {
      throw new PmkitError('UPSTREAM', `gh returned unreadable JSON for ${what}`, 'Update the GitHub CLI and retry')
    }
  }

  const getPullRequest = (selector) => {
    const target = selector?.number ?? selector?.head
    if (target === undefined || target === '') {
      throw new PmkitError('INVALID_INPUT', 'getPullRequest needs a number or a head', 'Pass a pull request number or a branch name')
    }
    if (selector.number === undefined) refArg('head', target)
    const args = ['pr', 'view', String(target), '--json', VIEW_FIELDS]
    const result = run('gh', args)
    if (result.status !== 0) {
      if (/no pull requests? found/i.test(result.stderr ?? '')) return null
      throw failure('gh', args, result)
    }
    return parse(result.stdout, 'the pull request')
  }

  const listRuns = ({ branch }) => {
    const args = ['run', 'list', '--branch', refArg('branch', branch), '--limit', '50', '--json', RUN_FIELDS]
    return parse(check('gh', args).stdout, 'the workflow runs')
  }

  return {
    currentBranch: () => check('git', ['branch', '--show-current']).stdout.trim(),

    createBranch(name, { from }) {
      check('git', ['switch', '-c', refArg('branch', name), refArg('from', from)])
    },

    push(branch) {
      check('git', ['push', '-u', 'origin', refArg('branch', branch)])
    },

    openPullRequest({ title, body, head, base, draft }) {
      refArg('head', head)
      refArg('base', base)
      const args = ['pr', 'create', '--title', title, '--body-file', '-', '--head', head, '--base', base]
      if (draft) args.push('--draft')
      check('gh', args, { input: body })
      return getPullRequest({ head })
    },

    getPullRequest,

    markReady(number) {
      if (!Number.isInteger(number) || number < 1) throw new PmkitError('INVALID_INPUT', `pull request number "${number}" is not valid`, 'Pass a pull request number')
      check('gh', ['pr', 'ready', String(number)])
      return getPullRequest({ number })
    },

    prChecks(number) {
      const args = ['pr', 'checks', String(number), '--json', 'name,state,bucket']
      const result = run('gh', args)
      // gh exits non-zero while checks fail or are pending, and still prints the list.
      if (result.status !== 0) {
        try {
          const list = JSON.parse(result.stdout)
          if (Array.isArray(list)) return list
        } catch {}
        // A pull request without checks makes gh exit 1 with this message.
        if (/no checks reported/i.test(result.stderr ?? '')) return []
        throw failure('gh', args, result)
      }
      return parse(result.stdout, 'the checks')
    },

    prReviews(number) {
      return parse(check('gh', ['pr', 'view', String(number), '--json', 'reviews,reviewRequests']).stdout, 'the reviews')
    },

    prMergeState(number) {
      return parse(check('gh', ['pr', 'view', String(number), '--json', 'mergeable,mergeStateStatus,reviewDecision,baseRefName']).stdout, 'the merge state')
    },

    /** The review threads of a pull request (first 100). `incomplete` is true when there are more. */
    prThreads(number) {
      const args = ['api', 'graphql', '-F', 'owner={owner}', '-F', 'repo={repo}', '-F', `number=${number}`, '-f', `query=${THREADS_QUERY}`]
      const reply = parse(check('gh', args).stdout, 'the review threads')
      if (reply?.errors?.length > 0) {
        const error = new PmkitError('UPSTREAM', `gh api graphql failed: ${reply.errors[0].message}`, 'Check the access of the GitHub token to the repository')
        const httpStatus = { FORBIDDEN: 403, NOT_FOUND: 404 }[reply.errors[0].type]
        if (httpStatus) error.httpStatus = httpStatus
        throw error
      }
      const connection = reply?.data?.repository?.pullRequest?.reviewThreads
      if (!connection) throw new PmkitError('UPSTREAM', 'gh api graphql returned no review threads', 'Update the GitHub CLI and retry')
      const threads = connection.nodes.map((t) => {
        const first = t.comments?.nodes?.[0]
        return { isResolved: t.isResolved, isOutdated: t.isOutdated, path: t.path ?? null, line: t.line ?? null, url: first?.url ?? null, author: first?.author?.login ?? null, body: first?.body ?? '' }
      })
      return { threads, incomplete: connection.pageInfo?.hasNextPage === true }
    },

    /** The branch protection of a base branch, or null when it has none. */
    branchProtection(base) {
      const args = ['api', `repos/{owner}/{repo}/branches/${encodeURIComponent(refArg('base', base))}/protection`]
      const result = run('gh', args)
      if (result.status === 0) return parse(result.stdout, 'the branch protection')
      if (/branch not protected/i.test(result.stderr ?? '')) return null
      throw failure('gh', args, result)
    },

    listPullRequests() {
      return parse(check('gh', ['pr', 'list', '--state', 'open', '--limit', '200', '--json', LIST_FIELDS]).stdout, 'the pull requests')
    },

    listDeploys({ environment, limit = 20 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new PmkitError('INVALID_INPUT', `limit "${limit}" is not valid`, 'Use a whole number from 1 to 100')
      }
      const env = environment === undefined ? '' : `&environment=${encodeURIComponent(environment)}`
      const deployments = parse(check('gh', ['api', `repos/{owner}/{repo}/deployments?per_page=${limit}${env}`]).stdout, 'the deployments')
      return deployments.map((d) => {
        const [status] = parse(check('gh', ['api', `repos/{owner}/{repo}/deployments/${d.id}/statuses?per_page=1`]).stdout, 'the deployment status')
        return {
          id: d.id,
          environment: d.environment,
          ref: d.ref,
          sha: d.sha,
          createdAt: d.created_at,
          state: status?.state ?? 'pending',
          url: status?.log_url ?? status?.target_url ?? null,
        }
      })
    },

    ciLogs({ branch, runId } = {}) {
      let run = { databaseId: runId, workflowName: null, url: null }
      if (runId !== undefined) {
        if (!Number.isInteger(runId) || runId < 1) throw new PmkitError('INVALID_INPUT', `run id "${runId}" is not valid`, 'Pass the number of a workflow run')
      } else {
        const failed = listRuns({ branch }).find((r) => FAILED_RUN.has(r.conclusion))
        if (!failed) return null
        run = failed
      }
      const log = check('gh', ['run', 'view', String(run.databaseId), '--log-failed']).stdout
      return { runId: run.databaseId, workflowName: run.workflowName ?? null, url: run.url ?? null, log }
    },

    prDiff(number) {
      if (!Number.isInteger(number) || number < 1) throw new PmkitError('INVALID_INPUT', `pull request number "${number}" is not valid`, 'Pass a pull request number')
      const args = ['pr', 'diff', String(number), '--color', 'never']
      const result = run('gh', args, { timeout: DIFF_TIMEOUT_MS })
      if (result.status === 0) return result.stdout
      // GitHub refuses a diff over its size limit with HTTP 406. The caller reads the local diff instead.
      if (/HTTP 406|diff exceeded the maximum/i.test(result.stderr ?? '')) return null
      throw failure('gh', args, result)
    },

    /**
     * The changes of a branch since it left its base. The base is origin/<base> when that exists, so commits of other people
     * on a stale local base stay out. The branch is the local one, or origin/<branch> when only origin has it. For the branch
     * that is checked out the diff also holds the index and the working tree (tracked files), because it starts at the
     * merge base and ends at the working tree. Returns { diff, base, ref, uncommitted }.
     */
    localDiff({ branch, base }) {
      refArg('branch', branch)
      refArg('base', base)
      const git = (args) => run('git', args, { timeout: DIFF_TIMEOUT_MS })
      const exists = (ref) => git(['rev-parse', '--verify', '--quiet', ref]).status === 0
      const from = [[`refs/remotes/origin/${base}`, `origin/${base}`], [`refs/heads/${base}`, base], [base, base]].find(([ref]) => exists(ref))?.[1]
      if (from === undefined) throw new PmkitError('INVALID_INPUT', `the base branch "${base}" does not exist here or on origin`, 'Pass --base <branch>, or run git fetch origin')
      const local = exists(`refs/heads/${branch}`)
      if (!local && !exists(`refs/remotes/origin/${branch}`)) throw new PmkitError('INVALID_INPUT', `the branch "${branch}" does not exist here or on origin`, 'Pass --branch <branch>, or run git fetch origin')
      const ref = local ? branch : `origin/${branch}`
      const uncommitted = local && git(['branch', '--show-current']).stdout.trim() === branch
      const diffOf = (args) => {
        const result = git(args)
        if (result.status !== 0) throw failure('git', args, result)
        return result.stdout
      }
      if (!uncommitted) return { diff: diffOf(['diff', '--no-color', `${from}...${ref}`]), base: from, ref, uncommitted }
      const mergeBase = diffOf(['merge-base', from, ref]).trim()
      return { diff: diffOf(['diff', '--no-color', mergeBase]), base: from, ref, uncommitted }
    },

    /** The commits of the local branch that origin/<branch> lacks, or null when either ref is missing. */
    unpushedCommits(branch) {
      refArg('branch', branch)
      const git = (args) => run('git', args, { timeout: DIFF_TIMEOUT_MS })
      if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).status !== 0) return null
      if (git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]).status !== 0) return null
      const result = git(['rev-list', '--count', `origin/${branch}..${branch}`])
      return result.status === 0 ? Number(result.stdout.trim()) : null
    },

    listRuns,
  }
}
