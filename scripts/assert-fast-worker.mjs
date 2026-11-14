// Runs inside the Worker of assert-fast.mjs (PMK-312): imports the probe's module, calls the export with each input the parent
// posts, and answers `done` or `fail`. Not named *.test.mjs, so the glob of scripts/run-tests.mjs does not run it.
import { parentPort, workerData } from 'node:worker_threads'

const fn = (await import(workerData.module))[workerData.name]
parentPort.on('message', async ({ input }) => {
  try {
    await fn(input)
    parentPort.postMessage({ ok: true })
  } catch (error) {
    parentPort.postMessage({ ok: false, message: error?.message ?? String(error), stack: error?.stack })
  }
})
parentPort.postMessage({ ready: true })
