// The discussions of the stateful fake GitHub (scripts/fake-github-issues.mjs): the reads and the comment mutation of
// scripts/lib/github/discussions.mjs (with the further pages of PMK-342), and seedDiscussion. A discussion takes its number from the same counter as the
// repository's issues, as on GitHub. See docs/specs/2026-11-17-pmk-90-github-discussions-design.md.

export const DEFAULT_CATEGORIES = [
  { id: 'DIC_1', name: 'Announcements', isAnswerable: false },
  { id: 'DIC_2', name: 'General', isAnswerable: false },
  { id: 'DIC_3', name: 'Ideas', isAnswerable: false },
  { id: 'DIC_4', name: 'Q&A', isAnswerable: true },
]

/** Adds the discussion keys to a state, new or loaded from an older toJSON(). */
export function initDiscussions(state, { discussionsEnabled = true, discussionCategories = DEFAULT_CATEGORIES } = {}) {
  state.discussionsEnabled ??= discussionsEnabled
  state.discussionCategories ??= structuredClone(discussionCategories)
  state.discussions ??= []
  state.counters.discussionComment ??= 0
}

/**
 * The discussion routes over a fake's state. helpers: stamp, register (the repository entry of a name), requireRepository,
 * refuseWithData, unknownNode, connection and page, as the fake defines them.
 */
