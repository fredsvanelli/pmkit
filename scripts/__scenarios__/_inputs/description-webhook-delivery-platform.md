### Purpose

A webhook delivery that fails today is lost. The platform signs each delivery, retries it with backoff, and parks it in a dead-letter queue when it runs out of attempts, so the teams that receive webhooks can replay it.

### Scope (in)

- Retry failed deliveries with backoff
- Park exhausted deliveries in a dead-letter queue
- Replay a parked delivery

### Documents

- Spec: .issues/docs/specs/overview.md
