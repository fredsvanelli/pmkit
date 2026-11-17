# Webhook replay

## Problem

Support cannot resend a delivery that ran out of attempts, so the receiver never gets the event.

## Users

Support agents.

## Scope (in)

List the parked deliveries of a webhook and replay one of them.

## Out of scope

Replaying every parked delivery at once.

## Use cases

A support agent finds a parked delivery and replays it after the receiver fixed its endpoint.

## Requirements

1. List parked deliveries. Criteria: the list shows each parked delivery of a webhook with its last error.
2. Replay a parked delivery. Criteria: a replayed delivery leaves the list and is sent again.

## Decisions

- Replays stay manual in v1: ADR.
- The list shows the newest delivery first: PRD only.

## Open questions

None.
