// The inputs of the reviewers' probe scripts (probe.mjs, probe3.mjs, probe3b.mjs, cr-check.mjs), each with the output it
// must give. A regression in scripts/lib/redact.mjs breaks one of these.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact } from './lib/redact.mjs'

const rep = (text, n) => text.repeat(n)
const PROBES = [
  ['ghp', `token ghp_${rep('A1', 18)}`, 'token [redacted]'],
  ['curl header', `curl -H "Authorization: token ghp_${rep('b', 36)}" https://api.github.com`, 'curl -H "Authorization: [redacted]" https://api.github.com'],
  ['url with a key name', 'DATABASE_URL=postgres://app:senha@db/prod', 'DATABASE_URL=postgres://[redacted]@db/prod'],
  ['url with a port', 'connecting to postgres://app:s3cr3t@db.internal:5432/prod', 'connecting to postgres://[redacted]@db.internal:5432/prod'],
  ['url with an at in the password', 'mongodb://user:p@ss@host/db', 'mongodb://[redacted]@host/db'],
  ['url with a token as password', `git clone https://oauth2:glpat-${rep('x', 20)}@gitlab.com/a/b.git`, 'git clone https://[redacted]@gitlab.com/a/b.git'],
  ['url with an empty user', 'redis://:s3cret@cache:6379', 'redis://[redacted]@cache:6379'],
  ['glpat', `pushing with glpat-${rep('x', 20)}`, 'pushing with [redacted]'],
  ['slack after a key', `SLACK=xoxb-123456789012-1234567890123-${rep('a', 24)}`, 'SLACK=[redacted]'],
  ['slack bare', `webhook xoxb-123456789012-1234567890123-${rep('a', 24)}`, 'webhook [redacted]'],
  ['openai', `using key sk-proj-${rep('a', 48)}`, 'using key [redacted]'],
  ['anthropic after a key', `export ANTHROPIC_API_KEY=sk-ant-api03-${rep('a', 90)}`, 'export ANTHROPIC_API_KEY=[redacted]'],
  ['anthropic bare', `calling with sk-ant-api03-${rep('a', 90)}`, 'calling with [redacted]'],
  ['google', `maps key AIzaSy${rep('A', 33)}`, 'maps key [redacted]'],
  ['npm auth token', `//registry.npmjs.org/:_authToken=npm_${rep('a', 36)}`, '//registry.npmjs.org/:_authToken=[redacted]'],
  ['npm bare', `npm token npm_${rep('a', 36)}`, 'npm token [redacted]'],
  ['openssh key', 'line before\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----\nline after: expected 3 events', 'line before\n[redacted]\nline after: expected 3 events'],
  ['pgp key', 'a\n-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBF\n-----END PGP PRIVATE KEY BLOCK-----\nb', 'a\n[redacted]\nb'],
  ['key with no END and a blank line', 'a\n-----BEGIN RSA PRIVATE KEY-----\nMIIE\nxyz\n\nhypothesis 2 stays', 'a\n[redacted]\n\nhypothesis 2 stays'],
  ['key with a blank line and an END', 'a\n-----BEGIN RSA PRIVATE KEY-----\nMIIE\n\nrestofkey\n-----END RSA PRIVATE KEY-----\nb', 'a\n[redacted]\nb'],
  ['aws id', 'AKIAIOSFODNN7EXAMPLE', '[redacted]'],
  ['aws secret', 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'aws_secret_access_key = [redacted]'],
  ['aws secret in the environment', 'AWS_SECRET_ACCESS_KEY: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'AWS_SECRET_ACCESS_KEY: [redacted]'],
  ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc_def', '[redacted]'],
  ['passwd', 'PASSWD=hunter2', 'PASSWD=[redacted]'],
  ['pwd', 'DB_PWD=hunter2', 'DB_PWD=[redacted]'],
  ['credentials', 'credentials=hunter2', 'credentials=[redacted]'],
  ['json api key', '{"apiKey": "abc123def"}', '{"apiKey": [redacted]}'],
  ['stripe', `sk_live_${rep('a', 24)}`, '[redacted]'],
  ['basic auth', 'Authorization: Basic dXNlcjpwYXNz', 'Authorization: [redacted]'],
  ['quoted basic auth', 'Authorization: "Basic dXNlcjpwYXNz"', 'Authorization: [redacted]'],
  ['github actions token', `ghs_${rep('a', 36)}`, '[redacted]'],
  ['password followed by prose', 'password: hunter2 and more', 'password: [redacted]'],
  ['json password', '"password": "hunter2", "user": "x"', '"password": [redacted], "user": "x"'],
  ['yaml password with spaces', '  password: "hunter 2 with space"', '  password: [redacted]'],
  ['password with letters only', 'DB_PASSWORD=supersecret', 'DB_PASSWORD=[redacted]'],
  ['password phrase', 'password: correcthorsebatterystaple', 'password: [redacted]'],
  ['quoted password with letters only', '"password": "hunterhunter"', '"password": [redacted]'],
  ['common password', 'password: postgres', 'password: [redacted]'],
  ['api key with letters only', 'API_KEY=abcdefghijklmnopqrstuv', 'API_KEY=[redacted]'],
  ['hex secret', 'SECRET_KEY_BASE=8f14e45fceea167a5a36dedd4bea2543', 'SECRET_KEY_BASE=[redacted]'],
  ['bearer in lower case', 'x bearer abc123def456', 'x bearer [redacted]'],
  ['long bearer with letters only', 'Bearer AbCdEfGhIjKlMnOpQrStUvWxYz', 'Bearer [redacted]'],
  ['token in a query string', 'GET https://api.example.com/v1/items?access_token=abc12345xyz', 'GET https://api.example.com/v1/items?access_token=[redacted]'],
  ['token in a callback url', 'url=https://x.io/cb?token=abc12345xyz', 'url=https://x.io/cb?token=[redacted]'],
  ['key after another pair', 'a=1&api_key=abc12345xyz&b=2', 'a=1&api_key=[redacted]'],
  ['key after a label', 'env: GITHUB_TOKEN=abc12345xyz', 'env: GITHUB_TOKEN=[redacted]'],
  ['json token', `{"token": "ghp_${rep('A', 36)}"}`, '{"token": [redacted]}'],
  ['authorization with a github token', `Authorization: token ghp_${rep('b', 36)}`, 'Authorization: [redacted]'],
  ['rerun over redacted text', 'Redacted 2 values.\nfoo [redacted]', 'Redacted 2 values.\nfoo [redacted]'],
  // Unchanged: code, prose, paths, numbers and values that are not secrets.
  ['cookie', 'Cookie: session=abcdef123456', 'Cookie: session=abcdef123456'],
  ['docker login', 'docker login -u ci -p hunter2 ghcr.io', 'docker login -u ci -p hunter2 ghcr.io'],
  ['a uuid', 'id 123e4567-e89b-12d3-a456-426614174000', 'id 123e4567-e89b-12d3-a456-426614174000'],
  ['an image data url', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='],
  ['a plain url', 'https://github.com/o/r/actions/runs/42', 'https://github.com/o/r/actions/runs/42'],
  ['markdown about a password', '- `password`: the database password', '- `password`: [redacted]'],
  ['a short bearer word', 'x bearer abcdef', 'x bearer abcdef'],
  ['stack frame with line and column', 'at Object.<anonymous> (src/token.mjs:1234:56)', 'at Object.<anonymous> (src/token.mjs:1234:56)'],
  ['stack frame in secret-manager', 'at run (/app/lib/secret-manager.mjs:1024:15)', 'at run (/app/lib/secret-manager.mjs:1024:15)'],
  ['stack frame in node_modules', '    at tokenize (node_modules/acorn/dist/token.js:2210:11)', '    at tokenize (node_modules/acorn/dist/token.js:2210:11)'],
  ['a numeric token limit', '"max_tokens": "100000"', '"max_tokens": "100000"'],
  ['pwd as a path', 'PWD=/home/runner/work/pmkit/pmkit', 'PWD=/home/runner/work/pmkit/pmkit'],
  ['oldpwd as a path', 'OLDPWD=/home/runner', 'OLDPWD=/home/runner'],
  ['pwd command output', 'pwd: /home/runner/work/pmkit', 'pwd: /home/runner/work/pmkit'],
  // PMK-197: every value after a secret key goes, so these were missed secrets.
  ['password with a dot and a bang', 'DB_PASSWORD=Summer.2024!', 'DB_PASSWORD=[redacted]'],
  ['password with a dot after a colon', 'Password: Hunter.22', 'Password: [redacted]'],
  ['password ending a sentence', 'the password: hunter22.', 'the password: [redacted]'],
  ['password in parentheses', 'password=(hunter22)', 'password=[redacted]'],
  ['password starting with a slash', 'PASSWORD=/x9Kq!zz', 'PASSWORD=[redacted]'],
  ['token with an ampersand and no pair', 'API_TOKEN=abc123&rest', 'API_TOKEN=[redacted]'],
  ['password with an ampersand', 'password=hunter&22', 'password=[redacted]'],
  ['token longer than 512 characters', `AWS_SESSION_TOKEN=${rep('Ab1/', 150)} done`, 'AWS_SESSION_TOKEN=[redacted]'],
  ['json authorization', '{"Authorization": "Basic dXNlcjpwYXNz"}', '{"Authorization": [redacted]}'],
  ['private key in the environment', 'PRIVATE_KEY=MIIEvQIBADANBgkq', 'PRIVATE_KEY=[redacted]'],
  ['curl user and password', 'curl -u admin:hunter22 https://x', 'curl -u [redacted] https://x'],
  ['curl long user option', 'curl --user admin:hunter22 https://x', 'curl --user [redacted] https://x'],
  ['curl user with no password', 'curl -u admin https://x', 'curl -u admin https://x'],
  ['a singular credential name', 'GIT_CREDENTIAL=hunter22', 'GIT_CREDENTIAL=[redacted]'],
  ['value with a semicolon', 'password=pa$$;word123', 'password=[redacted]'],
  ['value ending in a colon and a number', 'secret=Xy7#kL:42', 'secret=[redacted]'],
  ['numeric password', 'password=123456', 'password=[redacted]'],
  // Markdown around the value stays.
  ['token in parentheses', '(token=abc12345xyz)', '(token=[redacted])'],
  ['token in backticks', 'set `token=abc12345xyz` first', 'set `token=[redacted]` first'],
  ['token in bold', 'use **token=abc12345xyz** here', 'use **token=[redacted]** here'],
  ['token in a link text', '[token: abc12345xyz](https://x.io)', '[token: [redacted]](https://x.io)'],
  ['token in a list line', '- token=abc12345xyz, then retry', '- token=[redacted]'],
  // False positives this accepts (listed in the PMK-197 spec).
  ['a short csrf token', 'csrf_token=abc in the form', 'csrf_token=[redacted]'],
  ['prose after a key word', 'token: expired', 'token: [redacted]'],
  ['password read from a request', 'const password = req.body.password', 'const password = [redacted]'],
  ['password read from the environment', 'password: process.env.DB_PASSWORD', 'password: [redacted]'],
  ['password typed as string', 'function login(password: string): Promise<void>', 'function login(password: [redacted]): Promise<void>'],
  ['a comma list', 'a=1,token=x1,b=2', 'a=1,token=[redacted]'],
  // PMK-197 review 2: the value runs to the end of the line, so `&user=bob` goes with the password.
  ['query pair after the secret', 'password=hunter&user=bob', 'password=[redacted]'],
  // Review of PR #155, blocker 1: a quoted value with an escaped quote, a line break or no closing quote goes in full.
  ['escaped quote in a json password', '{"password": "hun\\"ter22"}', '{"password": [redacted]}'],
  ['escaped quote in a token', 'token: "abc\\"def" next', 'token: [redacted] next'],
  ['escaped n inside quotes', 'password="abc\\ndef"', 'password=[redacted]'],
  ['line break inside quotes', 'password="abc\ndef" x', 'password=[redacted] x'],
  ['quote never closed', 'password="abc def', 'password=[redacted]'],
  // Blocker 2: a Unicode space after the separator.
  ['no-break space after the colon', 'password:\u00a0hunter2', 'password:\u00a0[redacted]'],
  ['em space after the equals', 'token=\u2003abc123', 'token=\u2003[redacted]'],
  // Blocker 3: the rest of a value whose start another pattern replaced.
  ['slack token with a tail', 'secret=xoxb-1234567890abc!Rest#9', 'secret=[redacted]'],
  ['google key with a tail', `api_key=AIza${rep('A', 35)}.tail`, 'api_key=[redacted]'],
  ['mark followed by more text', 'password=[redacted]hunter2', 'password=[redacted]'],
  // Blocker 4: YAML block values.
  ['yaml literal block', 'password: |\n  hunter2\nnext: 1', 'password: [redacted]\nnext: 1'],
  ['yaml folded block with a chomp mark', 'token: >-\n  abc123def\n  more\n\n  last\nafter: 1', 'token: [redacted]\nafter: 1'],
  ['yaml block in a list item', '- password: |\n    hunter2\n- other: 1', '- password: [redacted]\n- other: 1'],
  ['yaml value on the next line', 'password:\n  hunter2\nnext: 1', 'password:\n  [redacted]\nnext: 1'],
  ['yaml mapping under the key', 'credentials:\n  user: bob\n  password: hunter2', 'credentials:\n  user: [redacted]\n  password: [redacted]'],
  ['yaml key with nothing under it', 'password:\nnext: 1', 'password:\nnext: 1'],
  // Blocker 7: Markdown wrappers.
  ['token in a table cell', '|token=abc12345|x|', '|token=[redacted]|x|'],
  ['token in underscores', '__token=abc12345__', '__token=[redacted]__'],
  ['token in strikethrough', '~~token=abc12345~~', '~~token=[redacted]~~'],
  // Blocker 8: a file name with a line and a column is not a secret; a dotted name that is not a file is.
  ['stack frame in password.ts', 'at login (src/auth/password.ts:42:13)', 'at login (src/auth/password.ts:42:13)'],
  ['credentials file with a line', 'see lib/credentials.mjs:42 for it', 'see lib/credentials.mjs:42 for it'],
  ['dotted password name', 'my.password=123456', 'my.password=[redacted]'],
  // Review of PR #155, cycle 2. A: YAML in a diff or a log with a timestamp.
  ['yaml block in a diff', '+password: |\n+  hunter2\n+next: 1', '+password: [redacted]\n+next: 1'],
  ['yaml value under an indented key in a diff', '+  password:\n+    hunter2', '+  password:\n+    [redacted]'],
  ['yaml block in a log with a timestamp', '2026-11-09T04:01:05Z password: |\n2026-11-09T04:01:05Z   hunter2\n2026-11-09T04:01:06Z next: 1', '2026-11-09T04:01:05Z password: [redacted]\n2026-11-09T04:01:06Z next: 1'],
  ['diff context after a yaml block stays', '+password: |\n+  hunter2\n other: 1', '+password: [redacted]\n other: 1'],
  // B: a value on the next line that looks like a pair but is not a YAML key.
  ['base64 value on the next line', 'password:\n  c2VjcmV0cGFzcw==', 'password:\n  [redacted]'],
  ['user and password on the next line', 'password:\n  user:hunter2', 'password:\n  [redacted]'],
  // C: a pipe inside a value that is not in a table row.
  ['pipe inside a password', 'DB_PASSWORD=p|ssw0rd', 'DB_PASSWORD=[redacted]'],
  ['pipe inside a value', 'password=hunter|22', 'password=[redacted]'],
  // D: the separators =>, :=, == and ===.
  ['php arrow', "'token' => 'abc123secret'", "'token' => [redacted]"],
  ['quoted arrow', '"password" => "hunter2"', '"password" => [redacted]'],
  ['go assignment', 'password := "hunter2"', 'password := [redacted]'],
  ['comparison', 'if password == "hunter2"', 'if password == [redacted]'],
  // E: a number after a key that ends in the secret word goes; after one that does not, or a file name, it stays.
  ['long numeric api key', 'api_key=83920194857201938472', 'api_key=[redacted]'],
  ['numeric client secret', 'CLIENT_SECRET=1234567890', 'CLIENT_SECRET=[redacted]'],
  ['numeric json secret', '"secret": 48291037', '"secret": [redacted]'],
  ['one-time code', 'token: 482913', 'token: [redacted]'],
  ['token limit', 'token_limit: 100', 'token_limit: 100'],
  ['secret version', 'secret_version=3', 'secret_version=3'],
  ['max tokens before another pair', 'max_tokens=4096, token=abc', 'max_tokens=[redacted]'],
  // F: Markdown that opens inside the value goes with it, so nothing is left unbalanced.
  ['backticked password in prose', 'the password: `hunter2` works', 'the password: [redacted]'],
  ['bold password', 'password: **hunter2**', 'password: [redacted]'],
  ['backticked secret', 'secret=`hunter2`', 'secret=[redacted]'],
  ['code span around the key', 'The `password:` key and `x`', 'The `password:` [redacted]'],
  // G: a YAML block in a list item ends at the sibling keys.
  ['yaml block in a list item keeps the siblings', '  - password: |\n      hunter2\n    user: bob', '  - password: [redacted]\n    user: bob'],
  // Non-blockers of both cycles.
  ['passphrase with spaces', 'password: correct horse battery staple', 'password: [redacted]'],
  ['password ending in a dot', 'password=hunter2.', 'password=[redacted]'],
  ['secret ending in a colon', 'secret=Xy!:', 'secret=[redacted]'],
  ['password of closing marks', 'password=)))', 'password=[redacted]'],
  ['pair inside the password', 'password=se&cret=1', 'password=[redacted]'],
  ['shell concatenation after a quote', 'password="ab"cd', 'password=[redacted]'],
  ['token in a pwd path', `PWD=/home?token=ghp_${rep('a', 36)}`, 'PWD=/home?token=[redacted]'],
  ['yaml indicator in a table cell', '| token: |', '| token: |'],
  ['yaml indicator at the end of the text', 'password: |', 'password: |'],
  ['yaml tag', 'password: !!str hunter2', 'password: [redacted]'],
  ['yaml anchor', 'password: &a hunter2', 'password: [redacted]'],
  ['authorization after a no-break space', 'Authorization: Basic dXNlcjpwYXNz', 'Authorization: [redacted]'],
  ['json authorization with an escaped quote', '{"Authorization": "Basic abc\\"def"}', '{"Authorization": [redacted]}'],
  // Review of PR #155, cycle 3. 1: the `-` of a removed diff line is not part of the key.
  ['removed yaml key in a diff hunk', '@@ -1,4 +1,4 @@\n-token:\n-  abc123\n+token:\n+  def456\n name: app\n replicas: 3', '@@ -1,4 +1,4 @@\n-token:\n-  [redacted]\n+token:\n+  [redacted]\n name: app\n replicas: 3'],
  ['removed yaml block in a diff', '-password: |\n-  old\n+password: |\n+  new\n context: 1\n unrelated line', '-password: [redacted]\n+password: [redacted]\n context: 1\n unrelated line'],
  // 2: a file name followed by a line, a column and a colon.
  ['pytest location', 'tests/test_password.py:42: AssertionError', 'tests/test_password.py:42: AssertionError'],
  ['go location', './token.go:12:5: undefined: x', './token.go:12:5: undefined: x'],
  ['gcc location', 'src/secret.c:10:3: error: bad', 'src/secret.c:10:3: error: bad'],
  ['number and a colon after a token', 'token: 1: x', 'token: [redacted]'],
  // 3: a value that another pattern starts is still replaced to the end of the line.
  ['aws key pair after credentials', 'credentials: AKIAIOSFODNN7EXAMPLE wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'credentials: [redacted]'],
  ['github token and more after token', `token: ghp_${rep('a', 36)} hunter2extra`, 'token: [redacted]'],
  ['slack token and a comma after secret', 'secret: xoxb-1234567890ab, hunter2', 'secret: [redacted]'],
  // 4: every value of a mapping under a secret key goes; the names stay.
  ['mapping under secrets', 'secrets:\n  db: hunter2', 'secrets:\n  db: [redacted]'],
  ['mapping under credentials', 'credentials:\n  username: admin\n  pass: hunter2\nnext: 1', 'credentials:\n  username: [redacted]\n  pass: [redacted]\nnext: 1'],
  ['nested mapping under a secret key', 'secrets:\n  db:\n    pass: hunter2\n  - hunter3', 'secrets:\n  db:\n    pass: [redacted]\n  - [redacted]'],
  // Non-blockers of cycle 3.
  ['blank line at the key column after a timestamp', '2026-11-09T04:01:05Z password:\n2026-11-09T04:01:06    \nnext', '2026-11-09T04:01:05Z password:\n2026-11-09T04:01:06    \nnext'],
  ['yaml block with an anchor', 'password: &pw |\n  hunter2', 'password: [redacted]'],
  ['yaml block with a tag', 'password: !!binary |\n  aHVudGVy', 'password: [redacted]'],
  ['yaml block with a comment', 'password: | # db\n  hunter2', 'password: [redacted]'],
  ['yaml comment before the value', 'password: # below\n  hunter2', 'password: [redacted]'],
  ['hash value with nothing under it', 'PASSWORD=#hunter2', 'PASSWORD=[redacted]'],
  ['yaml quote escape', "token: 'it''s secret'", 'token: [redacted]'],
  ['text right after a closing quote', 'token: "abc"-def', 'token: [redacted]'],
  ['shell quote concatenation', `PASSWORD='pa'"'"'ss'`, 'PASSWORD=[redacted]'],
  ['rails params', '{"password"=>"123456", "password_confirmation"=>"123456"}', '{"password"=>[redacted], "password_confirmation"=>[redacted]}'],
  ['numeric secret key', 'SECRET_KEY=1234567890', 'SECRET_KEY=[redacted]'],
  ['numbered password name', 'password1=123456', 'password1=[redacted]'],
  ['escaped json key', '{"body":"{\\"password\\":\\"hunter2\\"}"}', '{"body":"{\\"password\\":[redacted]}'],
  ['key in brackets', 'config["password"] = "hunter2"', 'config["password"] = [redacted]'],
  ['environment key in brackets', "os.environ['DB_PASSWORD'] = 'hunter2'", "os.environ['DB_PASSWORD'] = [redacted]"],
  ['authorization quote never closed', 'Authorization: "Basic dXNlcjpwYXNz', 'Authorization: [redacted]'],
  ['curl short options before u', 'curl -su admin:hunter22 https://x', 'curl -su [redacted] https://x'],
  // Review of PR #155, cycle 4. 1: a value that opens a block on its line takes the more indented lines below.
  ['formatted json object', '{\n  "credentials": {\n    "user": "bob",\n    "pass": "hunter2"\n  }\n}', '{\n  "credentials": {\n    [redacted]\n  }\n}'],
  ['hcl object', 'secrets = {\n  db = "hunter2"\n}', 'secrets = {\n  [redacted]\n}'],
  ['python tuple', 'password = (\n  "hunter2"\n)', 'password = (\n  [redacted]\n)'],
  ['json array', '"secrets": [\n  "hunter2"\n]', '"secrets": [\n  [redacted]\n]'],
  ['shell line continuation', 'PASSWORD=\\\n  hunter2', 'PASSWORD=\\\n  [redacted]'],
  ['object opened inline', '"credentials": {"user": "bob",\n    "pass": "hunter2"\n}', '"credentials": [redacted]\n}'],
  // 2: a file location in backticks, with a range or before a dot.
  ['file location in backticks', '- `src/auth/password.ts:12` and `src/a.ts:3`', '- `src/auth/password.ts:12` and `src/a.ts:3`'],
  ['file location with a range', '`scripts/lib/token.mjs:42-50` reads the header twice', '`scripts/lib/token.mjs:42-50` reads the header twice'],
  ['file location before a dot in backticks', 'See `lib/token.mjs:42`.', 'See `lib/token.mjs:42`.'],
  ['file location ending a sentence', 'in password.ts:12.', 'in password.ts:12.'],
  // 3: a number is exempt only as the whole value, after a quantity key or in a file location.
  ['grep output of a password file', 'config/password.txt:1:hunter2', 'config/password.txt:[redacted]'],
  ['grep output of a secrets file', '.env.secrets:3:DB=hunter2', '.env.secrets:[redacted]'],
  ['plural key with a number and more', 'api_keys: 12345:abcdef', 'api_keys: [redacted]'],
  ['telegram bot token', 'bot_tokens: 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', 'bot_tokens: [redacted]'],
  ['number then a word after a plural key', 'secrets: 123 hunter2', 'secrets: [redacted]'],
  ['number then a word after a quantity key', 'max_tokens=1000 hunter2', 'max_tokens=[redacted]'],
  ['credentials pin', 'credentials.pin: 1234', 'credentials.pin: [redacted]'],
  ['token value', 'token.value=48291337', 'token.value=[redacted]'],
  ['secret pass', 'SECRET_PASS=12345678', 'SECRET_PASS=[redacted]'],
  ['token pass', 'token_pass=482913', 'token_pass=[redacted]'],
  // 4: a closing mark inside the secret is not the end of the value.
  ['parenthesis inside a password in a call', 'login(password=Pa)ss!w0rd', 'login(password=[redacted]'],
  ['parenthesis inside a password', '(password=hunter)22', '(password=[redacted]'],
  ['parenthesis inside a password after another argument', 'connect(user="x", password=ab)cd,', 'connect(user="x", password=[redacted]'],
  ['backtick inside a token', '`token=ab`cd', '`token=[redacted]'],
  ['brace inside a token', '{token=ab}cd', '{token=[redacted]'],
  ['double underscore inside a token', '__dirname token=abc__xyz', '__dirname token=[redacted]'],
  // 5: a comment inside a YAML block, an indexed key, an empty quoted value followed by text.
  ['comment at column 0 in a mapping', 'credentials:\n# c\n  db: hunter2', 'credentials:\n# c\n  db: [redacted]'],
  ['comment at column 0 before a value', 'password:\n# c\n  hunter2', 'password:\n# c\n  [redacted]'],
  ['indexed key', 'secret[0]=hunter2', 'secret[0]=[redacted]'],
  ['key with a named index', 'token[value]=abc123', 'token[value]=[redacted]'],
  ['empty quotes then a password', 'password: "" hunter2', 'password: [redacted]'],
  ['empty single quotes then a token', "token: '' abc", 'token: [redacted]'],
  ['empty quoted password in json', '{"password": "", "user": "bob"}', '{"password": "", "user": "bob"}'],
  // Non-blockers of cycle 4.
  ['authorization header in code', "headers['Authorization'] = 'Basic dXNlcjpodW50ZXIy'", "headers['Authorization'] = [redacted]"],
  ['escaped authorization in a json string', 'headers: "{\\"Authorization\\": \\"Basic abc\\"}"', 'headers: "{\\"Authorization\\": [redacted]}"'],
  ['quoted mark after authorization', '"Authorization": "[redacted]"', '"Authorization": "[redacted]"'],
  // Review of PR #155, cycle 5. 1: a secret word inside the key's index names the key.
  ['form body key', 'user[password]=hunter2', 'user[password]=[redacted]'],
  ['form body key in a query', 'GET /login?user[password]=hunter2&x=1', 'GET /login?user[password]=[redacted]'],
  ['rails symbol index', 'params[:password] = "hunter2"', 'params[:password] = [redacted]'],
  ['php index', 'data[api_key]=abc123', 'data[api_key]=[redacted]'],
  ['pair inside an index', 'login[password=Ab3]:xY9', 'login[password=[redacted]'],
  ['quantity in an index', 'user[max_tokens]=4096', 'user[max_tokens]=4096'],
  // 2: a closing mark ends the value only when what follows it ends at a space or the end of the line.
  ['parenthesis then a symbol inside a password', 'login(password=Ab3)!xY9', 'login(password=[redacted]'],
  ['parenthesis then an underscore inside a password', 'connect(user=x, password=aB3)_kL9!,', 'connect(user=x, password=[redacted]'],
  ['brace then a dot inside a token', 'login{token: Ab3}.xY9', 'login{token: [redacted]'],
  ['backtick then a colon inside a password', 'login`password=Ab3`:xY9', 'login`password=[redacted]'],
  ['bold then a question mark inside a password', 'login**password=Ab3**?xY9', 'login**password=[redacted]'],
  ['parenthesis then a dot', '(token=x).', '(token=[redacted]).'],
  ['parenthesis then a comma and prose', '(token=x), then retry', '(token=[redacted]), then retry'],
  ['bold then an exclamation mark', '**token=x**!', '**token=[redacted]**!'],
  // 3: Markdown around the key does not hide it.
  ['bold label', '**Password:** hunter2', '**Password:** [redacted]'],
  ['bold label in a list', '- **Password:** hunter2', '- **Password:** [redacted]'],
  ['code label', '`password:` hunter2', '`password:` [redacted]'],
  ['underscore label', '__token:__ abc123', '__token:__ [redacted]'],
  ['strikethrough label', '~~token:~~ abc123', '~~token:~~ [redacted]'],
  ['bold key', '**password**: hunter2', '**password**: [redacted]'],
  ['code key', '`DB_PASSWORD`: hunter2', '`DB_PASSWORD`: [redacted]'],
  ['italic key', '*token*: abc123xyz', '*token*: [redacted]'],
  ['code key and code value', '- `API_TOKEN`=`abc123`', '- `API_TOKEN`=[redacted]'],
]

for (const [name, input, output] of PROBES) {
  test(`probe: ${name}`, () => {
    assert.equal(redact(input).text, output)
  })
}

test('probe: no pattern takes more than a second on 80 thousand characters of its own kind', () => {
  const n = 80000
  const inputs = [rep('a', n), `token${rep('-', n)}`, `x://${rep(':', n)}`, `a://${rep('b:', n / 2)}`, rep('-----BEGIN A PRIVATE KEY-----', n / 29), rep('sk-', n / 3), `Authorization: ${rep('a', n)}`, rep('a://b', n / 5), rep('password:', n / 9), rep('a=1&', n / 4), rep('token=', n / 6), `token=${rep(')', n)}x`, rep('pwd=/', n / 5), rep('token="', n / 7), rep('password: |\n  a\n', n / 16), rep('token:\n  x\n', n / 10), rep('password=[redacted]', n / 19), rep('curl -u ', n / 8), rep('token=&a=', n / 9), rep('&a', n / 2), `token=${rep('a ', n / 2)}`, rep('|token=[redacted]', n / 17), rep('`password:` ', n / 12), rep('+password: |\n+  a\n', n / 18), rep('(token_limit=5) ', n / 16), rep('PWD=/a?token=[redacted] ', n / 24), rep('  - token:\n      a\n', n / 20), rep('token: ', n / 7), `x${rep(' ', n)}token=a`, rep('sk-', n / 3), rep('-token: ', n / 8), `${rep('-', n)}token=a`, `secrets:\n${rep('  a: b\n', n / 7)}`, rep('secrets:\n  a: [redacted]\n', n / 27), rep('-password: |\n-  a\n', n / 18), rep('a.py:1: ', n / 8), rep('a[password]', n / 11), rep('a[', n / 2), rep('**Password:** ', n / 14), rep('**token=x', n / 9), `token=${rep(')!', n / 2)}`, `(token=${rep(')!x', n / 3)}`, `(token=${rep(')', n)}x`, `(token=${rep(').', n / 2)}x`, rep('`token`: ', n / 9), rep('`password:` [redacted] ', n / 23), rep('**Password:** [redacted] ', n / 25), rep('a[password]=[redacted] ', n / 23)]
  for (const input of inputs) {
    const start = process.hrtime.bigint()
    redact(input)
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    assert.ok(ms < 1000, `${JSON.stringify(input.slice(0, 20))} took ${ms} ms`)
  }
})

// Review of PR #155, cycle 5b: a table row of many keys that are skipped (already redacted, a file location, a directory)
// reads the row once, at the size the review measured.
test('probe: a table row of 320 thousand characters of skipped keys takes less than a second', () => {
  const n = 320000
  const inputs = [`|${rep(' token=[redacted]', n / 17)}`, `|${rep(' token.ts:1', n / 11)}`, `|${rep(' PWD=/a', n / 7)}`, `|${rep(' **Password:** [redacted]', n / 25)}`, `|${rep(' token=[redacted] a.ts:1 PWD=/a', n / 31)}`]
  for (const input of inputs) {
    const start = process.hrtime.bigint()
    redact(input)
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    assert.ok(ms < 1000, `${JSON.stringify(input.slice(0, 20))} took ${ms} ms`)
  }
})

test('probe: redact is idempotent over its own output', () => {
  for (const [name, , output] of PROBES) {
    const again = redact(output)
    assert.equal(again.text, output, name)
    assert.equal(again.count, 0, `${name}: ${JSON.stringify(again.counts)}`)
  }
})
