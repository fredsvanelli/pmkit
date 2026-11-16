# prioritize-by-demand command (PMK-68)

## Intent

A PM wants open work ordered by how much users or customers ask for it, and the priorities fixed to match, without reading every request by hand.

## Goals

- Rank the open issues (backlog, todo, triage) by demand signals: on a tracker with `demand_signals` native (Local), the accepted requests of `demand list`. An `important` request counts twice.
- When the capability is not native (Linear), or no candidate has a request, use comments (count) and mentions (other issues whose text names the issue ID) as the signal, and say so in the table header and the output: it is a weaker signal.
- Propose a priority per issue (equal bands over the tracker's `priorities` from `discover`, highest score first; with the weak signal the first priority is never proposed and no issue is lowered; issues with no score keep their priority), let the user edit, show the full preview of every change, ask once and write one issue at a time.

## Non-goals

- A new CLI command: `capabilities`, `demand list`, `issues list`, `issues get --comments` and `issues update --priority` give everything. No weighting by customer revenue or tier (ties break by distinct customers, then older first).
- Touching issues with no signal: they keep their priority.

## Constraints

- A write that fails midway stops, lists applied and remaining, never retries.
- A failed or cut `issues get` leaves that candidate "not verified": it is not ranked or written, and the output says so. A missing signal is never a zero score. A cut list (`hasMore`) or `problems` in `demand list` shows the ranking but writes nothing. Other `problems` of the whole-tracker list are warnings.
- The full preview and its question always come first, whatever `write_policy.confirm` says.
- At most 30 candidates in the comments-and-mentions mode (one `issues get` each, plus one whole-tracker `issues list` for the mentions, matched as whole tokens); the rest are listed as not ranked.

## Left to the builder

Wording, scenario fixture, registry changes (README, SKILL.md, CHANGELOG, counts).
