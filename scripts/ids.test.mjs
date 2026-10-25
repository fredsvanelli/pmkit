import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ALPHABET, branchName, compareIds, isId, newId, nextNumberedId, normalizeId } from './lib/ids.mjs'
import { isPmkitError } from './lib/errors.mjs'

test('newId uses 5 characters after 5 collisions', () => {
  const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5]
  let i = 0
  const random = () => seq[i++]
  const taken = new Set(['ISS-0000'])
  const id = newId('ISS', { random, exists: (x) => taken.has(x) })
  assert.equal(id, 'ISS-12345')
})

test('newId uses 6 characters after 10 collisions, then gives up with CONFLICT', () => {
  const lengths = []
  const exists = (id) => {
    lengths.push(id.length - 4)
    return true
  }
  assert.throws(
    () => newId('ISS', { random: () => 0, exists }),
    (error) => isPmkitError(error) && error.code === 'CONFLICT',
  )
  assert.deepEqual(lengths, [...Array(5).fill(4), ...Array(5).fill(5), ...Array(5).fill(6)])
})

test('newId draws each character with random(32)', () => {
  const args = []
  const id = newId('EPC', { random: (n) => (args.push(n), 31), exists: () => false })
  assert.deepEqual(args, [32, 32, 32, 32])
  assert.equal(id, 'EPC-ZZZZ')
})

test('a fresh id matches isId', () => {
  const id = newId('ISS', { random: (n) => Math.floor(Math.random() * n), exists: () => false })
  assert.ok(isId(id, 'ISS'))
  assert.ok(!isId(id, 'EPC'))
})

test('the alphabet is Crockford base32', () => {
  assert.equal(ALPHABET, '0123456789ABCDEFGHJKMNPQRSTVWXYZ')
})

test('nextNumberedId counts up from the highest number with the same prefix', () => {
  assert.equal(nextNumberedId('ISS', []), 'ISS-1')
  assert.equal(nextNumberedId('ISS', ['ISS-1', 'ISS-9', 'ISS-10', '.gitkeep']), 'ISS-11')
  assert.equal(nextNumberedId('ISS', ['ISS-7K3Q', 'EPC-40', 'ISS-0012', 'ISS-3']), 'ISS-4')
})

test('compareIds orders numbered ids by number and other ids as text', () => {
  assert.deepEqual(['ISS-10', 'ISS-2', 'ISS-1', 'ISS-7K3Q', 'EPC-3'].sort(compareIds), ['EPC-3', 'ISS-1', 'ISS-2', 'ISS-10', 'ISS-7K3Q'])
  assert.equal(compareIds('ISS-4P8A', 'ISS-7K3Q'), -1)
})

test('normalizeId trims, upper-cases and decodes look-alike characters', () => {
  assert.equal(normalizeId(' iss-7k3o '), 'ISS-7K30')
  assert.equal(normalizeId('iss-il0o'), 'ISS-1100')
})

test('isId checks the prefix, the alphabet and the length', () => {
  assert.ok(isId('ISS-7K3Q', 'ISS'))
  assert.ok(isId('ISS-7K3Q5', 'ISS'))
  assert.ok(isId('ISS-7K3Q56', 'ISS'))
  assert.ok(!isId('ISS-7K3U', 'ISS'))
  assert.ok(!isId('ISS-7K3', 'ISS'))
  assert.ok(!isId('ISS-7K3Q567', 'ISS'))
  assert.ok(!isId('iss-7k3q', 'ISS'))
})

test('isId accepts numbered ids, without a leading zero', () => {
  assert.ok(isId('ISS-1', 'ISS'))
  assert.ok(isId('ISS-1234567', 'ISS'))
  assert.ok(!isId('ISS-0', 'ISS'))
  assert.ok(!isId('ISS-012', 'ISS'))
  assert.ok(!isId('EPC-12', 'ISS'))
})

test('branchName slugs the title', () => {
  assert.equal(branchName('ISS-7K3Q', 'Retry failed webhook deliveries!'), 'iss-7k3q-retry-failed-webhook-deliveries')
  assert.equal(branchName('ISS-7K3Q', 'Corrigir ação de usuário não encontrado'), 'iss-7k3q-corrigir-acao-de-usuario-nao-encontrado')
})

test('branchName cuts the slug at 40 characters on a dash', () => {
  const branch = branchName('ISS-7K3Q', 'Retry failed webhook deliveries with exponential backoff')
  assert.equal(branch, 'iss-7k3q-retry-failed-webhook-deliveries-with')
  assert.equal(branchName('ISS-7K3Q', 'a'.repeat(60)), `iss-7k3q-${'a'.repeat(40)}`)
})

test('branchName with a title of only symbols is the id', () => {
  assert.equal(branchName('ISS-7K3Q', '!!! ???'), 'iss-7k3q')
})