export function discussionRoutes(state, { stamp, register, requireRepository, refuseWithData, unknownNode, connection, page }) {
  const author = (login) => (login === null ? null : { login })
  const categoryOf = (record) => state.discussionCategories.find((category) => category.id === record.categoryId)
  const inRepo = (entry) => state.discussions.filter((record) => record.repo === entry.nameWithOwner)
  const urlOf = (record) => `https://${state.host}/${record.repo}/discussions/${record.number}`
  const answerOf = (record) => record.comments.find((comment) => comment.isAnswer) ?? null

  const replyView = (reply) => ({ id: reply.id, body: reply.body, createdAt: reply.createdAt, upvoteCount: reply.upvotes, author: author(reply.author) })
  const commentView = (comment, replies) => ({
    ...replyView(comment), isAnswer: comment.isAnswer, replies: { totalCount: comment.replies.length, ...connection(comment.replies.map(replyView), replies) },
  })
  const summaryView = (record) => ({
    number: record.number, title: record.title, url: urlOf(record), closed: record.closed, isAnswered: answerOf(record) !== null,
    upvoteCount: record.upvotes, updatedAt: record.updatedAt, author: author(record.author), category: { name: categoryOf(record).name }, comments: { totalCount: record.comments.length },
  })
  const fullView = (record, { comments, replies }) => {
    const answer = answerOf(record)
    const category = categoryOf(record)
    return {
      ...summaryView(record), id: record.id, body: record.body, stateReason: record.stateReason, locked: record.locked, createdAt: record.createdAt,
      category: { name: category.name, isAnswerable: category.isAnswerable }, labels: page(record.labels.map((name) => ({ name }))),
      answer: answer ? { id: answer.id, body: answer.body, author: author(answer.author) } : null,
      comments: { totalCount: record.comments.length, ...connection(record.comments.map((comment) => commentView(comment, replies)), comments) },
    }
  }

  function findDiscussion(vars) {
    const entry = requireRepository(vars)
    const record = state.discussionsEnabled ? inRepo(entry).find((candidate) => candidate.number === vars.number) : undefined
    if (!record) refuseWithData({ repository: { discussion: null } }, ['repository', 'discussion'], `Could not resolve to a Discussion with the number of ${vars.number}.`)
    return record
  }

  const queries = {
    PmkitDiscussions(vars) {
      const entry = requireRepository(vars)
      const states = vars.states ?? []
      const found = (state.discussionsEnabled ? inRepo(entry) : [])
        .filter((record) => states.length === 0 || states.includes(record.closed ? 'CLOSED' : 'OPEN'))
        .filter((record) => !vars.categoryId || record.categoryId === vars.categoryId)
        .filter((record) => vars.answered === undefined || vars.answered === null || (answerOf(record) !== null) === vars.answered)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return { repository: { hasDiscussionsEnabled: state.discussionsEnabled, discussions: connection(found.map(summaryView), vars.first, vars.after) } }
    },
    PmkitDiscussionCategories(vars) {
      requireRepository(vars)
      return { repository: { hasDiscussionsEnabled: state.discussionsEnabled, discussionCategories: page(state.discussionsEnabled ? state.discussionCategories : []) } }
    },
    PmkitDiscussion(vars) {
      const record = findDiscussion(vars)
      return { viewer: { login: state.viewer }, repository: { hasDiscussionsEnabled: true, discussion: fullView(record, { comments: vars.comments, replies: vars.replies }) } }
    },
    // The further pages of get (PMK-342): a discussion's comments and a comment's replies, by node id.
    PmkitDiscussionComments(vars) {
      const record = state.discussions.find((candidate) => candidate.id === vars.id) ?? unknownNode(vars.id)
      const views = record.comments.map((comment) => commentView(comment, vars.replies))
      return { node: { comments: { totalCount: record.comments.length, ...connection(views, vars.first, vars.after) } } }
    },
    PmkitDiscussionReplies(vars) {
      const comment = state.discussions.flatMap((record) => record.comments).find((candidate) => candidate.id === vars.id) ?? unknownNode(vars.id)
      return { node: { replies: { totalCount: comment.replies.length, ...connection(comment.replies.map(replyView), vars.first, vars.after) } } }
    },
  }

  const mutations = {
    PmkitAddDiscussionComment(input, at) {
      const record = state.discussions.find((candidate) => candidate.id === input.discussionId) ?? unknownNode(input.discussionId)
      if (typeof input.body !== 'string' || input.body.trim() === '') refuseWithData({ addDiscussionComment: null }, ['addDiscussionComment'], "Body can't be blank")
      state.counters.discussionComment += 1
      const comment = { id: `DC_${state.counters.discussionComment}`, author: state.viewer, body: input.body, createdAt: at, upvotes: 0, isAnswer: false, replies: [] }
      record.comments.push(comment)
      record.updatedAt = at
      return { addDiscussionComment: { comment: { id: comment.id, url: `${urlOf(record)}#discussioncomment-${state.counters.discussionComment}` } } }
    },
  }

  /**
   * Adds a discussion. Fields: repo, number, title, body, category (name), author (a login, or null for a deleted account),
   * state (OPEN or CLOSED), stateReason, locked, labels (names), upvotes, createdAt, updatedAt, and comments, each
   * { author, body, upvotes, isAnswer, replies: [{ author, body, upvotes }] }. Returns { id, number }.
   */
  function seedDiscussion({ repo = state.repo, number, title = 'Seeded discussion', body = '', category = 'General', author: login = state.viewer, state: discussionState = 'OPEN', stateReason = null, locked = false, labels = [], upvotes = 0, createdAt, updatedAt, comments = [] } = {}) {
    const entry = register(repo)
    const chosen = number ?? entry.next
    entry.next = Math.max(entry.next, chosen + 1)
    const found = state.discussionCategories.find((candidate) => candidate.name === category)
    if (!found) throw new Error(`fake GitHub: seed names an unknown discussion category ${category}`)
    const at = createdAt ?? stamp()
    const newComment = ({ author: by = state.viewer, body: text = '', upvotes: votes = 0, isAnswer = false, replies = [] }) => {
      state.counters.discussionComment += 1
      return { id: `DC_${state.counters.discussionComment}`, author: by, body: text, createdAt: at, upvotes: votes, isAnswer, replies: replies.map((reply) => newComment(reply)) }
    }
    const record = {
      id: `D_${state.discussions.length + 1}`, repo: entry.nameWithOwner, number: chosen, title, body, categoryId: found.id, author: login,
      closed: discussionState === 'CLOSED', stateReason, locked, labels: [...labels], upvotes, createdAt: at, updatedAt: updatedAt ?? at,
      comments: comments.map(newComment),
    }
    state.discussions.push(record)
    return { id: record.id, number: record.number }
  }

  return { queries, mutations, seedDiscussion }
}
