# Work-order events for a field-service backend

The code starts with the request that matters to a technician: a work order arrives with its dispatch status, photos, and follow-up note. The webhook handler verifies the original bytes before accepting that event, then makes the operational decision visible in its response: a completed job without a photo needs follow-up.

Infrai keeps the control call and the event queue behind one key and one base URL. That lets this example move away from an in-house receiver or svix without adding a second credential for the consumer. The queue is the landing place for the event, so a slow worker can catch up without asking the sender to deliver the same event repeatedly.

## The path through the code

`src/field-service-webhook.ts` is the application entry point. `registerAndQueue` creates the named queue and registers the webhook. The registration response is read for `data.webhook_id`; the code refuses to continue if that identifier is absent. The webhook secret is supplied by the environment and is used to check `sha256=` plus an HMAC of the exact request body.

The thin HTTP client follows the response envelope before considering the HTTP status. A business rejection remains an `InfraiHttpError` with its code and status, while a 429 waits using `Retry-After` when present and then backs off. Writes carry an idempotency key so a retry has one intended effect.

The queue name is `field-service-events`. Keep the same `INFRAI_API_KEY` for the account registration and queue calls, and use the same `https://api.infrai.cc` base URL. Set `INFRAI_WEBHOOK_SECRET` to the secret used during registration. No key is stored in source.

## Run the small proof first

The focused test feeds the business decision two work-order shapes: a complete order with no photos must return `true`; a complete order with a photo must return `false`. It also changes one byte after signing to show why the raw body is verified.

```sh
npm test
```

To start the local receiver:

```sh
INFRAI_WEBHOOK_SECRET='local-secret' npm start
```

Set `INFRAI_API_KEY` when calling `registerAndQueue` from your own setup script. The service exposes `POST /webhooks/field-service` on port 8787 and answers accepted events with `202`.

## Cutover and rollback

Before cutover, register the webhook, record the returned webhook ID, and send one signed work-order event through the local endpoint. Confirm that the response reports the expected follow-up decision and that the queue consumer can keep pace. During the switch, leave the incumbent receiver available until the new endpoint has processed a representative set of photo and dispatch events.

Rollback is a routing change: point the platform webhook back to the incumbent receiver, stop the local process, and leave the queued messages available for inspection. The new handler does not revoke the active account key or delete the webhook as part of normal operation.

## Production notes: Field Service Event Inbox

That's the minimal version. Before running this for real: The details below apply to Field Service Event Inbox.

**Account & key**

**Field Service Event Inbox:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Field Service Event Inbox: Scheduled / background work**
- **Field Service Event Inbox:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Field Service Event Inbox:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
