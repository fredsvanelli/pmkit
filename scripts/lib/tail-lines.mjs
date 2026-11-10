/**
 * The last n lines of a log, and whether earlier lines were dropped. It walks back from the end, so a log of hundreds of MB
 * is not split into an array of lines. A final newline is kept. n is at least 1.
 */
export function tailLines(log, n) {
  let start = log.length - (log.endsWith('\n') ? 1 : 0)
  for (let i = 0; i < n; i++) {
    // start 0 means no newline is left before it: the log has n lines or fewer.
    if (start <= 0) return { log, truncated: false }
    start = log.lastIndexOf('\n', start - 1)
    if (start === -1) return { log, truncated: false }
  }
  return { log: log.slice(start + 1), truncated: true }
}
