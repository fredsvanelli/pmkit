# PMK-275: reject an empty or differently spelled `--from` in `docs adr-get`

Small change (estimate 1). Follow-up of PMK-270 (`docs adr-get <n> --from <path>`).

## Intent

`--from` tells `docs adr-get` which new ADR supersedes this one, and the Supersedes ref is computed from that path. Two inputs go wrong today:

1. `--from` with no value. The parser stores `true`, and `checkUsage` answers the generic `--from needs a value` with next step `pmkit.mjs --help (docs adr-get)`. The issue asks for a message that says the flag needs a path, with a useful next step.
2. A path that names an ADR file in a different spelling, such as `./docs/adr/x.md`, `docs//adr/x.md` or `docs\adr\x.md`, is refused as `not the path of an ADR in a folder pmkit reads`, though it names the same file.

## Goals

- `--from` without a value, and `--from ""`, answer `INVALID_INPUT`, `--from needs a path`, with a next step that shows a real path.
- The path is normalised before matching the ADR folders: `\` becomes `/`, `.` segments and repeated `/` collapse, and an optional `tracker:` prefix is kept.
- The `supersedesRef` for any spelling equals the one for the plain path.

## Non-goals

- Other flags of `docs adr-get`.
- Changing how `supersedesRef` is built once the folder matches.

## Approaches (my call, no question asked)

- **A. Per-flag hint in the command definition, normalise in `runAdrGet`.** The command definition gets an optional `valueHints` map (`from: { message, nextStep }`), and `checkUsage` uses it for the valueless case. `runAdrGet` normalises the path and rejects an empty value. Small, and the hint is data, so other commands can use it later.
- B. Change the generic `needs a value` for every command. Rejected: it changes messages that other commands and tests depend on.
- C. Let `runAdrGet` handle `true` itself. Rejected: `checkUsage` runs first and throws before the handler.

Chosen: A.

## Decisions I made

- The valueless case is caught in `checkUsage`, not in the handler, so the hint lives on the command.
- The message is `--from needs a path`, matching `docLinks` (`--add-doc needs a path`) and the issue text.
- Normalisation only changes how the path is matched. The error text quotes what the user typed.
- `--from=` (empty string) gets the same message as the bare flag.

## Tests

Next to the existing `docs adr-get --from` tests in `scripts/adr.test.mjs`: the bare flag, the empty value, and each spelling giving the same `supersedesRef` as `docs/adr/0003-x.md` and `tracker:docs/adr/0003-x.md`.
