# PMK-283: characterization of adr-status on a setext-underlined Status

## Intent

PMK-273 reads `## Status\nAccepted\n---` as a setext heading, as CommonMark does. Only `adrInfo` has a test for that text. `setAdrStatus` and `docs adr-status` have none, so what they write there is not fixed. This issue adds a characterization test that pins today's output, whole file before and after the write, in the function and through the CLI, with `docs adr-get` before and after.

## Goals

- A test in `scripts/adr.test.mjs` pins the full text `setAdrStatus` writes for `# 1. Use X\n\n## Status\nAccepted\n---\n\n## Context\n\nSome text.\n`.
- A CLI test in the style of the neighbouring `docs adr-status` tests pins the full file after the write, and the `docs adr-get` output before and after.
- The test names and comments say the test pins the CommonMark reading, and that a human reader sees two status-like entries.

## Non-goals

- No change to `scripts/lib/adr.mjs`, to `locate`, or to the setext rule.
- No change to `adr-get` or `adr-status` output.

## Calls made without the user

- Characterization, not correction: the coordinator chose option 1 (reply `msg_c596c21c23d5`).
- The test covers the bare case (no blank line). The blank-line variant already reads as `Accepted ---` in `adr-get` and is not part of this issue.
- Follow-up, not an issue: an empty `## Status` section followed directly by a setext heading gives `adr-get` `null` and leaves the heading in place. Candidate: warn in `adr-get`, or handle it in `adr-status`. Listed in the final report only.

## Current behaviour (the characterization)

Input: `# 1. Use X\n\n## Status\nAccepted\n---\n\n## Context\n\nSome text.\n`

- `adrInfo`: title `1. Use X`, status `null`.
- `setAdrStatus(text, 'deprecated')`: before `null`, after `Deprecated`. Text becomes `# 1. Use X\n\n## Status\n\nDeprecated\n\nAccepted\n---\n\n## Context\n\nSome text.\n`.
- `adrInfo` on the result: status `Deprecated`.
- CLI `docs adr-status 1 deprecated` writes the same text, with `status: {before: null, after: 'Deprecated'}`.
