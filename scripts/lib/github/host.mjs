import { spawnSync } from 'node:child_process'
import { PmkitError } from '../errors.mjs'

const VIEW_FIELDS = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const LIST_FIELDS = 'number,url,title,headRefName,isDraft,updatedAt,author,statusCheckRollup'
const RUN_FIELDS = 'databaseId,workflowName,status,conclusion,url,createdAt,headSha'
const INSTALL_STEP = 'Install the GitHub CLI (https://cli.github.com) and run gh auth login'

/** Runs a command in root with spawnSync. A missing binary throws the spawn error (code ENOENT). */
export const defaultExec =
  ({ root, env }) =>
  (cmd, args, { input } = {}) => {
    const result = spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8', input })
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
  return new PmkitError('UPSTREAM', `${cmd} ${args.slice(0, 2).join(' ')} failed: ${detail}`, 'Check the output of the same command in a terminal')
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

    listPullRequests() {
      return parse(check('gh', ['pr', 'list', '--state', 'open', '--limit', '200', '--json', LIST_FIELDS]).stdout, 'the pull requests')
    },

    listRuns({ branch }) {
      const args = ['run', 'list', '--branch', refArg('branch', branch), '--limit', '50', '--json', RUN_FIELDS]
      return parse(check('gh', args).stdout, 'the workflow runs')
    },
  }
}
