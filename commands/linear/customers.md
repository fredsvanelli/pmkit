---
description: List and edit Linear customers (tier, revenue, size, status) and link customer requests to issues and projects
argument-hint: "[list|show|set|link]"
disable-model-invocation: true
---

# Linear customers

Arguments: `$ARGUMENTS`

## Parameters

- `list`, `show`, `set` or `link` (optional): where to start. Without it, the command lists the customers and asks what to do next.
- A customer id or name (optional): the customer to show, edit or link.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. When `tracker` is not `linear`, say that this command works only with the Linear tracker and stop.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" linear customers list --json`. When `available` is false, print `reason`, `plan` and `enableHint`, say that the Free and Basic plans have no customers and that `pmkit discover` refreshes the workspace flags after an upgrade, and stop.
3. Show the customers with status, tier, revenue, size and request count. Revenue and size are the integers Linear stores. Linear's schema gives revenue no currency, so show it without one. For a customer the user names, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" linear customers show --customer <id or name> --json` and show its requests with what each is linked to. Show each warning, such as customers left out by `--limit`.
4. Ask with `AskUserQuestion` what to do next. The choices are edit a customer, link a request, or stop. When the user stops, change nothing.
5. For an edit, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" linear customers set --customer <id or name> --tier <name> --dry-run --json`, with the flags the user asked for (`--status`, `--tier`, `--revenue`, `--size`, `--owner`, `--name`) in place of `--tier`. Show `before` and `after` and ask once with `AskUserQuestion` whether to apply it. For a link, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" linear customers link --customer <id or name> --issue <KEY> --dry-run --json`, with `--project <name>` in place of `--issue`, or `--request <id>` added to move an existing request. Show the customer, the target and whether the call creates or moves a request, and ask once with `AskUserQuestion` whether to apply it. Ask whatever `write_policy.confirm` says, because both changes alter data that the sales and product teams read. When the user declines, change nothing.
6. After approval, run the same call without `--dry-run`, for example `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" linear customers set --customer <id or name> --tier <name> --json` or `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" linear customers link --customer <id or name> --issue <KEY> --json`. Then run `linear customers show --customer <id or name> --json` again and compare it with the preview. When they differ, say how.

## Confirmation points

- Step 4: the next action. Stopping changes nothing.
- Step 5: the preview of the edit or the link, always asked because both change customer data. Declining changes nothing.

## Output

The customers with status, tier, revenue, size and request count, what changed with the state before and after, and for a link the request and its target.

## If something is missing

- No `LINEAR_API_KEY`: the CLI fails with `AUTH`. Apply the rules for reading errors in the conventions.
- A Local tracker: stop at step 1.
- A Free or Basic workspace, or a workspace with customers off: stop at step 2 and give the `enableHint`.
- A customer name that two customers share: the CLI fails with `INVALID_INPUT` and lists the ids. Ask which one.
- A request that already exists on the target: the CLI fails with `CONFLICT` and names it. Offer `--request <id>` to move it, or an edit in Linear.
- An error from the CLI: apply the rules for reading errors in the conventions.
