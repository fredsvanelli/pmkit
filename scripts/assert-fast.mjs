// Shared by the timing probes (PMK-303, PMK-307, PMK-312). Not named *.test.mjs, so the glob of scripts/run-tests.mjs does not run it.
// The function runs in a worker_threads Worker that the parent terminates at the ceiling: a timeout of node:test cannot stop
// synchronous work, so a quadratic regression used to hold `npm test` until the function ended. A Worker takes no closures: the
// probe names a module and an export (`lib/redact.mjs#redact`, relative to scripts/) and passes inputs, which are cloned.
import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PROBE_CEILING_MS = 10000

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))

/**
 * Calls the export `spec` ('path/relative/to/scripts.mjs#name', sync or async) with each input, one after the other, in one
 * Worker. An input that takes `limitMs` or more fails the probe: the Worker is terminated at the ceiling and the failure names
 * the input and the time. The start of the Worker is not counted. `names` (one per input) is what the failure shows when the
 * input is not a string. The Worker is gone when this settles.
 */
export async function assertFast(spec, inputs, limitMs = PROBE_CEILING_MS, names = inputs) {
  const [file, name] = spec.split('#')
  const worker = new Worker(here('./assert-fast-worker.mjs'), { workerData: { module: pathToFileURL(here(file)).href, name } })
  // Every message and error of the Worker, in order, for the awaits below.
  const queue = []
  let wake = () => {}
  const push = (m) => { queue.push(m); wake() }
  worker.on('message', push)
  worker.on('error', (error) => push({ error }))
  const reply = (ms) => new Promise((resolve) => {
    let timer
    const poll = () => {
      if (queue.length) { clearTimeout(timer); resolve(queue.shift()) }
    }
    wake = poll
    if (ms !== undefined) timer = setTimeout(() => { wake = () => {}; resolve(null) }, ms)
    poll()
  })
  try {
    assert.ok((await reply()).ready, 'the probe Worker did not start')
    for (const [i, input] of [].concat(inputs).entries()) {
      const start = process.hrtime.bigint()
      worker.postMessage({ input })
      const answer = await reply(limitMs)
      const ms = Number(process.hrtime.bigint() - start) / 1e6
      if (answer?.error) throw answer.error
      if (answer && !answer.ok) throw Object.assign(new Error(answer.message), { stack: answer.stack })
      const shown = JSON.stringify(String([].concat(names)[i]).slice(0, 20))
      assert.ok(answer && ms < limitMs, `${shown} took ${ms} ms${answer ? '' : ` (stopped at the ceiling of ${limitMs} ms)`}`)
    }
  } finally {
    await worker.terminate()
  }
}
