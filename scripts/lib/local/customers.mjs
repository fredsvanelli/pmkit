// Customer files: customers/<ID>.md, a customer whose requests link to issues.
// Reading, validating, ordering and serializing; the tracker decides when to write.
// See docs/superpowers/specs/2026-10-31-pmk-46-customers-and-requests-design.md.

import fs from 'node:fs'
import { PmkitError } from '../errors.mjs'
import { stringifyYaml } from '../yaml.mjs'
import { parseFile } from './epics.mjs'

/** Customer ids are CUS- and a code that follows id_style, as in CUS-7K3Q or CUS-1. */
export const CUSTOMER_PREFIX = 'CUS'
export const CUSTOMER_KEYS = ['name', 'status', 'tier', 'revenue', 'size', 'owner']
const DOCTOR = '/pmkit:local:doctor'

/** The stems of the `.md` files in a folder, as stored. A missing folder gives an empty set. */
export function mdStems(dir) {
  if (!fs.existsSync(dir)) return new Set()
  return new Set(fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.slice(0, -'.md'.length)))
}

/** A one-line text value of a frontmatter key, or undefined when the key is absent. */
export function lineValue(data, key, bad) {
  if (data[key] == null) return undefined
  if (typeof data[key] !== 'string' && typeof data[key] !== 'number') throw bad(`has a ${key} that is not text`)
  const value = String(data[key]).trim()
  if (value === '') throw bad(`has an empty ${key}`)
  if (/[\r\n]/.test(value)) throw bad(`has a ${key} with a line break`)
  return value
}

/** Parses the text of customers/<id>.md. The file stem is the id, so an `id` key in the frontmatter is ignored. */
export function parseCustomer(text, id) {
  const { data, body } = parseFile(text, `customer ${id}`)
  const bad = (why) => new PmkitError('INVALID_INPUT', `customer file ${id}.md ${why}`, DOCTOR)
  const name = data.name == null ? undefined : lineValue(data, 'name', bad)
  if (name === undefined) throw bad('needs a name')
  const customer = { id, name }
  for (const key of ['status', 'tier']) {
    const value = lineValue(data, key, bad)
    if (value !== undefined) customer[key] = value
  }
  if (data.revenue != null) {
    if (!Number.isInteger(data.revenue) || data.revenue < 0) throw bad(`has revenue "${data.revenue}", expected a whole number of at least 0`)
    customer.revenue = data.revenue
  }
  if (data.size != null) {
    if (typeof data.size !== 'number' || !Number.isFinite(data.size) || data.size < 0) throw bad(`has size "${data.size}", expected a number of at least 0`)
    customer.size = data.size
  }
  if (data.owner != null) {
    if (typeof data.owner !== 'string') throw bad('has an owner that is not a member id')
    customer.owner = lineValue(data, 'owner', bad)
  }
  customer.notes = body
  return customer
}

/** The text of a customer file. The body holds the notes, left out when they are empty. */
export function serializeCustomer(customer) {
  const values = Object.fromEntries(CUSTOMER_KEYS.map((key) => [key, customer[key]]))
  const head = `---\n${stringifyYaml(values, { order: CUSTOMER_KEYS })}---\n`
  return customer.notes ? `${head}\n${customer.notes}\n` : head
}

/** Customers with the highest revenue first, then by name, as Linear's list orders them. A missing revenue sorts last. */
export function sortCustomers(list) {
  return [...list].sort((a, b) => {
    if ((a.revenue ?? null) !== (b.revenue ?? null)) {
      if (a.revenue == null) return 1
      if (b.revenue == null) return -1
      return b.revenue - a.revenue
    }
    return String(a.name).localeCompare(String(b.name))
  })
}
