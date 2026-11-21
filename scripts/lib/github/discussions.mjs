// GitHub Discussions for the GitHub Issues tracker: list, get and comment, read through GraphQL with the gh client.
// A discussion is text anyone who can post wrote, so it travels only as JSON data and GraphQL variables, never in a document.
// See docs/specs/2026-11-17-pmk-90-github-discussions-design.md, and for threads past 100 comments or replies
// docs/superpowers/specs/2026-11-21-pmk-342-discussion-threads-past-100-design.md.

import { PmkitError } from '../errors.mjs'

const MAX = 100
const DEFAULT_LIMIT = 20
const READ_COMMENTS = 100
const READ_REPLIES = 100
const GHOST = 'ghost'
const ENABLE_HINT = 'Turn on Discussions in the repository settings on GitHub'
const STATES = { open: ['OPEN'], closed: ['CLOSED'], all: [] }
const ANSWERED = { yes: true, no: false }

const AUTHOR = 'author { login }'
const PAGE = 'pageInfo { hasNextPage endCursor }'
const REPLY_FIELDS = `id body createdAt upvoteCount ${AUTHOR}`
const COMMENT_FIELDS = `id body createdAt upvoteCount isAnswer ${AUTHOR}
          replies(first: $replies) { totalCount nodes { ${REPLY_FIELDS} } ${PAGE} }`

// Each document starts with its operation, as the fake GitHub reads only the first definition.
export const DISCUSSION_DOCUMENTS = Object.freeze({
  LIST: `query PmkitDiscussions($owner: String!, $name: String!, $first: Int!, $after: String, $states: [DiscussionState!], $categoryId: ID, $answered: Boolean) {
  repository(owner: $owner, name: $name) {
    hasDiscussionsEnabled
    discussions(first: $first, after: $after, states: $states, categoryId: $categoryId, answered: $answered, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number title url closed isAnswered upvoteCount updatedAt ${AUTHOR} category { name } comments { totalCount } }
      ${PAGE}
    }
  }
}`,
  CATEGORIES: `query PmkitDiscussionCategories($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    hasDiscussionsEnabled
    discussionCategories(first: 100) { nodes { id name isAnswerable } ${PAGE} }
  }
}`,
  GET: `query PmkitDiscussion($owner: String!, $name: String!, $number: Int!, $comments: Int!, $replies: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    hasDiscussionsEnabled
    discussion(number: $number) {
      id number title url body closed stateReason locked isAnswered upvoteCount createdAt updatedAt ${AUTHOR}
      category { name isAnswerable }
      labels(first: 50) { nodes { name } }
      answer { id body ${AUTHOR} }
      comments(first: $comments) { totalCount nodes { ${COMMENT_FIELDS} } ${PAGE} }
    }
  }
}`,
  // The further pages of a thread past 100 comments or 100 replies, by node id (PMK-342).
  COMMENTS: `query PmkitDiscussionComments($id: ID!, $first: Int!, $after: String, $replies: Int!) {
  node(id: $id) { ... on Discussion { comments(first: $first, after: $after) { totalCount nodes { ${COMMENT_FIELDS} } ${PAGE} } } }
}`,
  REPLIES: `query PmkitDiscussionReplies($id: ID!, $first: Int!, $after: String) {
  node(id: $id) { ... on DiscussionComment { replies(first: $first, after: $after) { totalCount nodes { ${REPLY_FIELDS} } ${PAGE} } } }
}`,
  COMMENT: `mutation PmkitAddDiscussionComment($input: AddDiscussionCommentInput!) {
  addDiscussionComment(input: $input) { comment { id url } }
}`,
})

/** A discussion number from 12, #12 or the number itself. Anything else is INVALID_INPUT. */
export function parseDiscussionNumber(value) {
  const text = typeof value === 'number' ? String(value) : value
  const match = typeof text === 'string' ? /^#?([1-9]\d{0,9})$/.exec(text.trim()) : null
  if (!match) throw new PmkitError('INVALID_INPUT', `discussion number must be a positive whole number, such as 12 or #12, not "${String(value ?? '')}"`, 'pmkit github discussions list')
  return Number(match[1])
}

function parseLimit(value) {
  if (value === undefined) return DEFAULT_LIMIT
  const limit = /^\d+$/.test(String(value)) ? Number(value) : NaN
  if (!(limit >= 1 && limit <= MAX)) throw new PmkitError('INVALID_INPUT', `--limit must be a whole number from 1 to ${MAX}`, `Pass --limit ${DEFAULT_LIMIT}`)
  return limit
}

