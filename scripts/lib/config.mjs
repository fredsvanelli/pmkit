import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { PmkitError } from './errors.mjs'
import { ID_STYLES } from './ids.mjs'
import { FORMAT_VERSION, MIGRATIONS, formatError, formatState, migratedCopy } from './local/migrations.mjs'
import { CATEGORIES, FIELD_ROLES, STATUS_MAPPING_KEYS, isCategory } from './model.mjs'
import { parseYaml } from './yaml.mjs'

export const TRACKERS = ['local', 'linear', 'jira', 'github', 'gitlab', 'azure-devops']
export const GIT_HOSTS = ['github', 'none']
export const CONFIRM = ['all_writes', 'single_writes', 'none']
export const PREVIEW = ['bulk', 'delete', 'publish_update', 'move_scope']
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const ESTIMATE_UNITS = ['points', 'hours', 'sizes']
export const PREFIX = /^[A-Z]{2,5}$/
export const MEMBER_ID = /^([a-z0-9][a-z0-9-]*|agent:[a-z0-9-]+)$/
export const NAME = /\S/
export const WORKSPACE_KEY = /^[a-z0-9][a-z0-9-]*$/

const DEFAULTS = {
  default_status: 'backlog',
  epic_prefix: 'EPC',
  id_style: 'random',
  types: ['feature', 'bug', 'task', 'chore'],
  priorities: ['urgent', 'high', 'medium', 'low'],
  labels: [],
  estimate: { unit: 'points', scale: [1, 2, 3, 5, 8, 13] },
  members: {},
  defaults: {
    stale_days: 60,
    stuck_business_days: 3,
    sprint_length_days: 14,
    sprint_start_weekday: 'mon',
    velocity_window: 3,
    status_update_window_days: 14,
  },
  auto_commit: false,
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isStringList = (value) => Array.isArray(value) && value.length > 0 && value.every((x) => typeof x === 'string')

// The value a check found, as it reads in YAML: "True" for a string, True for a boolean.
const found = (value) => (value === undefined ? 'nothing' : JSON.stringify(value))

const clone = (value) => JSON.parse(JSON.stringify(value))

const isName = (value) => typeof value === 'string' && NAME.test(value)

function scopeProblems(scope) {
  if (scope === undefined) return []
  if (!isObject(scope)) return ['tracker.scope must be a map of names, such as team: ENG']
  const problems = []
  for (const [key, value] of Object.entries(scope)) {
    if (key === 'workspace') {
      if (typeof value !== 'string' || !WORKSPACE_KEY.test(value)) {
        problems.push('tracker.scope.workspace must be the workspace URL key, lowercase letters, digits and hyphens, such as acme')
      }
    } else if (!isName(value)) {
      problems.push(`tracker.scope.${key} must be a name`)
    }
  }
  return problems
}

function mappingsProblems(mappings) {
  if (mappings === undefined) return []
  if (!isObject(mappings)) return ['mappings must be a map with status or fields']
  const problems = []
  const { status, fields } = mappings
  if (status !== undefined && !isObject(status)) {
    problems.push('mappings.status must be a map from a category or blocked to a status name')
  } else {
    for (const [key, value] of Object.entries(status ?? {})) {
      if (!STATUS_MAPPING_KEYS.includes(key)) problems.push(`mappings.status.${key}: ${key} is not a category or blocked`)
      if (!isName(value)) problems.push(`mappings.status.${key} must be a status name`)
    }
  }
  if (fields !== undefined && !isObject(fields)) {
    problems.push('mappings.fields must be a map from a field role to a field name or native')
  } else {
    for (const [key, value] of Object.entries(fields ?? {})) {
      if (!FIELD_ROLES.includes(key)) problems.push(`mappings.fields.${key}: ${key} is not a field role, use one of ${FIELD_ROLES.join(', ')}`)
      if (!isName(value)) problems.push(`mappings.fields.${key} must be a field name or native`)
    }
  }
  return problems
}

export function withLocalDefaults(obj) {
  const input = isObject(obj) ? obj : {}
  const result = { ...clone(DEFAULTS), ...input }
  if (isObject(input.estimate)) result.estimate = { ...DEFAULTS.estimate, ...input.estimate }
  if (isObject(input.defaults)) result.defaults = { ...DEFAULTS.defaults, ...input.defaults }
  if (!isObject(result.statuses)) result.statuses = {}
  return result
}

export function validatePmkitConfig(obj) {
  if (!isObject(obj)) return ['config must be a map']
  const problems = []
  if (obj.version !== 1) problems.push('version must be 1')
  const tracker = obj.tracker
  if (!isObject(tracker) || !TRACKERS.includes(tracker.system)) {
    problems.push(`tracker.system must be one of ${TRACKERS.join(', ')}`)
  } else if (tracker.path !== undefined && tracker.path !== null && typeof tracker.path !== 'string') {
    problems.push('tracker.path must be a string')
  }
  // Valid for every system: the local tracker ignores scope and mappings, and a hosted one ignores tracker.path.
  if (isObject(tracker)) problems.push(...scopeProblems(tracker.scope))
  const host = obj.git_host
  if (!isObject(host) || !GIT_HOSTS.includes(host.system)) {
    problems.push(`git_host.system must be ${GIT_HOSTS.join(' or ')}`)
  } else {
    if (host.repo !== undefined && typeof host.repo !== 'string') problems.push('git_host.repo must be a string')
    if (host.default_branch !== undefined && typeof host.default_branch !== 'string') problems.push('git_host.default_branch must be a string')
  }
  const policy = obj.write_policy
  if (!isObject(policy) || !CONFIRM.includes(policy.confirm)) {
    problems.push(`write_policy.confirm must be one of ${CONFIRM.join(', ')}`)
  } else if (policy.preview !== undefined && !(Array.isArray(policy.preview) && policy.preview.every((x) => PREVIEW.includes(x)))) {
    problems.push(`write_policy.preview must be a list of ${PREVIEW.join(', ')}`)
  }
  problems.push(...mappingsProblems(obj.mappings))
  return problems
}

/** Every per-key check of .issues/config.yaml. The schema mirrors these; the rules between fields live in validateLocalConfig. */
export function localConfigShapeProblems(obj) {
  const problems = []
  if (!Number.isInteger(obj.version) || obj.version < 1) problems.push(`version must be a whole number of 1 or more, found ${found(obj.version)}`)
  const { id_prefix: idPrefix, epic_prefix: epicPrefix } = obj
  if (typeof idPrefix !== 'string' || !PREFIX.test(idPrefix)) problems.push(`id_prefix must be 2 to 5 capital letters, found ${found(idPrefix)}`)
  if (typeof epicPrefix !== 'string' || !PREFIX.test(epicPrefix)) problems.push(`epic_prefix must be 2 to 5 capital letters, found ${found(epicPrefix)}`)
  if (obj.id_style !== undefined && !ID_STYLES.includes(obj.id_style)) problems.push(`id_style must be ${ID_STYLES.join(' or ')}, found ${found(obj.id_style)}`)

  if (!isObject(obj.statuses)) {
    problems.push(`statuses must be a map of status names, each with a category, found ${found(obj.statuses)}`)
  } else {
    for (const [name, status] of Object.entries(obj.statuses)) {
      const category = isObject(status) ? status.category : undefined
      if (!isCategory(category)) problems.push(`status ${name}: unknown category ${category}`)
    }
  }
  if (typeof obj.default_status !== 'string') problems.push(`default_status must be a string, found ${found(obj.default_status)}`)

  if (!isStringList(obj.types)) problems.push(`types must be a non-empty list of strings, found ${found(obj.types)}`)
  if (!isStringList(obj.priorities)) problems.push(`priorities must be a non-empty list of strings, found ${found(obj.priorities)}`)
  if (obj.labels !== undefined && !(Array.isArray(obj.labels) && obj.labels.every((x) => typeof x === 'string'))) {
    problems.push(`labels must be a list of strings, found ${found(obj.labels)}`)
  }

  if (!isObject(obj.estimate)) {
    problems.push(`estimate must be a map with a unit, found ${found(obj.estimate)}`)
  } else {
    if (!ESTIMATE_UNITS.includes(obj.estimate.unit)) problems.push(`estimate.unit must be ${ESTIMATE_UNITS.slice(0, -1).join(', ')} or ${ESTIMATE_UNITS.at(-1)}, found ${found(obj.estimate.unit)}`)
    const { scale } = obj.estimate
    if (scale !== undefined && !(Array.isArray(scale) && scale.every((x) => typeof x === 'string' || typeof x === 'number'))) {
      problems.push(`estimate.scale must be a list of numbers or strings, found ${found(scale)}`)
    }
  }

  if (obj.members !== undefined && !isObject(obj.members)) {
    problems.push(`members must be a map of member IDs, found ${found(obj.members)}`)
  } else {
    for (const [id, member] of Object.entries(obj.members ?? {})) {
      if (!MEMBER_ID.test(id)) problems.push(`member ${id}: invalid id, use lowercase letters, digits and hyphens, or agent: and a name`)
      if (!isObject(member)) {
        problems.push(`member ${id} must be a map, with name, email or availability, found ${found(member)}`)
        continue
      }
      if (member.name !== undefined && typeof member.name !== 'string') problems.push(`member ${id}: name must be a string, found ${found(member.name)}`)
      if (member.email !== undefined && typeof member.email !== 'string') problems.push(`member ${id}: email must be a string, found ${found(member.email)}`)
      const { availability } = member
      if (availability !== undefined && !(typeof availability === 'number' && availability >= 0 && availability <= 1)) {
        problems.push(`member ${id}: availability must be a number from 0 to 1, found ${found(availability)}`)
      }
    }
  }

  if (obj.defaults !== undefined && !isObject(obj.defaults)) {
    problems.push(`defaults must be a map, found ${found(obj.defaults)}`)
  } else {
    for (const [key, value] of Object.entries(obj.defaults ?? {})) {
      if (key === 'sprint_start_weekday') {
        if (!WEEKDAYS.includes(value)) problems.push(`defaults.${key} must be one of ${WEEKDAYS.join(', ')}, found ${found(value)}`)
      } else if (!Number.isInteger(value) || value <= 0) {
        problems.push(`defaults.${key} must be a positive integer, found ${found(value)}`)
      }
    }
  }
  if (obj.auto_commit !== undefined && typeof obj.auto_commit !== 'boolean') problems.push(`auto_commit must be true or false, found ${found(obj.auto_commit)}`)
  return problems
}

// The format version is checked by loadConfig and validateRepo, before the rest of the config.
export function validateLocalConfig(obj) {
  const problems = localConfigShapeProblems(obj)
  if (obj.id_prefix === obj.epic_prefix) problems.push('id_prefix and epic_prefix must differ')
  const statuses = isObject(obj.statuses) ? obj.statuses : {}
  const used = new Set(Object.values(statuses).map((s) => (isObject(s) ? s.category : undefined)))
  for (const category of CATEGORIES) {
    if (!used.has(category)) problems.push(`category ${category} has no status`)
  }
  if (typeof obj.default_status === 'string' && !Object.hasOwn(statuses, obj.default_status)) problems.push('default_status must be a status')
  return problems
}

function readYaml(file, label) {
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  try {
    return parseYaml(text)
  } catch (error) {
    throw new PmkitError('INVALID_INPUT', `${label} is not valid YAML: ${error.message}`, `Fix ${label}`)
  }
}

export function unsupportedTracker(system) {
  if (system === 'local' || !TRACKERS.includes(system)) return null
  const message = `tracker.system "${system}" is not supported yet`
  return { message, nextStep: 'Set tracker.system to local in .pmkit/config.yaml', problem: `${message}, set it to local` }
}

/** Every problem in a parsed .pmkit/config.yaml: validatePmkitConfig plus the unsupported tracker. Never throws. */
export function pmkitConfigMessages(parsed) {
  const messages = validatePmkitConfig(parsed)
  if (isObject(parsed) && isObject(parsed.tracker)) {
    const unsupported = unsupportedTracker(parsed.tracker.system)
    if (unsupported) messages.push(unsupported.problem)
  }
  return messages
}

export function pmkitWriteRefusal(problems) {
  return new PmkitError('INVALID_INPUT', `.pmkit/config.yaml is not valid, so writes are refused: ${problems.join('; ')}`, 'pmkit validate', { pmkitConfig: { problems } })
}

export function pmkitConfigWarning(problems) {
  return `${pmkitWriteRefusal(problems).message}; run pmkit validate`
}

/** `checkFormat: false` reads a tracker of any format as it is, for `migrate`: no refusal, no migrated copy. */
export function loadConfig(root, { formatVersion = FORMAT_VERSION, migrations = MIGRATIONS, checkFormat = true } = {}) {
  const pmkitFile = join(root, '.pmkit', 'config.yaml')
  if (!existsSync(pmkitFile)) {
    throw new PmkitError('NOT_CONFIGURED', `no .pmkit/config.yaml in ${root}`, '/pmkit:setup')
  }
  const pmkit = readYaml(pmkitFile, '.pmkit/config.yaml')
  const system = isObject(pmkit) && isObject(pmkit.tracker) ? pmkit.tracker.system : undefined
  if (typeof system !== 'string') {
    throw new PmkitError('INVALID_INPUT', '.pmkit/config.yaml has no tracker.system', '/pmkit:setup', { pmkitConfig: { problems: pmkitConfigMessages(pmkit) } })
  }
  const unsupported = unsupportedTracker(system)
  if (unsupported) throw new PmkitError('NOT_SUPPORTED', unsupported.message, unsupported.nextStep)
  const pmkitProblems = pmkitConfigMessages(pmkit)
  const badPath = pmkit.tracker.path !== undefined && pmkit.tracker.path !== null && typeof pmkit.tracker.path !== 'string'
  if (!TRACKERS.includes(system) || badPath) {
    throw new PmkitError('INVALID_INPUT', `.pmkit/config.yaml is not valid: ${pmkitProblems.join('; ')}`, 'pmkit validate', { pmkitConfig: { problems: pmkitProblems } })
  }
  const trackerPath = pmkit.tracker.path ?? '.issues'
  const issuesDir = join(root, trackerPath)
  const localFile = join(issuesDir, 'config.yaml')
  if (!existsSync(localFile)) {
    throw new PmkitError('NOT_CONFIGURED', `no config.yaml in ${issuesDir}`, '/pmkit:setup')
  }
  const label = `${trackerPath}/config.yaml`
  const raw = readYaml(localFile, label)
  // The format comes first: the other checks and every reader assume the current shape.
  const version = isObject(raw) ? raw.version : undefined
  let state
  try {
    state = formatState(version, formatVersion)
  } catch (error) {
    throw new PmkitError('INVALID_INPUT', `${label}: ${error.message}`, `Set version in ${label}`)
  }
  // Format 1 is the first format, so no migration leads from a lower number.
  if (version < 1) throw new PmkitError('INVALID_INPUT', `${label}: the tracker format version must be 1 or more, found ${version}`, `Set version in ${label}`)
  const format = { state, version, current: formatVersion }
  if (!checkFormat) return { pmkit, local: withLocalDefaults(raw), root, issuesDir, format, pmkitProblems }
  if (state === 'ahead') throw formatError(format)
  if (state === 'behind') {
    const readDir = migratedCopy({ root, trackerPath, from: version, to: formatVersion, migrations })
    const local = withLocalDefaults(readYaml(join(readDir, 'config.yaml'), label))
    return { pmkit, local, root, issuesDir, readDir, format, pmkitProblems }
  }
  return { pmkit, local: withLocalDefaults(raw), root, issuesDir, format, pmkitProblems }
}

export function findRoot(start) {
  const from = resolve(start)
  const upward = (marker) => {
    for (let dir = from; ; dir = dirname(dir)) {
      if (existsSync(join(dir, marker))) return dir
      if (dirname(dir) === dir) return null
    }
  }
  return upward(join('.pmkit', 'config.yaml')) ?? upward('.git') ?? from
}
