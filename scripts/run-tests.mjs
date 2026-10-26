import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Returns the sorted entry names left in dir. */
export function findLeaks(dir) {
  return fs.readdirSync(dir).sort()
}

/** Reports leftovers in the private folder, removes it, and returns the exit code. */
export function finish(privateDir, status) {
  const leaks = findLeaks(privateDir)
  fs.rmSync(privateDir, { recursive: true, force: true })
  if (leaks.length === 0) return status
  process.stderr.write(`pmkit: tests left ${leaks.length} entries in the temp folder:\n${leaks.join('\n')}\n`)
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-run-'))
  const result = spawnSync(process.execPath, ['--test', 'scripts/**/*.test.mjs'], {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env, TMPDIR: privateDir, TMP: privateDir, TEMP: privateDir },
  })
  process.exit(finish(privateDir, result.status ?? 1))
}
