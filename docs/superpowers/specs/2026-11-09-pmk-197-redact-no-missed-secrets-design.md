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

## More of the rule (review of PR #155)

- **Quoted value:** may hold an escaped quote (`\"`) or a line break, up to 4096 characters. A quote that never closes runs to the end of the line. Text between an unclosed quote and the next quote within 4096 characters is replaced too.
- **Unicode space:** any space except a line break may follow the separator (NBSP, em space).
- **Another pattern got there first:** a value that starts with `[redacted]` but goes on (`secret=[redacted]!Rest#9`) is replaced in full; only `[redacted]` plus wrapper characters is left alone, so a second pass changes nothing and counts nothing.
- **YAML:** after `key: |` or `key: >` (with `+`, `-` or a digit) the more indented lines, blank lines inside included, are replaced by one mark. A key with nothing after it takes the next line when that line is more indented than the key and is not a `name:` pair (`password:\n  hunter2` is replaced, `credentials:\n  user: bob` is not, its pairs are read on their own).
- **Wrappers:** `) ] } > * ` ' " , . ; : | _ ~` at the end of an unquoted value stay in the text, and `|` ends a value, so `|token=x|`, `__token=x__` and `~~token=x~~` keep their closing mark.
- **File names:** a number or `n:n` is also left alone after a key that ends in a source or config extension (`password.ts:42:13`, `credentials.mjs:42`). `my.password=123456` is still redacted.
- **Linear time:** a run of unquoted value is read once, however many keys it holds, and the wrappers are cut from the back.

## False positives this accepts (the full list)

- Prose after a key word: `token: expired`, `the secret: see below`, `csrf_token=abc`, `tokenizer: bpe`, `Set the password: field in config.yaml` (the word `field` goes).
- Code that names a key word: `password: string`, `const password = req.body.password`, `password: process.env.DB_PASSWORD`, `secret: null`, `token = getToken()`. Only the first word after the separator is replaced.
- Operators and calls: `password === undefined` becomes `password =[redacted] undefined`, `const token = getToken(req)` becomes `const token = [redacted])`, `Unexpected token: <` loses the `<`.
- A name that holds a key word: `secretName: x`, `tokenizer=cl100k`, `max_tokens=4096` stays (number) but `tokens=lots` goes.
- A comma-separated list `a=1,token=x,b=2`: the value runs to whitespace, so `,b=2` is replaced too.
- A line of prose, a quote and YAML: the line under `token:` or `password:` when it is more indented and is not a `name:` pair (`token:\n  see the docs`), and the text after a quote that never closes.
- `pwd=/x9Kq` and `PWD=~/secret`: kept (exemption 4), a missed secret for a key named exactly `pwd`.
- A number after a name that is not a password is kept, so `token=123456` is not redacted either (a missed secret, accepted: limits and line numbers are far more common).

## Ceilings kept (missed secrets that remain)

Not done here, recorded as follow-ups: `docker login -p`, `mysql -p...` and `--password x` (no `=` or `:`), `curl -u` on a continued line or after 500 characters, and `curl_user` matching `-u` of another command on the same line (`sort -u -t: -k1`, `docker run -u 1000:1000`, which are false positives too).

- A password that ends in a wrapper character (`pass.`, `pass)`) leaves that last character visible.
- `password=hunter&user=bob`: `&user=` is read as a new pair, so `&user=bob` stays and `hunter` goes.
- A value the key does not name (`-p hunter2` in `docker login`, `Cookie: session=...`) stays; probes pin it.

## Tests

Every case in the issue has a probe with the output. Probes that pinned the old gaps now pin the new output; probes whose old output was an accepted false positive are changed with the list above as the reason. The scenario `expect` checks that no secret fragment of the draft survives (token, `hunter2`, the clone URL password) and that the Markdown around the quoted text stays.
