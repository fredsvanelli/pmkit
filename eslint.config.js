// Lint runs with `npx eslint@10.15.0`, not a devDependency (ADR 0003), so this config
// imports nothing: @eslint/js and globals would not resolve from here.
const node = Object.fromEntries(
  ['AbortSignal', 'Buffer', 'Headers', 'Response', 'URL', 'clearInterval', 'clearTimeout', 'console', 'process', 'setImmediate',
    'setInterval', 'setTimeout', 'structuredClone'].map((name) => [name, 'readonly']),
)

export default [
  { ignores: ['.agents/', '.codex/'] },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: node },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-undef': 'error',
      // `{ key, ...rest }` drops a key, and a leading `_` marks a name kept on purpose.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', ignoreRestSiblings: true, caughtErrors: 'none' }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-self-assign': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-cond-assign': 'error',
      'no-fallthrough': 'error',
      'no-unsafe-finally': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
]
