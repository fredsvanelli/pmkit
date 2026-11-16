// Exports that the timing probes call inside the Worker of assert-fast.mjs (PMK-312). Not named *.test.mjs.
import { adrInfo, adrStatusDropped } from './lib/adr.mjs'
import { run } from './pmkit.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// Reads the ADR and the lines a refusal names: since PMK-322 only the refusal works out the status line it names (`statusLineOf`), so the probes of PMK-316 and PMK-319 still time it.
export const adrInfoBody = (body) => {
  const text = `# T\n\n## Status\n\n${body}\n---\n\n## Context\n`
  return [adrInfo(text), adrStatusDropped(text)]
}

// A call of `issues comment --redact` with a long body (cli-comment-redact.test.mjs): the test makes the repo and the folder.
export async function commentRedact({ root, file, env, body }) {
  fs.writeFileSync(file, body)
  const { code, stdout } = await run(['issues', 'comment', 'ISS-5N1R', '--body-file', file, '--redact', '--json'], { env, cwd: root })
  assert.equal(code, 0)
  assert.ok(JSON.parse(stdout).body.endsWith('Redacted 1 value.'))
}