function parseChoice(value, choices, flag, fallback) {
  if (value === undefined) return fallback
  if (!Object.hasOwn(choices, value)) {
    const names = Object.keys(choices)
    throw new PmkitError('INVALID_INPUT', `${flag} must be ${names.slice(0, -1).join(', ')} or ${names.at(-1)}`, `Pass ${flag} ${names[0]}`)
  }
  return choices[value]
}

const login = (actor) => actor?.login ?? GHOST
const stateOf = (node) => (node.closed ? 'closed' : 'open')

const summaryView = (node) => ({
  number: node.number, title: node.title, category: node.category?.name ?? null, author: login(node.author), state: stateOf(node),
  answered: node.isAnswered === true, upvotes: node.upvoteCount, comments: node.comments?.totalCount ?? 0, updated: node.updatedAt, url: node.url,
})

const replyView = (node) => ({ id: node.id, author: login(node.author), body: node.body, created: node.createdAt, upvotes: node.upvoteCount })

function fullView(node) {
  return {
    number: node.number, title: node.title, url: node.url, category: { name: node.category?.name ?? null, answerable: node.category?.isAnswerable === true },
    author: login(node.author), created: node.createdAt, updated: node.updatedAt, state: stateOf(node), stateReason: node.stateReason ?? null, locked: node.locked === true,
    answered: node.isAnswered === true, answer: node.answer ? { id: node.answer.id, author: login(node.answer.author), body: node.answer.body } : null,
    upvotes: node.upvoteCount, labels: (node.labels?.nodes ?? []).map((label) => label.name), body: node.body,
    comments: node.comments.nodes.map((comment) => ({
      ...replyView(comment), isAnswer: comment.isAnswer === true, replies: comment.replies.nodes.map(replyView), repliesTotal: comment.replies.totalCount,
    })),
    commentsTotal: node.comments.totalCount,
  }
}

/** The warnings of a thread longer than the read. */
function cutWarnings(view) {
  const warnings = []
  if (view.commentsTotal > view.comments.length) warnings.push(`discussion #${view.number} has ${view.commentsTotal} comments and pmkit read the first ${view.comments.length}`)
  for (const comment of view.comments) {
    if (comment.repliesTotal > comment.replies.length) warnings.push(`comment ${comment.id} has ${comment.repliesTotal} replies and pmkit read the first ${comment.replies.length}`)
  }
  return warnings
}

/** The plain text of a list result. */
export function listText(result) {
  if (!result.available) return `${result.repo} has Discussions turned off; ${result.enableHint}`
  if (result.discussions.length === 0) return `no discussions in ${result.repo}`
  const lines = result.discussions.map((item) => `#${item.number}  ${item.title}  ${item.category}  ${item.state}${item.answered ? ', answered' : ''}  ${item.upvotes} up  ${item.comments} comments  ${item.updated}`)
  return [...lines, ...(result.hasMore ? ['more discussions match; pass --limit to read more'] : [])].join('\n')
}

/** The plain text of a get result: the header and the comment count. The agent writes the summary from --json. */
export function getText(result) {
  if (!result.available) return `${result.repo} has Discussions turned off; ${result.enableHint}`
  const d = result.discussion
  return [
    `#${d.number}  ${d.title}`,
    `${d.category.name}  by ${d.author}  ${d.state}${d.answered ? ', answered' : ''}  ${d.upvotes} up  ${d.commentsTotal} comments`,
    d.url,
  ].join('\n')
}

/** The plain text of a comment result. */
export const commentText = (result, dryRun) => `${dryRun ? 'would comment' : 'commented'} on discussion #${result.discussion}${result.url ? `: ${result.url}` : ''}`

