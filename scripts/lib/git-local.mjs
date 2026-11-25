import { spawnSync } from 'node:child_process'
import { PmkitError } from './errors.mjs'
import { hideAbsolutePaths } from './paths.mjs'

// A failed run log can pass the 1 MiB default of spawnSync. 256 MiB leaves room for the largest logs.
const MAX_OUTPUT = 256 * 1024 * 1024
// Only the diff reads have a time limit. A push can run a pre-push hook or git-lfs for longer, and a timeout would kill git but not the hook.
export const DIFF_TIMEOUT_MS = 120 * 1000
const firstLine = (text) => text.split(/\r?\n/).find((line) => line.trim()) ?? ''

/** Runs a command in root with spawnSync. A missing binary throws the spawn error (code ENOENT). signal names the signal that ended it, or null. */
export const defaultExec =
  ({ root, env }) =>
  (cmd, args, { input, timeout } = {}) => {
    const result = spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8', input, maxBuffer: MAX_OUTPUT, timeout })
    if (result.error) throw result.error
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '', signal: result.signal ?? null }
  }

/** The error of a git command that exited non-zero: UPSTREAM with the first stderr line. */
export function gitFailure(cmd, args, result) {
  const detail = firstLine(result.stderr ?? '') || `exit status ${result.status}`
  return new PmkitError('UPSTREAM', `${cmd} ${args.slice(0, 2).join(' ')} failed: ${hideAbsolutePaths(detail)}`, 'Check the output of the same command in a terminal')
}

/** Refuses a ref that git or gh would read as an option. */
export function refArg(what, value) {
  if (typeof value !== 'string' || value === '' || value.startsWith('-')) {
    throw new PmkitError('INVALID_INPUT', `${what} "${value}" is not a valid branch name`, 'Use a branch name that does not start with -')
  }
  return value
}

export function createGitLocal({ root, env, exec = defaultExec({ root, env }) }) {
  /** Runs git and maps a missing binary to NOT_CONFIGURED. Returns the raw result. */
  const run = (cmd, args, options) => {
    try {
      return exec(cmd, args, options)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new PmkitError('NOT_CONFIGURED', `${cmd} is not installed`, 'Install git')
      }
      if (error?.code === 'ENOBUFS') {
        throw new PmkitError('UPSTREAM', `${cmd} ${args.slice(0, 2).join(' ')} output is too large to read`, 'Run the same command in a terminal and page the output')
      }
      if (error?.code === 'ETIMEDOUT') {
        throw new PmkitError('UPSTREAM', `${cmd} ${args.slice(0, 2).join(' ')} timed out`, 'Check the network and retry')
      }
      throw error
    }
  }

  const check = (cmd, args, options) => {
    const result = run(cmd, args, options)
    if (result.status !== 0) throw gitFailure(cmd, args, result)
    return result
  }

  const workingTree = (branch) => {
    refArg('branch', branch)
    const git = (args) => run('git', args, { timeout: DIFF_TIMEOUT_MS })
    const current = git(['branch', '--show-current'])
    if (current.status !== 0) throw gitFailure('git', ['branch', '--show-current'], current)
    if (current.stdout.trim() !== branch) return null
    // --no-optional-locks keeps a read from writing the index. --untracked-files=all lists files, not a folder per entry.
    const args = ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all']
    const result = git(args)
    if (result.status !== 0) throw gitFailure('git', args, result)
    const lines = result.stdout.split('\n').filter((line) => line !== '')
    const untracked = lines.filter((line) => line.startsWith('??')).length
    return { uncommitted: lines.length > untracked, untracked }
  }

  /** The commits the local branch and origin/<branch> point to, of those that exist. */
  const branchTips = (branch) => {
    refArg('branch', branch)
    return [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]
      .map((ref) => run('git', ['rev-parse', '--verify', '--quiet', ref], { timeout: DIFF_TIMEOUT_MS }))
      .filter((r) => r.status === 0)
      .map((r) => r.stdout.trim())
  }

  return {
    currentBranch: () => check('git', ['branch', '--show-current']).stdout.trim(),

    createBranch(name, { from }) {
      // --no-track: a remote ref as the base would make git set it as upstream, and a bare git push would then target the default branch.
      check('git', ['switch', '--no-track', '-c', refArg('branch', name), refArg('from', from)])
    },

    push(branch) {
      check('git', ['push', '-u', 'origin', refArg('branch', branch)])
    },

    /**
     * The changes of a branch since it left its base. The base is origin/<base> when that exists, so commits of other people
     * on a stale local base stay out. The branch is the local one, or origin/<branch> when only origin has it. For the branch
     * that is checked out the diff also holds the index and the working tree (tracked files), because it starts at the
     * merge base and ends at the working tree. Returns { diff, base, ref, uncommitted, untracked, committedEmpty, treeError }: committedEmpty is true when the commits alone
     * change nothing, and treeError holds why the working tree could not be read, or null.
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
      // A working tree that cannot be read must not stop the committed diff: the caller gets the reason in treeError.
      let tree = null
      let treeError = null
      if (local) {
        try { tree = workingTree(branch) } catch (error) { treeError = error.message }
      }
      const uncommitted = tree?.uncommitted === true
      const untracked = tree?.untracked ?? 0
      const diffOf = (args) => {
        const result = git(args)
        if (result.status !== 0) throw gitFailure('git', args, result)
        return result.stdout
      }
      if (!uncommitted) {
        const diff = diffOf(['diff', '--no-color', `${from}...${ref}`])
        return { diff, base: from, ref, uncommitted, untracked, committedEmpty: diff === '', treeError }
      }
      const mergeBase = diffOf(['merge-base', from, ref]).trim()
      const quiet = git(['diff', '--quiet', `${from}...${ref}`])
      if (quiet.status > 1) throw gitFailure('git', ['diff', '--quiet', `${from}...${ref}`], quiet)
      return { diff: diffOf(['diff', '--no-color', mergeBase]), base: from, ref, uncommitted, untracked, committedEmpty: quiet.status === 0, treeError }
    },

    /**
     * The state of the working tree when `branch` is the checked out branch, else null. `uncommitted` is true when the index or
     * a tracked file has changes (the changes localDiff includes); `untracked` counts the files git does not track, which no diff holds.
     */
    workingTree,

    /** Whether the local branch or origin/<branch> exists, so a caller reads the commit it asks branchHas about only when it can be on it. */
    branchExists: (branch) => branchTips(branch).length > 0,

    /**
     * Whether the commit `oid` is on the branch: a tip of the local branch or of origin/<branch>, or behind one of them. Null when the
     * branch exists in neither place. The local branch may be ahead of or behind what a pull request merged, so one tip is not enough.
     */
    branchHas(branch, oid) {
      const tips = branchTips(branch)
      if (tips.length === 0) return null
      return tips.some((tip) => tip === oid || run('git', ['merge-base', '--is-ancestor', oid, tip], { timeout: DIFF_TIMEOUT_MS }).status === 0)
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
  }
}
