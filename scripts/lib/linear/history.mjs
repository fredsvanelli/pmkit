// Linear comments and history entries as pmkit comments and events. Pure: no request is sent here.
// See docs/superpowers/specs/2026-10-28-pmk-36-linear-history-comments-design.md, "The event normalizer".

/**
 * Who did it: the user's id, else `bot:<type>` for a bot, else `external:<id>` for a user synced from outside Linear,
 * else `linear` for what Linear did itself, such as an auto-close. `user` is a comment's author and `actor` a history entry's.
 */
export function actorOf({ user, actor, botActor, externalUser } = {}) {
  const id = user?.id ?? actor?.id
  if (id) return id
  if (botActor?.type) return `bot:${botActor.type}`
  if (externalUser?.id) return `external:${externalUser.id}`
  return 'linear'
}

/** The pmkit comment of a Linear comment node. `parent` and `resolved` are present only on a reply and on a resolved root. */
export function toComment(node, issueIdentifier) {
  const comment = {
    id: node.id,
    issue: issueIdentifier,
    author: actorOf(node),
    body: (node.body ?? '').trim(),
    created: node.createdAt,
  }
  if (node.parentId) comment.parent = node.parentId
  if (node.resolvedAt) comment.resolved = { at: node.resolvedAt, by: actorOf({ user: node.resolvingUser }) }
  return comment
}
