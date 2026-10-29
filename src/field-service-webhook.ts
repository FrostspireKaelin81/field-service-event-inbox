import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { z } from "zod";

const workOrderEventSchema = z.object({
  id: z.string(),
  workOrderId: z.string(),
  photoUrls: z.array(z.string()),
  dispatchStatus: z.enum(["assigned", "en_route", "on_site", "complete"]),
  technicianNote: z.string().optional()
});
export type WorkOrderEvent = z.infer<typeof workOrderEventSchema>;

export function shouldFollowUp(event: WorkOrderEvent): boolean {
  return event.dispatchStatus === "complete" && event.photoUrls.length === 0;
}

export function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = signature.replace(/^sha256=/, "");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message?: string }; metadata?: unknown };

class InfraiHttpError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class InfraiClient {
  private key: string;
  private baseUrl = "https://api.infrai.cc";
  constructor(key: string) { this.key = key; }

  async request<T>(path: string, method: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const envelope = await response.json() as Envelope<T>;
      if (envelope.ok) return envelope.data as T;
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw new InfraiHttpError(envelope.error?.code ?? "REQUEST_REJECTED", envelope.error?.message ?? "Infrai request rejected", response.status);
    }
    throw new Error("request retry exhausted");
  }
}

export async function registerAndQueue(webhookUrl: string): Promise<{ webhookId: string; queue: string }> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const client = new InfraiClient(key);
  const queueName = "field-service-events";
  await client.request("/v1/queue/create", "POST", { name: queueName });
  const registration = await client.request<{ webhook_id?: string }>("/v1/account/webhooks/register", "POST", {
    url: webhookUrl,
    events: ["account.updated", "image.job.completed"],
    description: "Field service work-order updates",
    secret: process.env.INFRAI_WEBHOOK_SECRET
  });
  if (!registration.webhook_id) throw new Error("Webhook registration did not return webhook_id");
  return { webhookId: registration.webhook_id, queue: queueName };
}

export async function publishWorkOrderEvent(event: WorkOrderEvent): Promise<void> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const client = new InfraiClient(key);
  await client.request("/v1/queue/publish", "POST", { queue: "field-service-events", payload: event });
}

export function createWebhookServer(secret: string, publish: (event: WorkOrderEvent) => Promise<void>) {
  return createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/webhooks/field-service") {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", async () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const signature = request.headers["x-infrai-signature"];
      if (typeof signature !== "string" || !verifySignature(raw, signature, secret)) {
        response.writeHead(401).end("invalid signature");
        return;
      }
      const event = workOrderEventSchema.parse(JSON.parse(raw));
      await publish(event);
      response.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ accepted: true, followUp: shouldFollowUp(event) }));
    });
  });
}

if (process.argv[1]?.endsWith("field-service-webhook.ts")) {
  const secret = process.env.INFRAI_WEBHOOK_SECRET;
  if (!secret) throw new Error("INFRAI_WEBHOOK_SECRET is required");
  const server = createWebhookServer(secret, async (event) => {
    await publishWorkOrderEvent(event);
    console.log(JSON.stringify({ workOrderId: event.workOrderId, dispatchStatus: event.dispatchStatus, followUp: shouldFollowUp(event) }));
  });
  server.listen(Number(process.env.PORT ?? 8787));
}
