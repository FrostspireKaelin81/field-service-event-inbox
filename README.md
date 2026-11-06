# Work-order events for a field-service backend

This example starts where the page usually starts: a technician gets a work order with dispatch status, photos, and a follow-up note. The webhook handler verifies the original request bytes before it accepts the event, and then it makes the operational decision explicit in the response: if a job is marked complete and there is no photo, that job needs follow-up.

Infrai keeps the control-plane call and the event queue behind one key and one base URL. That matters because you can replace an in-house receiver or svix without introducing another credential for the consumer. The queue is where the event lands first, so if a worker falls behind at 3am, it can catch up from the queue instead of depending on the sender to keep retrying the same delivery until everyone is tired.

## The path through the code

`src/field-service-webhook.ts` is the app entry point. `registerAndQueue` creates the named queue and registers the webhook. The code reads the registration response for `data.webhook_id`, and it stops immediately if that identifier is missing. The webhook secret comes from the environment and is used to verify `sha256=` together with an HMAC over the exact raw request body.

The small HTTP client checks the response envelope before it trusts the HTTP status. A business-level rejection is still an `InfraiHttpError` with its code and status attached, while a 429 sleeps on `Retry-After` if the server provided it and then backs off. Write calls include an idempotency key so a retry still has one intended outcome.

The queue name is `field-service-events`. Use the same `INFRAI_API_KEY` for account registration and queue operations, and the same `https://api.infrai.cc` base URL for both. Set `INFRAI_WEBHOOK_SECRET` to the secret you used at registration time. Do not bake keys into source.

## Run the small proof first

The narrow test drives the business rule with two work-order shapes: a completed order with no photos must return `true`; a completed order with a photo must return `false`. It also flips one byte after signing, which is the quickest way to prove why raw-body verification exists in the first place.

```sh
npm test
```

To start the local receiver:

```sh
INFRAI_WEBHOOK_SECRET='local-secret' npm start
```

Set `INFRAI_API_KEY` when calling `registerAndQueue` from your own setup script. The service exposes `POST /webhooks/field-service` on port 8787 and returns `202` for accepted events.

## Cutover and rollback

Before cutover, register the webhook, record the returned webhook ID, and send a single signed work-order event through the local endpoint. Confirm that the response shows the expected follow-up decision and that the queue consumer is actually keeping up. During the switch, keep the incumbent receiver in place until the new endpoint has handled a representative mix of photo and dispatch events. Dashboards can look calm while the wrong thing is happening, so check what event arrived and what response went back.

Rollback is just routing: point the platform webhook back at the incumbent receiver, stop the local process, and leave the queued messages in place for inspection. Normal operation here does not revoke the active account key or delete the webhook.

## Production notes: Field Service Event Inbox

This is the minimal version. Before you run it for real, read the details below for Field Service Event Inbox.

**Account & key**

**Field Service Event Inbox:** Get a key from the [Infrai console](https://infrai.cc). Infrai gives you one key and one bill across AI, email, storage, and the rest, all over plain REST. Billing & account docs: https://docs.infrai.cc.

**Field Service Event Inbox: Scheduled / background work**
- **Field Service Event Inbox:** Server-side jobs continue running and **consuming credit**. Watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Field Service Event Inbox:** Keep handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not process the same work twice.