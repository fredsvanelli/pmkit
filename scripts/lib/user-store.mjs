// The user store: the per-user folder for the discovery cache and personal defaults.
// It lives outside the repository and holds no credential.
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PmkitError } from './errors.mjs'
import { chooseRemote, parseRemoteUrl } from './git-remote.mjs'
import { validTimestamp } from './local/sprints.mjs'
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

const INBOX_VERSION = 2
const sha12 = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024 })

/**
 * What git says about the repository at root, for the inbox key: its remotes as [{ name, url }] and the paths of its worktrees,
 * or null when root is not the top level of a work tree (no git, or a pmkit project below the top level of a monorepo).
 * Reads only, so each call has a timeout.
 */
function gitFacts(root) {
  const top = git(root, ['rev-parse', '--show-toplevel'])
  if (top.error || top.status !== 0) return null
  try {
    if (fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(root)) return null
  } catch {
    return null
  }
  const remotes = []
  const listed = git(root, ['remote', '-v'])
  for (const line of listed.status === 0 ? listed.stdout.split(/\r?\n/) : []) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim())
    if (match && !remotes.some((remote) => remote.name === match[1])) remotes.push({ name: match[1], url: match[2] })
  }
  const worktrees = git(root, ['worktree', 'list', '--porcelain'])
  const paths = worktrees.status === 0 ? worktrees.stdout.split(/\r?\n/).filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length)) : []
  return { remotes, worktrees: paths }
}

/** The repoHash of a path, or null when it does not exist any more. */
const hashOf = (dir) => {
  try {
    return repoHash(dir)
  } catch {
    return null
  }
}

/** The key of the inbox file and the path keys of PMK-47 it takes over, from one read of git. */
function inboxKeys(root) {
  const own = repoHash(root)
  const facts = gitFacts(root)
  const { remote } = chooseRemote(facts?.remotes ?? [])
  const parsed = remote ? parseRemoteUrl(remote.url) : null
  if (!parsed) return { key: own, legacy: [] }
  const legacy = [...new Set([own, ...facts.worktrees.map(hashOf).filter((hash) => hash !== null)])]
  return { key: sha12(`remote:${parsed.host}/${parsed.owner}/${parsed.name}`.toLowerCase()), legacy }
}

/**
 * The key of the inbox file of a repository: the hash of the host, owner and name of the remote chooseRemote picks (origin, else
 * the only remote), so every worktree and clone of one repository shares it, whether the URL is https or ssh. Without a remote
 * git can read, or when root is not the top level of its repository (a project of a monorepo), the hash of the real path of root,
 * as repoHash.
 */
export function inboxKey(root) {
  return inboxKeys(root).key
}

/**
 * The inbox file and the path-keyed files of PMK-47 it takes over: one per worktree of the repository (PMK-225 review), each
 * joined once and then listed in the file's `migrated`.
 */
function inboxFiles(root, options) {
  const dir = path.join(userDir(options), 'inbox')
  const { key, legacy } = inboxKeys(root)
  return { file: path.join(dir, `${key}.json`), legacy: legacy.filter((hash) => hash !== key).map((hash) => ({ hash, file: path.join(dir, `${hash}.json`) })) }
}

const inboxBad = (file, why) => new PmkitError(
  'INVALID_INPUT',
  `The inbox file ${file} ${why}.`,
  'This file is in the user store, not a value the user typed. Delete it, or fix it by hand. Deleting it makes the next inbox list show the last 14 days again.',
)

/**
 * The inbox file as stored: { checks: { member: entry }, migrated: [path keys joined] }. A missing file gives empty ones. Only the
 * file as a whole is checked.
 */
function readInbox(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { checks: {}, migrated: [] }
    throw error
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw inboxBad(file, 'does not parse')
  }
  const checks = data?.checks
  const migrated = data?.migrated ?? []
  if (data?.version !== INBOX_VERSION || checks === null || typeof checks !== 'object' || Array.isArray(checks) || !Array.isArray(migrated)) {
    throw inboxBad(file, 'is not an inbox file of this version')
  }
  return { checks, migrated }
}

const later = (a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)

/** Two entries of one member as one: the later check, every seen key at its later time, and the kinds of `base`. */
function mergeEntries(base, other) {
  if (base === null) return other
  if (other === null) return base
  const seen = { ...other.seen }
  for (const [key, at] of Object.entries(base.seen)) seen[key] = Object.hasOwn(seen, key) ? later(at, seen[key]) : at
  return { ...base, at: later(base.at, other.at), seen }
}

