// The local-migrate commands: the sides of a migration and the export run.
// See docs/superpowers/specs/2026-10-28-pmk-41-local-migrate-design.md, "Commands" and "Sides".
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadLocalConfig, loadPmkitConfig } from '../config.mjs'
import { PmkitError } from '../errors.mjs'
import { formatError } from '../local/migrations.mjs'

const gitIn = (root, ...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })

function requireGit(root, name) {
  const inside = gitIn(root, 'rev-parse', '--is-inside-work-tree')
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    throw new PmkitError('NOT_CONFIGURED', 'this folder is not a git repository, or git is not installed', `${name} needs a git repository: git history is the only way back from a migration`)
  }
}

function requireClean(root, trackerPath) {
  const dirty = gitIn(root, 'status', '--porcelain', '--', trackerPath)
  if (dirty.status !== 0 || dirty.stdout.trim() !== '') {
    throw new PmkitError('CONFLICT', `there are uncommitted changes under ${trackerPath}`, `Commit or discard the changes under ${trackerPath} first`)
  }
}

/**
 * The Local side and the Linear side of a migration, checked in the order of the spec: git, the Local tracker and its format,
 * the clean tree, then the Linear side. The Local side is tracker.path on a Local repository and --path on any other.
 */
export function resolveSides(ctx, { direction }) {
  const name = `local-migrate ${direction}`
  requireGit(ctx.root, name)
  const { pmkit, system, pmkitProblems } = loadPmkitConfig(ctx.root, { adapters: ctx.adapters })
  const localPath = (system === 'local' ? pmkit.tracker.path ?? '.issues' : ctx.opt('path') ?? '.issues').split(path.sep).join('/')
  const config = loadLocalConfig(ctx.root, { ...pmkit, tracker: { system: 'local', path: localPath } }, pmkitProblems, { checkFormat: false })
  if (config.format.state !== 'current') throw formatError(config.format)
  requireClean(ctx.root, localPath)
  const scope = system === 'linear' ? pmkit.tracker.scope ?? {} : {}
  const workspace = ctx.opt('workspace') ?? scope.workspace
  const team = ctx.opt('team') ?? scope.team
  if (typeof workspace !== 'string' || typeof team !== 'string') {
    throw new PmkitError('NOT_CONFIGURED', `${name} needs the Linear workspace and team`, 'Pass --workspace <key> --team <KEY>, or run it from a repository whose tracker.scope names them')
  }
  return { local: { root: ctx.root, path: localPath, config }, linear: { workspace, team, mappings: system === 'linear' ? pmkit.mappings ?? {} : {} } }
}

export async function runExport(ctx) {
  resolveSides(ctx, { direction: 'export' })
  // The Linear reads, the plan and the run come in the rest of Task 13.
  throw new PmkitError('NOT_SUPPORTED', 'local-migrate export stops after its checks in this build', 'node scripts/pmkit.mjs --help')
}
