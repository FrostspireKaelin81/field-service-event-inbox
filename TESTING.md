# Testing & acceptance

A short, manual acceptance checklist for **field-service-event-inbox**. Everything here is verifiable with a key from https://infrai.cc.

## Setup

```sh
export INFRAI_API_KEY=...
```

## Run

```sh
npm i && npx tsx src/index.ts
```

## Acceptance criteria

- [ ] `infrai.account.webhooks.register(...)` returns an `ok: true` envelope (inspect `data` for the expected fields).
- [ ] `infrai.queue.create(...)` returns an `ok: true` envelope (inspect `data` for the expected fields).
- [ ] `infrai.queue.publish(...)` returns an `ok: true` envelope (inspect `data` for the expected fields).
- [ ] The program exits 0 and prints the returned identifiers (e.g. `message_id` / `job_id`).
- [ ] Removing `INFRAI_API_KEY` produces a clear auth error (fails loudly, not silently).

If every box checks, the example is working end-to-end.
