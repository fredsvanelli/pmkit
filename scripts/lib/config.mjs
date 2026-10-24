import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { PmkitError } from './errors.mjs'
import { CATEGORIES, isCategory } from './model.mjs'
import { parseYaml } from './yaml.mjs'

const TRACKERS = ['local', 'linear', 'jira', 'github', 'gitlab', 'azure-devops']
const CONFIRM = ['all_writes', 'single_writes', 'none']
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const PREFIX = /^[A-Z]{2,5}$/
const MEMBER_ID = /^([a-z0-9][a-z0-9-]*|agent:[a-z0-9-]+)$/

const DEFAULTS = {
  default_status: 'backlog',
  epic_prefix: 'EPC',
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

const clone = (value) => JSON.parse(JSON.stringify(value))

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
  } else if (tracker.system === 'local' && typeof tracker.path !== 'string') {
    problems.push('tracker.path must be a string')
  }
  const host = obj.git_host
  if (!isObject(host) || !['github', 'none'].includes(host.system)) {
    problems.push('git_host.system must be github or none')
  }
  const policy = obj.write_policy
  if (!isObject(policy) || !CONFIRM.includes(policy.confirm)) {
    problems.push(`write_policy.confirm must be one of ${CONFIRM.join(', ')}`)
  } else if (policy.preview !== undefined && !Array.isArray(policy.preview)) {
    problems.push('write_policy.preview must be a list')
  }
  return problems
}

export function validateLocalConfig(obj) {
  const problems = []
  if (obj.version !== 1) problems.push('version must be 1')
  const { id_prefix: idPrefix, epic_prefix: epicPrefix } = obj
  if (typeof idPrefix !== 'string' || !PREFIX.test(idPrefix)) problems.push('id_prefix must be 2 to 5 capital letters')
  if (typeof epicPrefix !== 'string' || !PREFIX.test(epicPrefix)) problems.push('epic_prefix must be 2 to 5 capital letters')
  if (idPrefix === epicPrefix) problems.push('id_prefix and epic_prefix must differ')

  const statuses = isObject(obj.statuses) ? obj.statuses : {}
  for (const [name, status] of Object.entries(statuses)) {
    const category = isObject(status) ? status.category : undefined
    if (!isCategory(category)) problems.push(`status ${name}: unknown category ${category}`)
  }
  const used = new Set(Object.values(statuses).map((s) => (isObject(s) ? s.category : undefined)))
  for (const category of CATEGORIES) {
    if (!used.has(category)) problems.push(`category ${category} has no status`)
  }
  if (!Object.hasOwn(statuses, obj.default_status)) problems.push('default_status must be a status')

  if (!isStringList(obj.types)) problems.push('types must be a non-empty list of strings')
  if (!isStringList(obj.priorities)) problems.push('priorities must be a non-empty list of strings')
  if (!['points', 'hours', 'sizes'].includes(obj.estimate?.unit)) problems.push('estimate.unit must be points, hours or sizes')

  for (const [id, member] of Object.entries(isObject(obj.members) ? obj.members : {})) {
    if (!MEMBER_ID.test(id)) problems.push(`member ${id}: invalid id`)
    const availability = isObject(member) ? member.availability : undefined
    if (availability !== undefined && !(typeof availability === 'number' && availability >= 0 && availability <= 1)) {
      problems.push(`member ${id}: availability must be a number from 0 to 1`)
    }
  }

  for (const [key, value] of Object.entries(isObject(obj.defaults) ? obj.defaults : {})) {
    if (key === 'sprint_start_weekday') {
      if (!WEEKDAYS.includes(value)) problems.push(`defaults.${key} must be one of ${WEEKDAYS.join(', ')}`)
    } else if (!Number.isInteger(value) || value <= 0) {
      problems.push(`defaults.${key} must be a positive integer`)
    }
  }
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

export function loadConfig(root) {
  const pmkitFile = join(root, '.pmkit', 'config.yaml')
  if (!existsSync(pmkitFile)) {
    throw new PmkitError('NOT_CONFIGURED', `no .pmkit/config.yaml in ${root}`, '/pmkit:setup')
  }
  const pmkit = readYaml(pmkitFile, '.pmkit/config.yaml')
  const system = pmkit?.tracker?.system
  if (system !== 'local') {
    throw new PmkitError('NOT_SUPPORTED', `tracker.system "${system}" is not supported yet`, 'Set tracker.system to local in .pmkit/config.yaml')
  }
  const issuesDir = join(root, pmkit.tracker.path ?? '.issues')
  const localFile = join(issuesDir, 'config.yaml')
  if (!existsSync(localFile)) {
    throw new PmkitError('NOT_CONFIGURED', `no config.yaml in ${issuesDir}`, '/pmkit:setup')
  }
  const local = withLocalDefaults(readYaml(localFile, `${pmkit.tracker.path ?? '.issues'}/config.yaml`))
  return { pmkit, local, root, issuesDir }
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