/** The path files of `legacy` the stored file has not joined yet, read. */
const pending = (legacy, migrated) => legacy.filter(({ hash, file }) => !migrated.includes(hash) && fs.existsSync(file)).map(({ hash, file }) => ({ hash, file, checks: readInbox(file).checks }))

const isMapOfTimes = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(validTimestamp)
const isKinds = (value) => value === undefined || (Array.isArray(value) && value.every((kind) => typeof kind === 'string'))
const inSeconds = (value) => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z')

/** The entry of member in checks, normalized, or null. Throws when it is not a check. */
function entryOf(checks, member, file) {
  if (!Object.hasOwn(checks, member)) return null
  const entry = checks[member]
  if (entry === null || typeof entry !== 'object' || !validTimestamp(entry.at) || !isMapOfTimes(entry.seen) || !isKinds(entry.kinds)) {
    throw inboxBad(file, `holds an entry for ${member} that is not a check with a timestamp and a map of seen keys`)
  }
  const normal = { at: inSeconds(entry.at), seen: Object.fromEntries(Object.entries(entry.seen).map(([key, at]) => [key, inSeconds(at)])) }
  return entry.kinds === undefined ? normal : { ...normal, kinds: [...entry.kinds] }
}

/**
 * The inbox entry of a member in this repository, `{ at, seen }` plus `kinds` when the file records them, or null when there is
 * none. `at` is the time of the last mark-read, `seen` maps the key of each item the member has seen to the time it was marked
 * and `kinds` lists the item kinds the entry has covered. Times are read as whole seconds in Z. Only the entry of this member is
 * checked, so a bad entry of another member does not block this one.
 */
export function inboxGet(root, member, options) {
  const { file, legacy } = inboxFiles(root, options)
  const { checks, migrated } = readInbox(file)
  let entry = entryOf(checks, member, file)
  for (const old of pending(legacy, migrated)) entry = mergeEntries(entry, entryOf(old.checks, member, old.file))
  return entry
}

const LOCK_STEP_MS = 25
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * Runs body while holding `<file>.lock`, made with the `wx` flag so only one process holds it. A lock already there makes the
 * caller wait, up to lockWaitMs (10 s); a lock older than staleLockMs (30 s) was left by a process that died and is removed.
 */
function withLock(file, body, { lockWaitMs = 10000, staleLockMs = 30000 } = {}) {
  const lock = `${file}.lock`
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const deadline = Date.now() + lockWaitMs
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, 'wx', 0o600))
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs > staleLockMs) {
        fs.rmSync(lock, { force: true })
        continue
      }
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (Date.now() >= deadline) {
      throw new PmkitError('CONFLICT', `Another pmkit run holds the inbox lock ${lock}.`, `Retry in a moment. If no other pmkit runs, delete ${lock}.`)
    }
    sleep(LOCK_STEP_MS)
  }
  try {
    return body()
  } finally {
    fs.rmSync(lock, { force: true })
  }
}

/**
 * Replaces the inbox entry of a member in this repository with update(current), where current is the entry on disk at that
 * moment (or null). It holds the lock from the read to the write, so two writers never drop each other's keys, and keeps the
 * entries of the other members as they are.
 */
export function inboxUpdate(root, member, update, options = {}) {
  const { file, legacy } = inboxFiles(root, options)
  assertOutsideRepo(file, options)
  return withLock(file, () => {
    const { checks, migrated } = readInbox(file)
    const joined = { ...checks }
    // Each path file of PMK-47 joins once, for every member: a bad entry of another member is kept as it is, never merged.
    for (const old of pending(legacy, migrated)) {
      for (const [name, value] of Object.entries(old.checks)) {
        if (!Object.hasOwn(joined, name)) joined[name] = value
        else {
          try {
            joined[name] = mergeEntries(entryOf(joined, name, file), entryOf(old.checks, name, old.file))
          } catch (error) {
            if (name === member) throw error
          }
        }
      }
      migrated.push(old.hash)
    }
    const next = update(entryOf(joined, member, file))
    const stored = { at: next.at, seen: next.seen, ...(next.kinds === undefined ? {} : { kinds: next.kinds }) }
    const data = { version: INBOX_VERSION, checks: { ...joined, [member]: stored }, ...(migrated.length > 0 ? { migrated } : {}) }
    writeAtomic(file, `${JSON.stringify(data, null, 2)}\n`, options)
    return stored
  }, options)
}

/** Replaces the inbox entry of a member in this repository and keeps the entries of the others as they are. */
export function inboxSet(root, member, entry, options) {
  inboxUpdate(root, member, () => entry, options)
}
