import { randomInt } from 'node:crypto'
import { PmkitError } from './errors.mjs'

export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const ATTEMPTS_PER_LENGTH = 5
const LENGTHS = [4, 5, 6]
const SLUG_LIMIT = 40

export function newId(prefix, { random = randomInt, exists = () => false } = {}) {
  for (const length of LENGTHS) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_LENGTH; attempt++) {
      let code = ''
      for (let i = 0; i < length; i++) code += ALPHABET[random(ALPHABET.length)]
      const id = `${prefix}-${code}`
      if (!exists(id)) return id
    }
  }
  throw new PmkitError('CONFLICT', `could not find a free ${prefix} id after ${LENGTHS.length * ATTEMPTS_PER_LENGTH} tries`, 'Try again')
}

export function normalizeId(input) {
  const text = input.trim().toUpperCase()
  const dash = text.lastIndexOf('-')
  const code = text.slice(dash + 1).replace(/[IL]/g, '1').replace(/O/g, '0')
  return dash < 0 ? code : `${text.slice(0, dash + 1)}${code}`
}

export function isId(value, prefix) {
  return new RegExp(`^${prefix}-[${ALPHABET}]{4,6}$`).test(value)
}

export function branchName(id, title) {
  let slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length > SLUG_LIMIT) {
    const cut = slug.slice(0, SLUG_LIMIT)
    const boundary = slug[SLUG_LIMIT] === '-' ? SLUG_LIMIT : cut.lastIndexOf('-')
    slug = (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/, '')
  }
  const base = id.toLowerCase()
  return slug ? `${base}-${slug}` : base
}

/** True when `name` is a branch name `git check-ref-format --branch` accepts and git cannot read as an option. */
export function isBranchName(name) {
  if (typeof name !== 'string' || name === '' || name === '@') return false
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false
  // Control characters, space, DEL and the characters git reserves for revision syntax.
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false
  return name.split('/').every((part) => !part.startsWith('.') && !part.endsWith('.lock'))
}
