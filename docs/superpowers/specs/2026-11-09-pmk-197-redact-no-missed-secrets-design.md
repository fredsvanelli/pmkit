# PMK-197: text redact trades false positives for no missed secrets

Follow-up of PMK-63 (`text redact`, PR #108). Files: `scripts/lib/redact.mjs`, `scripts/redact-probes.test.mjs`, `scripts/redact.test.mjs`, `scripts/__scenarios__/issues-investigate-bug.mjs`, and the text that lists the types (`commands/issues/investigate-bug.md`, `README.md`, CHANGELOG). Non-goals: the improvements in `docs/superpowers/epc-6-follow-ups.md`.

## Intent

`text redact` is a second layer over text the agent quotes. A leaked secret costs more than an over-redacted word, so the key/value rule changes from "redact when the value looks like a secret" to "redact unless the value is provably not one".

## The rule

A pair is `key` + a separator + value, where the key contains `password`, `passwd`, `pwd`, `credential(s)`, `secret`, `token`, `api_key` (or `apikey`), or `private_key`, and the separator is `=`, `:`, `=>`, `:=`, `==` or `===`, with any space except a line break around it. The key starts with a letter, a digit, `_` or `.`, so the `-` of a removed diff line is not part of it, and it may close a quote, an escaped quote or a bracket before the separator (`{\"password\":`, `config["password"] =`). The value is replaced in full unless it falls under one of the exemptions below.

The rule has no per-character cases. After two review cycles in which each patch to a whitespace-delimited value opened a new gap (`|` inside a value, an opening backtick eaten, a YAML block under a diff `+`), the value now runs to the end of the line:

- **Quoted value:** the quoted text, with escaped quotes (and YAML's `''`) and line breaks inside, up to 4096 characters. A quote that never closes, or a closing quote followed by anything but a space, `,`, `;`, `)`, `]`, `}` or the end (`password="ab"cd`, `"abc"-def`, `'pa'"'"'ss'`), falls back to the line rule.
- **Any other value:** from the separator to the end of the line. In a table row (the line starts with `|`) it ends at the next `|`, so the other cells stay.
- **Markdown stays balanced:** only the Markdown that opened before the value and is still open there (a backtick, `**`, `__`, `~~`, `(`, `[`, `{`) keeps its last closing mark on the line: `(token=x)`, `` `token=x` ``, `**token=x**`, `[token: x](url)`. Markdown that opens inside the value (`` password: `hunter2` ``) goes with it.
- **Next line:** with nothing after the separator, or a YAML `|` or `>` (with `+`, `-` or a digit, after an anchor or a tag, before a comment) or only a comment (`password: # below`), the value is the lines below that are more indented than the key, blank lines inside included. "More indented" is measured at the key's column, so a diff `+`, a log timestamp or a list `- ` before the key counts: a line belongs when it has a space at that column (and the same kind of character just before it), or more leading space, `+` and `-` than the key's line. With nothing after the separator and a `name:` pair (a colon then a space or the end of the line) as the first of those lines, they are a mapping: every value in it is replaced and the names stay (`secrets:\n  db: hunter2` becomes `secrets:\n  db: [redacted]`); a line in it with no `name:` goes whole. A `|` or `>` with no line below is left alone; a comment with no line below is the value (`PASSWORD=#hunter2`).
- **Authorization:** `"Authorization": "Basic ..."` (JSON) is redacted like the header line, after any space, with an escaped quote inside or no closing quote.
- **curl:** the value of `-u` (alone or after other short options, `-su`) or `--user` on a `curl` line is redacted when it holds a `:`. Type `curl_user`.
- **Order:** the private key, URL, Authorization and curl patterns run before the pairs, the token patterns (`jwt` to `bearer`) after them. A value after a secret key that starts with a token (`credentials: AKIA... wJalr...`, `token: ghp_... extra`) is one value, replaced to the end of the line and counted as `api_key_value`, so a mark at the start of a value can only come from an earlier pass.

## Exemptions (the only values left alone)

1. Already redacted: the mark, alone or followed by a space, `,`, `;` or the end of the text. Only an earlier pass can leave it there (see Order), so a second pass changes nothing and counts nothing. A mark followed by more of the value (`secret=[redacted]!Rest#9`) is replaced in full.
2. Empty.
3. A number or `n:n` (followed by a space, `,`, `;`, `:`, a closing bracket or the end) after a key that names a quantity or a file and does not end in the secret word: a key ending in `s`, `limit`, `count`, `version`, `size`, `length`, `max` or `min` (`max_tokens`, `token_limit`, `secret_version`), or in a file extension (`token.mjs:12:5`, `password.ts:42:13`, `tests/test_password.py:42: AssertionError`, `src/secret.c:10:3: error`). Any other key gets its number redacted: `token`, `GITHUB_TOKEN`, `CLIENT_SECRET`, `api_key`, `SECRET_KEY`, `password1`, `password_confirmation`, `my.password`.
4. A key that is exactly `pwd` or `oldpwd` (the shell variable and the `pwd` command, not `DB_PWD`) with a value that starts with `/` or `~`: it is a directory. The scan goes on inside it, so `PWD=/home?token=...` still finds the token.

## False positives this accepts (the full list)

- The rest of the line after a secret key: `password: hunter2 and more`, `- token=x, then retry`, `a=1&api_key=x&b=2` (`&b=2` goes), `a=1,token=x,b=2`, and a second pair on the same line (`password=x and "password": "y"` is one mark).
- Prose after a key word: `token: expired`, `Unexpected token: < in JSON`, `the next token: a comma`, `csrf_token=abc in the form`, `Set the password: field in config.yaml` (the rest of the sentence goes).
- Code that names a key word: `password: string`, `const password = req.body.password`, `password: process.env.DB_PASSWORD`, `const token = getToken(req)`, `if (password === undefined) throw ...` becomes `if (password === [redacted])`.
- A name that holds a key word: `secretName: x`, `tokenizer=cl100k`, `tokens=lots`.
- Markdown: with a closing mark that opened before the value, the text up to its last occurrence on the line goes (`` The `password:` key and `x` `` becomes `` The `password:[redacted]` ``). A lone `__` before the key counts as an opening mark, so `__dirname token=abc__xyz` keeps `__xyz`.
- The lines under a key with nothing after it when they are more indented: `token:\n  see the docs`, `Error: invalid token:\n    at foo (src/a.js:1:2)` (the stack frame goes), `credentials:\n  - user: bob`, and every value of a mapping under a secret key (`secrets:\n  port: 5432`, `credentials:\n  username: admin`).
- `curl_user` matching `-u` of another command on a `curl` line: `curl x | sort -u -t: -k1` loses `-t:`.

## Ceilings kept (missed secrets that remain)

Recorded as follow-ups: `docker login -p`, `mysql -p...`, `wget --http-password x` and `--password x` (no `=` or `:`), `curl -u` on a continued line or after 500 characters.

- `pwd=/x9Kq` and `PWD=~/secret`: kept (exemption 4), a missed secret for a key named exactly `pwd`.
- A number after a key that names a quantity or a file (`token_limit=482913`, `secrets=1234`), kept by exemption 3.
- A value on the next line at the indentation of the key (`password:\nhunter2`, not valid YAML) and a quoted value over 4096 characters that spans lines (its first line goes).
- A value the key does not name (`-p hunter2` in `docker login`, `Cookie: session=...`) stays; probes pin it.
- Not in the rule (review of PR #155, cycle 3, non-blockers): an escaped `Authorization` inside a JSON string (`headers: "{\"Authorization\": \"Basic ...\"}"`), a key with a space (`API Key: x`, `Secret access key: x`), Makefile `?=` and `+=`, `password != "x"`, the Kubernetes `- name: DB_PASSWORD\n  value: x` pair, `| password: | x |` across two cells, and `\|` inside a table cell (`| token=ab\|cd |` keeps `|cd`).

## Tests

Every case in the issue has a probe with the output. Probes that pinned the old gaps now pin the new output; probes whose old output was an accepted false positive are changed with the list above as the reason. The scenario `expect` checks that no secret fragment of the draft survives (token, `hunter2`, the clone URL password) and that the Markdown around the quoted text stays.
