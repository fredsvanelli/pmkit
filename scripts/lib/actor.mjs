import { spawnSync } from 'node:child_process'
import { PmkitError } from './errors.mjs'

export function gitUserEmail(cwd) {
  const result = spawnSync('git', ['config', 'user.email'], { cwd, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

export function resolveActor(localConfig, { email = gitUserEmail(), env = process.env } = {}) {
  const members = localConfig.members ?? {}
  const wanted = email.trim().toLowerCase()
  if (wanted) {
    const id = Object.keys(members).find((key) => String(members[key]?.email ?? '').toLowerCase() === wanted)
    if (id) return { id, member: members[id] }
  }
  const named = env.PMKIT_USER
  if (named && Object.hasOwn(members, named)) return { id: named, member: members[named] }
  return null
}

export function requireActor(localConfig, options) {
  const actor = resolveActor(localConfig, options)
  if (!actor) {
    throw new PmkitError(
      'NOT_CONFIGURED',
      'cannot tell which member you are',
      'Add yourself to members in .issues/config.yaml or set PMKIT_USER',
    )
  }
  return actor
}
