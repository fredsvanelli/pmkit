// Test builders for Linear issue nodes, shaped like the PmkitIssueFields fragment, and for the raw discovery they map against.
import { FAKE_KEY, fakeLinearFetch, fakeWorkspace, page } from './fake-linear-api.mjs'
import { createLinearClient } from './lib/linear/client.mjs'
import { fetchDiscovery } from './lib/linear/discovery.mjs'

/** A connection with the given nodes and no next page. */
export const conn = (nodes) => page(nodes)

/** A label node. */
export const lab = (name, id = `label-${name.toLowerCase()}`, group = null) => ({ id, name, parent: group === null ? null : { name: group } })

const STARTED = { id: 'state-3', type: 'started' }

/** An outgoing relation to `identifier`. */
export const rel = (type, identifier, state = STARTED) => ({ id: `rel-${type}-${identifier}`, type, relatedIssue: { identifier, state } })

/** An incoming relation from `identifier`. */
export const inv = (type, identifier, state = STARTED) => ({ id: `inv-${type}-${identifier}`, type, issue: { identifier, state } })

/** A full fragment-shaped node of team ACME in Backlog, with `overrides` on top. */
export function node(overrides = {}) {
  return {
    id: 'uuid-1',
    identifier: 'ACME-1',
    title: 'Title',
    description: '',
    priority: 0,
    estimate: null,
    dueDate: null,
    branchName: 'acme-1-title',
    archivedAt: null,
    trashed: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    team: { id: 'team-acme', key: 'ACME' },
    state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
    assignee: null,
    parent: null,
    cycle: null,
    labels: conn([]),
    children: conn([]),
    relations: conn([]),
    inverseRelations: conn([]),
    ...overrides,
  }
}

/** The raw discovery of fakeWorkspace(options), read through the real client and discovery code. */
export async function fakeRaw(options = {}) {
  const client = createLinearClient({
    env: { LINEAR_API_KEY: FAKE_KEY },
    tracker: { system: 'linear', scope: { workspace: 'acme' } },
    fetch: fakeLinearFetch(fakeWorkspace(options)),
  })
  return fetchDiscovery(client, { now: () => new Date('2026-10-27T12:00:00Z') })
}
