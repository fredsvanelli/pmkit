import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tempDir, userStoreEnv } from './test-helpers.mjs'

test('userStoreEnv returns a home folder and the four variables under it', () => {
  const { home, env } = userStoreEnv()
  assert.ok(fs.existsSync(home))
  for (const name of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'PMKIT_HOME']) {
    assert.ok(env[name].startsWith(home), name)
  }
  assert.equal(env.PMKIT_HOME, path.join(home, '.config', 'pmkit'))
})
