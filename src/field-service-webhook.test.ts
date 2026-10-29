import test from "node:test";
import assert from "node:assert/strict";
import { shouldFollowUp, verifySignature } from "./field-service-webhook.ts";
import { createHmac } from "node:crypto";

test("a completed work order without photos needs technician follow-up", () => {
  assert.equal(shouldFollowUp({ id: "evt-1", workOrderId: "wo-9", photoUrls: [], dispatchStatus: "complete" }), true);
  assert.equal(shouldFollowUp({ id: "evt-2", workOrderId: "wo-9", photoUrls: ["photo-1"], dispatchStatus: "complete" }), false);
});

test("signature covers the exact request body", () => {
  const body = JSON.stringify({ workOrderId: "wo-9" });
  const signature = createHmac("sha256", "test-secret").update(body).digest("hex");
  assert.equal(verifySignature(body, `sha256=${signature}`, "test-secret"), true);
  assert.equal(verifySignature(`${body} `, `sha256=${signature}`, "test-secret"), false);
});
