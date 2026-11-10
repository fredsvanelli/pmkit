// Linear releases as pmkit releases (PMK-246). The id is the release UUID, as milestones use theirs. A canceled release is
// outside pmkit: it is not listed, not read, and does not count as an issue's release.
// See docs/superpowers/specs/2026-11-10-pmk-246-linear-releases-design.md.

import { PmkitError } from '../errors.mjs'
import { compareReleaseIds } from '../local/releases.mjs'
import { RELEASES_QUERY, RELEASE_QUERY } from './documents.mjs'
import { RELEASES_HINT } from './manifest.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE = 100
const MAX_PAGES = 100

const canceled = (node) => node.stage?.type === 'canceled'

/** The refusal of a release write or filter on a workspace with releases off. */
export const releasesOff = () => new PmkitError('NOT_SUPPORTED', 'Linear releases are off in this workspace', RELEASES_HINT)

/** The pmkit release of a Linear release node. */
export function toRelease(node) {
  const release = { id: node.id, name: node.name }
  if (node.targetDate) release.target = node.targetDate
  if (node.completedAt) release.released = node.completedAt
  release.state = node.completedAt ? 'released' : 'planned'
  release.description = node.description ?? ''
  return release
}

/** The release keys of an issue from its release nodes: `release` for one, `releases` for two or more, none for none. Canceled ones do not count. */
export function issueReleaseFields(nodes) {
  const ids = nodes.filter((node) => !canceled(node)).map((node) => node.id).sort()
  if (ids.length === 0) return {}
  return ids.length === 1 ? { release: ids[0] } : { releases: ids }
}

/** Every page of a release connection, or UPSTREAM when the page cap cut it, so a partial list never reads as the whole. */
export async function allReleases(client, document, variables, select) {
  const { nodes, hasMore } = await client.paginate(document, variables, { select, pageSize: PAGE, maxPages: MAX_PAGES })
  if (hasMore) throw new PmkitError('UPSTREAM', `Linear has more than ${PAGE * MAX_PAGES} releases here, and pmkit does not answer with part of them`, 'Archive old releases in Linear')
  return nodes
}

export function releaseOperations({ client, config }) {
  const team = config.pmkit?.tracker?.scope?.team

  /** The raw release node of an id, or NOT_FOUND: unknown, malformed (no request) or canceled. */
  async function resolveRelease(id) {
    const missing = () => new PmkitError('NOT_FOUND', `release ${id} does not exist`, 'pmkit release list')
    if (typeof id !== 'string' || !UUID.test(id)) throw missing()
    let node
    try {
      node = (await client.request(RELEASE_QUERY, { id })).release
    } catch (error) {
      if (error instanceof PmkitError && /not found/i.test(error.message)) throw missing()
      throw error
    }
    if (!node) throw missing()
    if (canceled(node)) throw new PmkitError('NOT_FOUND', `release ${id} was canceled in Linear`, 'pmkit release list')
    return node
  }

  async function listReleases({ state } = {}) {
    if (state !== undefined && !['planned', 'released'].includes(state)) throw new PmkitError('INVALID_INPUT', 'state must be planned or released', 'pmkit release list')
    const filter = { pipeline: { teams: { some: { key: { eq: team } } } } }
    const nodes = await allReleases(client, RELEASES_QUERY, { filter }, (data) => data.releases)
    const key = (node) => node.version ?? node.name
    return nodes
      .filter((node) => !canceled(node))
      .sort((a, b) => compareReleaseIds(key(a), key(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(toRelease)
      .filter((release) => state === undefined || release.state === state)
  }

  return { listReleases, getRelease: async (id) => toRelease(await resolveRelease(id)), resolveRelease }
}
