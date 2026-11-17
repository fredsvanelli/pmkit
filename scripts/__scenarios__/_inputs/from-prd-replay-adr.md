# 0001. Replays stay manual in v1

## Status

Accepted

## Context

The refined PRD specs/webhook-replay-prd.md lets support replay a delivery that ran out of attempts. An automatic replay could flood a receiver that is still down.

## Decision

Replays stay manual in v1. A support agent replays one delivery at a time.

## Consequences

Support replays each delivery by hand. Rejected: an automatic replay when the receiver recovers.
