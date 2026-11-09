# PMK-197: text redact trades false positives for no missed secrets

Follow-up of PMK-63 (`text redact`, PR #108). Files: `scripts/lib/redact.mjs`, `scripts/redact-probes.test.mjs`, `scripts/redact.test.mjs`, `scripts/__scenarios__/issues-investigate-bug.mjs`, and the text that lists the types (`commands/issues/investigate-bug.md`, `README.md`, CHANGELOG). Non-goals: the improvements in `docs/superpowers/epc-6-follow-ups.md`.

## Intent

`text redact` is a second layer over text the agent quotes. A leaked secret costs more than an over-redacted word, so the key/value rule changes from "redact when the value looks like a secret" to "redact unless the value is provably not one".

## The rule

A pair is `key` + a separator + value, where the key contains `password`, `passwd`, `pwd`, `credential(s)`, `secret`, `token`, `api_key` (or `apikey`), or `private_key`, and the separator is `=`, `:`, `=>`, `:=`, `==` or `===`, with any space except a line break around it. The value is replaced in full unless it falls under one of the exemptions below.

The rule has no per-character cases. After two review cycles in which each patch to a whitespace-delimited value opened a new gap (`|` inside a value, an opening backtick eaten, a YAML block under a diff `+`), the value now runs to the end of the line:

- **Quoted value:** the quoted text, with escaped quotes and line breaks inside, up to 4096 characters. A quote that never closes, or a closing quote with a word right after it (`password="ab"cd`), falls back to the line rule.
- **Any other value:** from the separator to the end of the line. In a table row (the line starts with `|`) it ends at the next `|`, so the other cells stay.
- **Markdown stays balanced:** only the Markdown that opened before the value and is still open there (a backtick, `**`, `__`, `~~`, `(`, `[`, `{`) keeps its last closing mark on the line: `(token=x)`, `` `token=x` ``, `**token=x**`, `[token: x](url)`. Markdown that opens inside the value (`` password: `hunter2` ``) goes with it.
- **Next line:** with nothing after the separator, or a YAML `|` or `>` (with `+`, `-` or a digit), the value is the lines below that are more indented than the key, blank lines inside included. "More indented" is measured at the key's column, so a diff `+`, a log timestamp or a list `- ` before the key counts: a line belongs when it has a space at that column (and the same kind of character just before it), or more leading space, `+` and `-` than the key's line. With nothing after the separator and a `name:` pair (a colon then a space or the end of the line) as the first of those lines, they are a mapping and each pair is read on its own. A `|` or `>` with no line below is left alone.
- **Authorization:** `"Authorization": "Basic ..."` (JSON) is redacted like the header line, after any space, with an escaped quote inside.
- **curl:** the value of `-u` or `--user` on a `curl` line is redacted when it holds a `:`. Type `curl_user`.

## Exemptions (the only values left alone)

1. Already redacted: the mark, alone or followed by a space, `,`, `;` or the end of the text, so a second pass changes nothing and counts nothing. A mark followed by more of the value (`secret=[redacted]!Rest#9`) is replaced in full.
2. Empty.
3. A number or `n:n` after a key that does not end in the secret word: `max_tokens`, `token_limit`, `secret_version`, and a file name such as `token.mjs:12:5` or `password.ts:42:13`. After a key that ends in it (`token`, `GITHUB_TOKEN`, `CLIENT_SECRET`, `api_key`, `password`, `my.password`) a number is redacted.
4. A key that is exactly `pwd` or `oldpwd` (the shell variable and the `pwd` command, not `DB_PWD`) with a value that starts with `/` or `~`: it is a directory. The scan goes on inside it, so `PWD=/home?token=...` still finds the token.

## False positives this accepts (the full list)

- The rest of the line after a secret key: `password: hunter2 and more`, `- token=x, then retry`, `a=1&api_key=x&b=2` (`&b=2` goes), `a=1,token=x,b=2`, and a second pair on the same line (`password=x and "password": "y"` is one mark).
- Prose after a key word: `token: expired`, `Unexpected token: < in JSON`, `the next token: a comma`, `csrf_token=abc in the form`, `Set the password: field in config.yaml` (the rest of the sentence goes).
- Code that names a key word: `password: string`, `const password = req.body.password`, `password: process.env.DB_PASSWORD`, `const token = getToken(req)`, `if (password === undefined) throw ...` becomes `if (password === [redacted])`.
- A name that holds a key word: `secretName: x`, `tokenizer=cl100k`, `tokens=lots`.
- Markdown: with a closing mark that opened before the value, the text up to its last occurrence on the line goes (`` The `password:` key and `x` `` becomes `` The `password:[redacted]` ``).
- The lines under a key with nothing after it when they are more indented and the first is not a `name:` pair: `token:\n  see the docs`, `Error: invalid token:\n    at foo (src/a.js:1:2)` (the stack frame goes), `credentials:\n  - user: bob`.
- `curl_user` matching `-u` of another command on a `curl` line: `curl x | sort -u -t: -k1` loses `-t:`.

## Ceilings kept (missed secrets that remain)

Recorded as follow-ups: `docker login -p`, `mysql -p...`, `wget --http-password x` and `--password x` (no `=` or `:`), `curl -u` on a continued line or after 500 characters.

- `pwd=/x9Kq` and `PWD=~/secret`: kept (exemption 4), a missed secret for a key named exactly `pwd`.
- A number after a key that does not end in the secret word (`token_limit=482913`), kept by exemption 3.
- A value on the next line at the indentation of the key (`password:\nhunter2`, not valid YAML) and a quoted value over 4096 characters that spans lines (its first line goes).
- A value the key does not name (`-p hunter2` in `docker login`, `Cookie: session=...`) stays; probes pin it.

## Tests

Every case in the issue has a probe with the output. Probes that pinned the old gaps now pin the new output; probes whose old output was an accepted false positive are changed with the list above as the reason. The scenario `expect` checks that no secret fragment of the draft survives (token, `hunter2`, the clone URL password) and that the Markdown around the quoted text stays.
