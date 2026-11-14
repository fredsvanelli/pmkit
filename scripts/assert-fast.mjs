// Shared by the timing probes (PMK-303, PMK-307, PMK-312). Not named *.test.mjs, so the glob of scripts/run-tests.mjs does not run it.
// The function runs in a worker_threads Worker that the parent terminates at the ceiling: a timeout of node:test cannot stop
// synchronous work, so a quadratic regression used to hold `npm test` until the function ended. A Worker takes no closures: the
// probe names a module and an export (`lib/redact.mjs#redact`, relative to scripts/) and passes inputs, which are cloned.
import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PROBE_CEILING_MS = 10000
export const START_CEILING_MS = 30000

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))

/**
 * Calls the export `spec` ('path/relative/to/scripts.mjs#name', sync or async) with each input, one after the other, in one
 * Worker. `inputs` is an array of inputs, or one value that is not an array (an input that is an array goes inside one). An
 * input that takes `limitMs` or more fails the probe: the Worker is terminated at the ceiling and the failure names the input
 * and the time. The start of the Worker is not counted, but it has its own ceiling, `startMs`: a module that does not finish
 * its import fails at it, and a Worker that dies or throws at the start fails at once with the cause. `names` (one per input)
 * is what the failure shows instead of the input. The Worker is gone when this settles.
 */
export async function assertFast(spec, inputs, limitMs = PROBE_CEILING_MS, names = inputs, startMs = START_CEILING_MS) {
  const [file, name] = spec.split('#')
  // 1 MB, as the stack of the main thread: the Worker default is 4 MB, so a regex that overflows the stack there would pass here.
  const resourceLimits = { stackSizeMb: 1 }
  const worker = new Worker(here('./assert-fast-worker.mjs'), { resourceLimits, workerData: { module: pathToFileURL(here(file)).href, name } })
  // Every message, error and exit of the Worker, in order, for the awaits below.
  const queue = []
  let wake = () => {}
  const push = (m) => { queue.push(m); wake() }
  worker.on('message', push)
  worker.on('error', (error) => push({ error }))
  worker.on('exit', (code) => push({ exit: code }))
  const reply = (ms) => new Promise((resolve) => {
    let timer
    const poll = () => {
      if (queue.length) { clearTimeout(timer); resolve(queue.shift()) }
    }
    wake = poll
    timer = setTimeout(() => { wake = () => {}; resolve(null) }, ms)
    poll()
  })
  const failed = (answer, what) => {
    if (answer?.error) throw answer.error
    if (answer?.exit !== undefined) throw new Error(`the probe Worker exited with code ${answer.exit} ${what}`)
    if (answer && !answer.ok && !answer.ready) throw Object.assign(new Error(answer.message), { stack: answer.stack })
  }
  const list = Array.isArray(inputs) ? inputs : [inputs]
  const shownNames = Array.isArray(names) ? names : [names]
  try {
    const ready = await reply(startMs)
    failed(ready, 'before it started')
    assert.ok(ready?.ready, `the probe Worker did not start in ${startMs} ms (${spec} does not finish its import)`)
    for (const [i, input] of list.entries()) {
      const start = process.hrtime.bigint()
      worker.postMessage({ input })
      const answer = await reply(limitMs)
      const ms = Number(process.hrtime.bigint() - start) / 1e6
      failed(answer, 'while it ran')
      const shown = JSON.stringify(String(shownNames[i]).slice(0, 20))
      assert.ok(answer && ms < limitMs, `${shown} took ${ms} ms${answer ? '' : ` (stopped at the ceiling of ${limitMs} ms)`}`)
    }
  } finally {
    await worker.terminate()
  }
}
