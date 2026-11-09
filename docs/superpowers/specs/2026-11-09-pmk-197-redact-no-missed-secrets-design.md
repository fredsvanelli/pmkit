# PMK-197: text redact trades false positives for no missed secrets

Follow-up of PMK-63 (`text redact`, PR #108). Files: `scripts/lib/redact.mjs`, `scripts/redact-probes.test.mjs`, `scripts/redact.test.mjs`, `scripts/__scenarios__/issues-investigate-bug.mjs`, and the text that lists the types (`commands/issues/investigate-bug.md`, `README.md`, CHANGELOG). Non-goals: the improvements in `docs/superpowers/epc-6-follow-ups.md`.

## Intent

`text redact` is a second layer over text the agent quotes. A leaked secret costs more than an over-redacted word, so the key/value rule changes from "redact when the value looks like a secret" to "redact unless the value is provably not one".

## The rule

A pair is `key` + `=` or `:` + value, where the key contains `password`, `passwd`, `pwd`, `credential(s)`, `secret`, `token`, `api_key` (or `apikey`), or `private_key`. The value is replaced in full unless it falls under one of the exemptions below.

- **Unquoted value:** runs to the next whitespace. `.`, `(`, `/`, `~`, `;`, `,`, `$`, `#` and `:` no longer end it or exempt it. `&` ends it only when a new `name=` follows (`a=1&api_key=x&b=2` keeps `&b=2`); `API_TOKEN=abc123&rest` and `password=hunter&22` are redacted in full. There is no 512-character cap.
- **Quoted value:** the quoted text, as before.
- **Markdown stays intact:** trailing wrapper characters `) ] } > * ` ' " , . ; :` are cut off the value and stay in the text, so `(token=abc)`, `` `token=abc` `` and `**token=abc**` keep their closing mark.
- **Authorization:** `"Authorization": "Basic ..."` (JSON, a quote before the colon) is redacted like the header line.
- **curl:** the value of `-u` or `--user` on a `curl` line is redacted when it holds a `:` (`curl -u admin:hunter22 https://x` becomes `curl -u [redacted] https://x`). New type `curl_user`.

## Exemptions (the only values left alone)

1. Already `[redacted]`.
2. Empty.
3. For a key that is not a password name (`token`, `secret`, `api_key`, `private_key`): a number or `n:n` (a limit, port, `file.mjs:12:5`). Password names have no such exemption (`password=123456` is redacted).
4. A key that is exactly `pwd` or `oldpwd` (the shell variable and the `pwd` command, not `DB_PWD`) with a value that starts with `/` or `~`: it is a directory.

The length floors, the "needs a digit or symbol" test and the code-word and `process.env.` exemptions are removed.

## False positives this accepts

- Prose after a key word: `token: expired`, `the secret: see below`, `csrf_token=abc`, `tokenizer: bpe`.
- Code that names a key word: `password: string`, `const password = req.body.password`, `password: process.env.DB_PASSWORD`, `secret: null`, `token = getToken()`. Only the first word after the separator is replaced.
- Operators and calls: `password === undefined` becomes `password =[redacted] undefined`, `const token = getToken(req)` becomes `const token = [redacted])`, `Unexpected token: <` loses the `<`.
- A name that holds a key word: `secretName: x`, `tokenizer=cl100k`.
- A comma-separated list `a=1,token=x,b=2`: the value runs to whitespace, so `,b=2` is replaced too.
- `pwd=/x9Kq` and `PWD=~/secret`: kept (exemption 4), a missed secret for a key named exactly `pwd`.

## Ceilings kept (missed secrets that remain)

- A password that ends in a wrapper character (`pass.`, `pass)`) leaves that last character visible.
- `password=hunter&user=bob`: `&user=` is read as a new pair, so `&user=bob` stays and `hunter` goes.
- A value the key does not name (`-p hunter2` in `docker login`, `Cookie: session=...`) stays; probes pin it.

## Tests

Every case in the issue has a probe with the output. Probes that pinned the old gaps now pin the new output; probes whose old output was an accepted false positive are changed with the list above as the reason. The scenario `expect` checks that no secret fragment of the draft survives (token, `hunter2`, the clone URL password) and that the Markdown around the quoted text stays.
