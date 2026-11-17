import { PmkitError } from '../errors.mjs'
import { parseRepo } from './discovery.mjs'

const ID = /^(?:(.+)#|#)?([1-9][0-9]*)$/

/**
 * Reads a GitHub issue id: "12" or "#12" in the scope repository, or "owner/name#12" in another one.
 * Returns the repository (the scope's spelling when it matches ignoring case) and the number, or null.
 */
export function parseIssueId(value, scopeRepo) {
  const found = typeof value === 'string' ? ID.exec(value) : null
  if (!found) return null
  const number = Number(found[2])
  if (found[1] === undefined) return { repo: scopeRepo, number }
  if (!parseRepo(found[1])) return null
  return { repo: sameRepo(found[1], scopeRepo) ? scopeRepo : found[1], number }
}

const sameRepo = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

export const isIssueId = (value, scopeRepo) => parseIssueId(value, scopeRepo) !== null

/** The id of an issue node: the plain number in the scope repository, else "owner/name#number". */
export const issueIdOf = (node, scopeRepo) => {
  const repo = node.repository.nameWithOwner
  return sameRepo(repo, scopeRepo) ? String(node.number) : `${repo}#${node.number}`
}

/** Plain numbers come first, by value. Then "owner/name#n" ids by repository text, then by number. */
export function compareGithubIds(a, b) {
  const x = /^([1-9][0-9]*)$/.exec(a)
  const y = /^([1-9][0-9]*)$/.exec(b)
  if (x && y) return Number(a) - Number(b)
  if (x) return -1
  if (y) return 1
  const [repoA, numberA] = a.split('#')
  const [repoB, numberB] = b.split('#')
  if (repoA !== repoB) return repoA < repoB ? -1 : 1
  return Number(numberA) - Number(numberB)
}

export const notFound = (id) => new PmkitError('NOT_FOUND', `issue ${id} does not exist`, 'pmkit issues list')
