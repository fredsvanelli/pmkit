import assert from 'node:assert/strict'
import test from 'node:test'
import { isMutation, operationName, paginateConnection } from './lib/graphql.mjs'

test('isMutation finds a mutation after a fragment', () => {
  assert.equal(isMutation('fragment F on Issue { id } mutation M { x { ...F } }'), true)
})

test('isMutation skips a mutation keyword inside a string or a comment', () => {
  assert.equal(isMutation('query Q { search(query: "mutation") { id } } # mutation'), false)
})

test('isMutation counts an unreadable document as a mutation', () => {
  assert.equal(isMutation('query Q { viewer { login }'), true)
  assert.equal(isMutation('query Q { s(q: "open) }'), true)
})

test('isMutation is false for an anonymous query', () => {
  assert.equal(isMutation('{ viewer { login } }'), false)
})

test('operationName skips fragments and returns null for an anonymous query', () => {
  assert.equal(operationName('fragment F on Issue { id } query Issues { x }'), 'Issues')
  assert.equal(operationName('{ viewer { login } }'), null)
})

const broken = (name) => new Error(`broken ${name}`)
const pages = (...list) => {
  const calls = []
  const request = async (document, variables) => {
    calls.push(variables)
    return list[Math.min(calls.length - 1, list.length - 1)]
  }
  return { request, calls }
}
const conn = (ids, next) => ({ c: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes: ids } })

test('paginateConnection joins pages, honors limit and says when there is more', async () => {
  const { request, calls } = pages(conn([1, 2], 'a'), conn([3], 'b'))
  const result = await paginateConnection(request, 'query P { c }', { x: 1 }, { select: (d) => d.c, pageSize: 2, limit: 3 }, { maxPageSize: 100, broken })
  assert.deepEqual(result, { nodes: [1, 2, 3], hasMore: true })
  assert.deepEqual(calls, [{ x: 1, first: 2, after: null }, { x: 1, first: 1, after: 'a' }])
})

test('paginateConnection checks its options against the max page size before any request', async () => {
  const { request, calls } = pages(conn([1], null))
  for (const options of [{ select: (d) => d.c, pageSize: 101 }, {}, { select: (d) => d.c, limit: 0 }, { select: (d) => d.c, maxPages: 0 }]) {
    await assert.rejects(paginateConnection(request, 'query P { c }', {}, options, { maxPageSize: 100, broken }), TypeError)
  }
  assert.equal(calls.length, 0)
  await paginateConnection(request, 'query P { c }', {}, { select: (d) => d.c, pageSize: 250 }, { maxPageSize: 250, broken })
})

test('paginateConnection names the operation of a broken page', async () => {
  const { request } = pages({ c: { nodes: [] } })
  await assert.rejects(paginateConnection(request, 'query Issues { c }', {}, { select: (d) => d.c }, { maxPageSize: 100, broken }), /broken Issues/)
  await assert.rejects(paginateConnection(request, '{ c }', {}, { select: (d) => d.c }, { maxPageSize: 100, broken }), /broken an anonymous query/)
})

test('paginateConnection runs stop after each page and ends the loop when it returns true', async () => {
  const { request, calls } = pages(conn([1, 2], 'a'), conn([3, 4], 'b'), conn([5], null))
  const seen = []
  const stop = async (nodes, connection) => {
    seen.push([nodes, connection.pageInfo.endCursor])
    return nodes.includes(3)
  }
  const result = await paginateConnection(request, 'query P { c }', {}, { select: (d) => d.c, pageSize: 2, stop }, { maxPageSize: 100, broken })
  assert.deepEqual(result, { nodes: [1, 2, 3, 4], hasMore: true })
  assert.deepEqual(seen, [[[1, 2], 'a'], [[3, 4], 'b']])
  assert.equal(calls.length, 2)
})

test('paginateConnection with stop says hasMore false when the stopping page was the last', async () => {
  const { request } = pages(conn([1], null))
  const result = await paginateConnection(request, 'query P { c }', {}, { select: (d) => d.c, stop: async () => true }, { maxPageSize: 100, broken })
  assert.deepEqual(result, { nodes: [1], hasMore: false })
})

test('paginateConnection checks the cursor of a page before stop ends the loop', async () => {
  const { request } = pages(conn([1], ''))
  await assert.rejects(paginateConnection(request, 'query P { c }', {}, { select: (d) => d.c, stop: async () => true }, { maxPageSize: 100, broken }), /broken P/)
})

test('paginateConnection rejects a stop that is not a function before any request', async () => {
  const { request, calls } = pages(conn([1], null))
  await assert.rejects(paginateConnection(request, 'query P { c }', {}, { select: (d) => d.c, stop: true }, { maxPageSize: 100, broken }), TypeError)
  assert.equal(calls.length, 0)
})
