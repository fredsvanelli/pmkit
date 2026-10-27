// The user store: the per-user folder for the discovery cache and personal defaults.
// It lives outside the repository and holds no credential.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PmkitError } from './errors.mjs'

const NAME = /^[a-z0-9][a-z0-9._-]*$/

/** Fills the defaults of an options object: env, now and homedir. */
function resolve(options = {}) {
  const { env = process.env, now = () => new Date(), homedir = os.homedir } = options
  return { env, now, homedir }
}

/** Throws INVALID_INPUT unless value is a lowercase name that cannot climb out of a folder. */
function checkName(kind, value) {
  if (typeof value !== 'string' || !NAME.test(value)) {
    throw new PmkitError('INVALID_INPUT', `The ${kind} "${value}" is not a valid name.`, `Use lowercase letters, digits, ".", "_" and "-", starting with a letter or digit.`)
  }
  return value
}

/** The user store folder. Creates nothing. */
export function userDir(options) {
  const { env, homedir } = resolve(options)
  if (env.PMKIT_HOME) {
    if (!path.isAbsolute(env.PMKIT_HOME)) {
      throw new PmkitError('INVALID_INPUT', 'PMKIT_HOME must be an absolute path.', 'Set PMKIT_HOME to an absolute path or unset it.')
    }
    return env.PMKIT_HOME
  }
  if (env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)) return path.join(env.XDG_CONFIG_HOME, 'pmkit')
  return path.join(homedir(), '.config', 'pmkit')
}

/** The first 12 hex characters of the SHA-256 of the real path of a repository root. */
export function repoHash(root) {
  return crypto.createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 12)
}

/** The real path of a path that may not exist yet: the first existing ancestor, resolved, plus the rest. */
function realPathOf(target) {
  const rest = []
  let current = path.resolve(target)
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    rest.unshift(path.basename(current))
    current = parent
  }
  return path.join(fs.realpathSync(current), ...rest)
}

/**
 * Throws INVALID_INPUT when target sits inside a git work tree. A .git entry (folder or file)
 * in any ancestor counts, except one exactly at the home folder, because a dotfiles repository
 * at home is common. It spawns no process.
 */
export function assertOutsideRepo(target, options) {
  const { homedir } = resolve(options)
  let home
  try {
    home = fs.realpathSync(homedir())
  } catch {
    home = undefined
  }
  let dir = realPathOf(target)
  for (;;) {
    if (dir !== home && fs.existsSync(path.join(dir, '.git'))) {
      throw new PmkitError('INVALID_INPUT', 'The user store resolves inside a repository.', 'Unset XDG_CONFIG_HOME or PMKIT_HOME, or point it outside the repository.')
    }
    const parent = path.dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}

const CACHE_VERSION = 1

/** Hook for the credential guard. */
function assertNoCredentials() {}

function cacheFile(scope, key, options) {
  return path.join(userDir(options), 'cache', checkName('scope', scope), `${checkName('key', key)}.json`)
}

/** Writes text to file through a temp file and a rename, so a reader sees the old file or the new one. */
function writeAtomic(file, text, options) {
  assertOutsideRepo(file, options)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temp, text, { mode: 0o600 })
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}

/** Reads a cache entry. Returns null when it is missing, expired, unreadable or of another version. */
export function cacheGet(scope, key, options) {
  const file = cacheFile(scope, key, options)
  const { now } = resolve(options)
  try {
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (entry?.version !== CACHE_VERSION || !Number.isInteger(entry.ttlSeconds) || !('value' in entry)) return null
    const storedAt = Date.parse(entry.storedAt)
    if (Number.isNaN(storedAt)) return null
    const expires = storedAt + entry.ttlSeconds * 1000
    if (now().getTime() >= expires) return null
    return { value: entry.value, storedAt: entry.storedAt, expiresAt: new Date(expires).toISOString() }
  } catch {
    return null
  }
}

/** Writes a cache entry that expires ttlSeconds after now. */
export function cachePut(scope, key, value, { ttlSeconds } = {}, options) {
  const file = cacheFile(scope, key, options)
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new PmkitError('INVALID_INPUT', 'ttlSeconds must be a positive integer.', 'Pass the life of the entry in whole seconds.')
  }
  assertNoCredentials(value, 'value')
  const storedAt = resolve(options).now().toISOString()
  let text
  try {
    text = JSON.stringify({ version: CACHE_VERSION, storedAt, ttlSeconds, value })
  } catch {
    throw new PmkitError('INVALID_INPUT', 'The cache value cannot be turned into JSON.', 'Store plain data without circular references.')
  }
  if (text === undefined || !text.includes('"value"')) {
    throw new PmkitError('INVALID_INPUT', 'The cache value is undefined.', 'Store a JSON value.')
  }
  writeAtomic(file, `${text}\n`, options)
}
