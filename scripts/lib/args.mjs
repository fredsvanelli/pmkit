import { PmkitError } from './errors.mjs'

// Flags that never take a value, so `--dry-run ISS-1` keeps ISS-1 as a positional.
export const BOOLEANS = new Set(['json', 'dry-run', 'help', 'blocked', 'archived', 'comments', 'history', 'remove', 'draft'])
// Commands with a second word: `issues move`, `cycle open`.
export const GROUPS = new Set(['issues', 'cycle', 'epic', 'metrics', 'pr', 'docs'])

/**
 * Splits argv into a command (one or two words), options and positionals.
 * A repeated option becomes an array, so `--set a=1 --set b=2` keeps both.
 * A boolean flag written `--flag=value` takes only `true` or `false`.
 */
export function parseArgs(argv, { booleans = BOOLEANS, groups = GROUPS } = {}) {
  const options = {}
  const words = []
  const set = (key, value) => {
    if (!(key in options)) options[key] = value
    else options[key] = [...[options[key]].flat(), value]
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq > 0) {
        const key = arg.slice(2, eq)
        const value = arg.slice(eq + 1)
        if (booleans.has(key) && value !== 'true' && value !== 'false') {
          throw new PmkitError('INVALID_INPUT', `--${key} takes true or false, got "${value}"`, 'node scripts/pmkit.mjs --help')
        }
        set(key, booleans.has(key) ? value === 'true' : value)
        continue
      }
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (booleans.has(key) || next === undefined || next.startsWith('--')) {
        set(key, true)
      } else {
        set(key, next)
        i++
      }
    } else {
      words.push(arg)
    }
  }
  const grouped = words.length > 0 && groups.has(words[0]) && words.length > 1
  const command = grouped ? `${words[0]} ${words[1]}` : words[0]
  return { command, options, positionals: words.slice(grouped ? 2 : 1) }
}
