// Linear issue ids. A small module of its own, so the adapter descriptor can tell ids apart without loading the tracker code.

const ISSUE_ID = /^[A-Za-z][A-Za-z0-9_]*-[0-9]+$/

/** True for a Linear identifier such as ACME-12, in any case. A UUID is not an id in pmkit. */
export const isIssueId = (id) => typeof id === 'string' && ISSUE_ID.test(id)

/** The identifier in upper case. normalizeId is not used: it rewrites I, L and O, which a team key may hold. */
export const issueKey = (id) => id.toUpperCase()
