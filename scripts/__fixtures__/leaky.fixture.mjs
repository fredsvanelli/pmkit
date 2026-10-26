// Run by test-helpers.test.mjs in a child process. Makes a temp folder, records its path and fails.
import { test } from 'node:test'
import fs from 'node:fs'
import { tempDir } from '../test-helpers.mjs'

test('leaky test', () => {
  const dir = tempDir('pmkit-leaky-')
  fs.writeFileSync(process.env.LEAKY_OUT, dir)
  throw new Error('fails on purpose')
})
