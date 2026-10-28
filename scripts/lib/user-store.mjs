// The user store: the per-user folder for the discovery cache and personal defaults.
// It lives outside the repository and holds no credential.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PmkitError } from './errors.mjs'
import { setScalar } from './yaml-edit.mjs'
import { parseYaml } from './yaml.mjs'

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

// The guard below catches accidents, such as a token pasted into a cache value.
// It is not a security boundary: a determined caller can encode a secret past it.
const CREDENTIAL_KEY = /token|secret|password|passwd|api[_-]?key|credential|authorization/i
const CREDENTIAL_STRING = /^(lin_api_.{20,}|Bearer\s+\S+)/i

/** True when a key name looks like it holds a credential. */
export function isCredentialKey(key) {
  return CREDENTIAL_KEY.test(key)
}

/** True when a string looks like a Linear API key or an Authorization bearer header. */
export function isCredentialString(text) {
  return CREDENTIAL_STRING.test(text.trim())
}

function refuse(where) {
  return new PmkitError('INVALID_INPUT', `The value looks like a credential at ${where}.`, 'The user store holds no credentials. Keep the key in the environment and drop this field.')
}

/** Throws INVALID_INPUT, naming the key path and never the value, when value holds something credential-shaped. */
function assertNoCredentials(value, label) {
  if (typeof value === 'string') {
    if (isCredentialString(value)) throw refuse(label)
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentials(item, `${label}[${index}]`))
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (isCredentialKey(key)) throw refuse(`${label}.${key}`)
      assertNoCredentials(item, `${label}.${key}`)
    }
  }
}

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
  assertNoCredentials(value, 'value')
  writeAtomic(file, `${text}\n`, options)
}

/** Removes one cache entry. A missing entry is fine. */
export function cacheDelete(scope, key, options) {
  fs.rmSync(cacheFile(scope, key, options), { force: true })
}

/** Removes every entry of a scope, or the whole cache folder when scope is omitted. */
export function cacheClear(scope, options) {
  const base = path.join(userDir(options), 'cache')
  fs.rmSync(scope === undefined ? base : path.join(base, checkName('scope', scope)), { recursive: true, force: true })
}

function defaultsFile(options) {
  return path.join(userDir(options), 'defaults.yaml')
}

function readDefaultsText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

function parseDefaults(text, file) {
  let map
  try {
    map = parseYaml(text)
  } catch (error) {
    throw new PmkitError('INVALID_INPUT', `The defaults file ${file} does not parse: ${error.message}`, `Fix the file by hand or delete it.`)
  }
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    throw new PmkitError('INVALID_INPUT', `The defaults file ${file} is not a map of keys and values.`, 'Fix the file by hand or delete it.')
  }
  return map
}

/** The personal defaults as a map. An absent file gives {}. */
export function defaultsGet(options) {
  const file = defaultsFile(options)
  const text = readDefaultsText(file)
  return text === undefined ? {} : parseDefaults(text, file)
}

/** Sets one scalar default and keeps the comments and other keys of the file. */
export function defaultsSet(key, value, options) {
  checkName('default key', key)
  if (isCredentialKey(key)) throw refuse(`key ${key}`)
  if (!['string', 'number', 'boolean'].includes(typeof value)) {
    throw new PmkitError('INVALID_INPUT', `The default ${key} must be a string, number or boolean.`, 'Store one scalar per key.')
  }
  if (typeof value === 'string' && isCredentialString(value)) throw refuse(`key ${key}`)
  const file = defaultsFile(options)
  const text = readDefaultsText(file) ?? ''
  parseDefaults(text, file)
  writeAtomic(file, setScalar(text, [key], value), options)
}

/** Removes one default. A missing key or file is fine. */
export function defaultsUnset(key, options) {
  checkName('default key', key)
  const file = defaultsFile(options)
  const text = readDefaultsText(file)
  if (text === undefined) return
  parseDefaults(text, file)
  const lines = text.split('\n')
  const kept = lines.filter((line) => !(line.startsWith(`${key}:`) && (line.length === key.length + 1 || /\s/.test(line[key.length + 1]))))
  if (kept.length !== lines.length) writeAtomic(file, kept.join('\n'), options)
}
