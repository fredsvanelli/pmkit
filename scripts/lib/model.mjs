// The common model every tracker adapter maps to. See the pmkit design spec, "Common model".

export const CATEGORIES = ['triage', 'backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled']
export const TERMINAL = ['done', 'canceled']
export const EVENT_OPS = ['create', 'update', 'move', 'assign', 'link', 'unlink', 'comment', 'log_time', 'archive']
export const LINK_KINDS = ['blocks', 'related', 'duplicate']

export const isCategory = (value) => CATEGORIES.includes(value)

/**
 * @typedef {{ name: string, category: string }} Status
 * @typedef {{ text: string, done: boolean }} Criterion
 * @typedef {object} Issue
 * @property {string} id
 * @property {string} title
 * @property {string} [type]
 * @property {Status} status
 * @property {string} [priority]
 * @property {number} [estimate]
 * @property {string} [assignee]
 * @property {string[]} labels
 * @property {string} [parent]
 * @property {string[]} blockedBy
 * @property {string[]} blocks computed
 * @property {string[]} related
 * @property {string[]} duplicateOf
 * @property {string[]} children computed
 * @property {boolean} archived
 * @property {string} [sprint]
 * @property {string} [milestone]
 * @property {string} [due] YYYY-MM-DD
 * @property {string} [branch]
 * @property {string} description
 * @property {Criterion[]} acceptanceCriteria
 * @property {string} created ISO 8601 UTC
 * @property {string} updated ISO 8601 UTC
 * @property {Object<string, *>} [extra] frontmatter keys pmkit does not know, kept on the next write
 *
 * @typedef {{ id: string, issue: string, author: string, body: string, created: string }} Comment
 *
 * @typedef {object} Event
 * @property {string} at ISO 8601 UTC
 * @property {string} by
 * @property {string} op one of EVENT_OPS
 * @property {string} [field]
 * @property {*} [from]
 * @property {*} [to]
 * @property {number} [minutes]
 * @property {boolean} [synthetic]
 *
 * @typedef {object} Sprint
 * @property {string} id
 * @property {string} name
 * @property {string} start YYYY-MM-DD
 * @property {string} end YYYY-MM-DD
 * @property {string} [goal]
 * @property {'planned' | 'active' | 'closed'} state
 * @property {Object<string, number>} capacity member id to points or hours
 * @property {Object<string, string[]>} daysOff member id to dates
 * @property {Object<string, *>} [extra] sprint file keys pmkit does not know, kept on the next write
 *
 * @typedef {object} Epic
 * @property {string} id
 * @property {string} title
 * @property {string} [status]
 * @property {string} [start]
 * @property {string} [target]
 * @property {string} [milestone]
 * @property {string} [description]
 *
 * @typedef {object} Milestone
 * @property {string} id the file stem of milestones/<id>.md
 * @property {string} name
 * @property {string} [due] YYYY-MM-DD
 * @property {string} description
 *
 * @typedef {object} StatusUpdate
 * @property {string} epic
 * @property {string} at
 * @property {string} author
 * @property {'on_track' | 'at_risk' | 'off_track'} health
 * @property {string} body
 *
 * @typedef {{ id: string, name: string, email?: string, availability: number }} Member
 */

/**
 * An issue is blocked when a blocker is not done or canceled.
 * A blocker missing from byId counts as blocking.
 * @param {Issue} issue
 * @param {Map<string, Issue>} byId
 */
export function isBlocked(issue, byId) {
  return (issue.blockedBy ?? []).some((id) => {
    const blocker = byId.get(id)
    return !blocker || !TERMINAL.includes(blocker.status.category)
  })
}

/**
 * Orders two ISO times by the instant they name, so `…:20Z` comes before `…:20.123Z`. A string
 * compare gets that pair backwards. A missing or unreadable time sorts first.
 */
export function compareTimes(a, b) {
  const time = (value) => {
    const parsed = Date.parse(value ?? '')
    return Number.isNaN(parsed) ? -Infinity : parsed
  }
  const ta = time(a)
  const tb = time(b)
  return ta < tb ? -1 : ta > tb ? 1 : 0
}
