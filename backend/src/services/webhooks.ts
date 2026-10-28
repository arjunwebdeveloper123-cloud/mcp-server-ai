import crypto from "node:crypto";
import { Delivery, Webhook, type WebhookEvent } from "../models/index.js";

/*  Outgoing webhooks
    - Har event par, jo active webhooks us event ko subscribe karte hain, unko POST jata hai
    - Body JSON:  { id, event, createdAt, data }
    - Headers:    X-Webhook-Event, X-Webhook-Id, X-Webhook-Timestamp,
                  X-Webhook-Signature: sha256=<HMAC_SHA256(secret, `${timestamp}.${rawBody}`)>
    - Fail hone par 3 attempts tak retry (2s, 10s backoff), har attempt Delivery log me save   */

const RETRY_DELAYS = [2_000, 10_000];
const TIMEOUT_MS = 10_000;

export function newSecret() {
  return "whsec_" + crypto.randomBytes(24).toString("hex");
}

export function sign(secret: string, timestamp: string, body: string) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

type WebhookLike = {
  _id: import("mongoose").Types.ObjectId;
  name: string;
  url: string;
  secret: string;
  headers?: Map<string, string> | Record<string, string> | null;
};

/** Ek webhook ko ek baar deliver karo; result log karo */
export async function deliver(hook: WebhookLike, event: WebhookEvent, data: unknown, attempt = 1, id?: string) {
  const payload = { id: id ?? "evt_" + crypto.randomUUID(), event, createdAt: new Date().toISOString(), data };
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const extra = hook.headers instanceof Map ? Object.fromEntries(hook.headers) : { ...(hook.headers ?? {}) };

  const started = Date.now();
  let statusCode: number | undefined;
  let responseBody = "";
  let error: string | undefined;

  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        ...extra,
        "Content-Type": "application/json",
        "User-Agent": "MCP-Chatbot-Webhooks/1.0",
        "X-Webhook-Event": event,
        "X-Webhook-Id": payload.id,
        "X-Webhook-Timestamp": timestamp,
        "X-Webhook-Signature": sign(hook.secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual",
    });
    statusCode = res.status;
    responseBody = (await res.text().catch(() => "")).slice(0, 2000);
  } catch (err) {
    error = err instanceof Error ? (err.name === "TimeoutError" ? `Timed out after ${TIMEOUT_MS / 1000}s` : err.message) : String(err);
  }

  const success = statusCode !== undefined && statusCode >= 200 && statusCode < 300;
  const durationMs = Date.now() - started;

  await Delivery.create({
    webhookId: hook._id,
    webhookName: hook.name,
    event,
    url: hook.url,
    payload,
    attempt,
    success,
    statusCode,
    responseBody,
    error,
    durationMs,
  });
  await Webhook.updateOne({ _id: hook._id }, { lastStatus: statusCode ?? 0, lastDeliveredAt: new Date() });

  // Retry (sirf network error ya 5xx / 429 par)
  const retryable = !success && (statusCode === undefined || statusCode >= 500 || statusCode === 429);
  if (retryable && attempt <= RETRY_DELAYS.length) {
    setTimeout(() => {
      Webhook.findById(hook._id)
        .then((fresh) => (fresh?.active ? deliver(fresh, event, data, attempt + 1, payload.id) : undefined))
        .catch((e) => console.error("[webhooks] retry failed:", e));
    }, RETRY_DELAYS[attempt - 1]);
  }

  return { success, statusCode, error, durationMs, responseBody };
}

/** Tool chalne ke baad ke events — chat aur incoming webhook dono yahi use karte hain */
export function emitToolEvents(name: string, input: unknown, output: string, isError: boolean, extra: Record<string, unknown>) {
  emit(isError ? "tool.failed" : "tool.called", { ...extra, name, input, output });
  if (isError) return;
  // Business events — Zapier / CRM / Google Sheet / Calendar ke liye sabse useful
  if (name.endsWith("__save_lead") && /saved/i.test(output)) emit("lead.created", { ...extra, lead: input, result: output });
  if (name.endsWith("__book_meeting") && /booked/i.test(output)) {
    const bookingId = output.match(/APT-[A-Z0-9]+/)?.[0];
    emit("appointment.booked", { ...extra, bookingId, appointment: input, result: output });
  }
  if (name.endsWith("__cancel_meeting") && /cancelled/i.test(output) && !/already/i.test(output))
    emit("appointment.cancelled", { ...extra, ...(input as object), result: output });
}

/** App ke andar kahin bhi: emit("lead.created", {...}) — background me chalta hai, chat ko slow nahi karta */
export function emit(event: WebhookEvent, data: unknown) {
  Webhook.find({ active: true, events: event })
    .then((hooks) => Promise.allSettled(hooks.map((h) => deliver(h, event, data))))
    .catch((err) => console.error("[webhooks] emit failed:", err));
}
