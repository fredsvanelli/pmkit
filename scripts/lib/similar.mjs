// Text similarity between issues: cosine of TF-IDF vectors over the title, description and acceptance criteria.
// Pure, so `issues similar` and any other command (PMK-237) can rank issues the same way.

const STOP = new Set('the and for with from that this are was not but you all can has have into when then than they them its our out use used using add new via per also any more some should will'.split(' '))

const stem = (word) => (word.length > 4 && word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)

/** Lower-case words of 3 or more characters, without stop words, with a trailing plural `s` removed. */
export const tokens = (text) => String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem)

/** The title counts twice: it is the densest summary of the work. */
const termCounts = (issue) => {
  const counts = new Map()
  const text = [issue.title, issue.title, issue.description, ...(issue.acceptanceCriteria ?? []).map((c) => c.text)].join('\n')
  for (const word of tokens(text)) counts.set(word, (counts.get(word) ?? 0) + 1)
  return counts
}

/**
 * The `candidates` closest to `target`, best first: `[{ issue, score, shared }]`. `score` is in (0, 1];
 * `shared` holds up to five terms both issues use, heaviest first. A candidate with score 0, and the target itself, are left out.
 * The IDF is taken over the target and the candidates, and a word in every issue keeps a base weight of 1 (a pool of one still ranks).
 */
export function rankSimilar(target, candidates, { limit = 5 } = {}) {
  const pool = candidates.filter((c) => c.id !== target.id)
  const vectors = [target, ...pool].map(termCounts)
  const df = new Map()
  for (const v of vectors) for (const word of v.keys()) df.set(word, (df.get(word) ?? 0) + 1)
  const weigh = (counts) => new Map([...counts].map(([word, n]) => [word, n * (1 + Math.log(vectors.length / df.get(word)))]))
  const norm = (w) => Math.sqrt([...w.values()].reduce((sum, x) => sum + x * x, 0))
  const t = weigh(vectors[0])
  const tNorm = norm(t)
  if (tNorm === 0) return []
  return pool
    .map((issue, i) => {
      const w = weigh(vectors[i + 1])
      const common = [...t].filter(([word]) => w.has(word)).map(([word, x]) => [word, x * w.get(word)]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      const dot = common.reduce((sum, [, x]) => sum + x, 0)
      return { issue, score: dot === 0 ? 0 : dot / (tNorm * norm(w)), shared: common.slice(0, 5).map(([word]) => word) }
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || (a.issue.id < b.issue.id ? -1 : 1))
    .slice(0, limit)
}

/**
 * The `issues similar` result. `found` is what `searchIssues` returned. The result is `complete` only when every issue was read:
 * a file that does not parse (`problems`) or a cut read (`hasMore`) means an empty `similar` is "not verified", never "none".
 * A missing estimate is `null`, never 0.
 */
export function similarResult(target, found, { limit = 5 } = {}) {
  const hasMore = found.hasMore === true
  const problems = found.problems ?? []
  return {
    target: { id: target.id, title: target.title },
    similar: rankSimilar(target, found.issues, { limit }).map(({ issue, score, shared }) => ({
      id: issue.id, title: issue.title, status: issue.status, assignee: issue.assignee ?? null, estimate: issue.estimate ?? null, score: Math.round(score * 1000) / 1000, shared,
    })),
    considered: found.issues.filter((i) => i.id !== target.id).length,
    complete: !hasMore && problems.length === 0,
    hasMore,
    problems,
  }
}