/** The discussion operations of one repository. scope is tracker.scope: { host, repo }. */
export function discussionOperations({ client, scope }) {
  const [owner, name] = scope.repo.split('/')
  const where = { owner, name }
  const off = (extra) => ({ available: false, reason: 'disabled', enableHint: ENABLE_HINT, repo: scope.repo, ...extra })
  // A fine-grained PAT needs the Discussions permission for these calls, so a PAT refusal names it (PMK-341).
  const request = (document, variables) => client.request(document, variables, { permissions: 'Discussions' })

  async function categoryId(category) {
    const { repository } = await request(DISCUSSION_DOCUMENTS.CATEGORIES, where)
    if (!repository.hasDiscussionsEnabled) return { enabled: false }
    const categories = repository.discussionCategories.nodes
    const found = categories.find((candidate) => candidate.name.toLowerCase() === category.toLowerCase())
    if (!found) {
      throw new PmkitError('INVALID_INPUT', `${scope.repo} has no discussion category ${category}; its categories are ${categories.map((item) => item.name).join(', ')}`, 'Pass --category with one of those names')
    }
    return { enabled: true, id: found.id }
  }

  async function list({ category, answered, state, limit } = {}) {
    const variables = { ...where, first: parseLimit(limit), states: parseChoice(state, STATES, '--state', STATES.open), answered: parseChoice(answered, ANSWERED, '--answered', null) }
    if (category !== undefined) {
      const found = await categoryId(String(category))
      if (!found.enabled) return off({ discussions: [], hasMore: false })
      variables.categoryId = found.id
    }
    const { repository } = await request(DISCUSSION_DOCUMENTS.LIST, variables)
    if (!repository.hasDiscussionsEnabled) return off({ discussions: [], hasMore: false })
    return { available: true, repo: scope.repo, discussions: repository.discussions.nodes.map(summaryView), hasMore: repository.discussions.pageInfo.hasNextPage }
  }

  /**
   * The raw read of one discussion: { viewer, node }, or { enabled: false }. A missing number is NOT_FOUND with pmkit's message.
   * size is { comments, replies }: the whole thread for get, one of each for comment, which needs only the id and the title.
   */
  async function read(number, size = { comments: READ_COMMENTS, replies: READ_REPLIES }) {
    try {
      const data = await request(DISCUSSION_DOCUMENTS.GET, { ...where, number, ...size })
      if (!data.repository.hasDiscussionsEnabled) return { enabled: false }
      if (data.repository.discussion) return { enabled: true, viewer: data.viewer?.login ?? null, node: data.repository.discussion }
    } catch (error) {
      if (error?.code !== 'NOT_FOUND') throw error
    }
    // GitHub hides the discussions of a repository with Discussions off, so a miss asks which case it is.
    const { repository } = await request(DISCUSSION_DOCUMENTS.CATEGORIES, where)
    if (!repository.hasDiscussionsEnabled) return { enabled: false }
    throw new PmkitError('NOT_FOUND', `GitHub has no discussion #${number} in ${scope.repo}`, 'pmkit github discussions list')
  }

  // paginate's default cap of 10 pages is the documented limit: 1000 comments, 1000 replies per comment. cutWarnings names the rest.
  const allNodes = async (document, variables, pick) =>
    (await client.paginate(document, variables, { select: (data) => pick(data.node), pageSize: READ_COMMENTS, permissions: 'Discussions' })).nodes

  /** Reads every page of a cut comments or replies connection, so a thread past 100 comes back whole up to the limit. */
  async function completeThread(node) {
    if (node.comments.pageInfo?.hasNextPage === true) {
      node.comments.nodes = await allNodes(DISCUSSION_DOCUMENTS.COMMENTS, { id: node.id, replies: READ_REPLIES }, (found) => found.comments)
    }
    for (const comment of node.comments.nodes) {
      if (comment.replies.pageInfo?.hasNextPage !== true) continue
      comment.replies.nodes = await allNodes(DISCUSSION_DOCUMENTS.REPLIES, { id: comment.id }, (found) => found.replies)
    }
    return node
  }

  async function get(value) {
    const found = await read(parseDiscussionNumber(value))
    if (!found.enabled) return off({ discussion: null, warnings: [] })
    const discussion = fullView(await completeThread(found.node))
    return { available: true, repo: scope.repo, discussion, warnings: cutWarnings(discussion) }
  }

  async function comment(value, body, { dryRun = false } = {}) {
    const number = parseDiscussionNumber(value)
    const text = typeof body === 'string' ? body.trim() : ''
    if (text === '') throw new PmkitError('INVALID_INPUT', 'the comment body is empty', 'Write the comment to the --body-file file')
    const found = await read(number, { comments: 1, replies: 1 })
    if (!found.enabled) throw new PmkitError('NOT_SUPPORTED', `${scope.repo} has Discussions turned off`, ENABLE_HINT)
    const result = { discussion: number, title: found.node.title, url: null, body: text, author: found.viewer }
    if (dryRun) return result
    const data = await request(DISCUSSION_DOCUMENTS.COMMENT, { input: { discussionId: found.node.id, body: text } })
    return { ...result, url: data.addDiscussionComment.comment.url }
  }

  return { list, get, comment }
}
