import crypto from "node:crypto";
import { Router } from "express";
import { Delivery, IncomingEvent, IncomingHook, WEBHOOK_EVENTS, Webhook, type WebhookEvent } from "../models/index.js";
import { deliver, emitToolEvents, newSecret } from "../services/webhooks.js";
import { handleMessage } from "../services/chat.js";
import { callTool } from "../mcp/manager.js";
import { asyncH, HttpError } from "../http.js";

/* ════════════════ Outgoing webhooks (dashboard API) ════════════════ */
export const webhooksRouter = Router();

function parseWebhook(b: Record<string, unknown>) {
  const name = String(b.name ?? "").trim();
  const url = String(b.url ?? "").trim();
  if (!name) throw new HttpError(400, "Name is required");
  try {
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error();
  } catch {
    throw new HttpError(400, "Valid http(s) URL is required");
  }
  const events = (Array.isArray(b.events) ? b.events.map(String) : []) as WebhookEvent[];
  if (!events.length) throw new HttpError(400, "Select at least one event");
  const bad = events.find((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (bad) throw new HttpError(400, `Unknown event: ${bad}`);
  const headers = b.headers && typeof b.headers === "object" ? (b.headers as Record<string, string>) : {};
  return { name, url, events, headers, active: b.active !== false };
}

webhooksRouter.get("/events", (_req, res) => {
  res.json(WEBHOOK_EVENTS);
});

webhooksRouter.get(
  "/",
  asyncH(async (_req, res) => {
    res.json(await Webhook.find().sort({ createdAt: -1 }).lean());
  })
);

webhooksRouter.post(
  "/",
  asyncH(async (req, res) => {
    const hook = await Webhook.create({ ...parseWebhook(req.body ?? {}), secret: newSecret() });
    res.status(201).json(hook);
  })
);

webhooksRouter.put(
  "/:id",
  asyncH(async (req, res) => {
    const hook = await Webhook.findByIdAndUpdate(req.params.id, parseWebhook(req.body ?? {}), { new: true });
    if (!hook) throw new HttpError(404, "Not found");
    res.json(hook);
  })
);

webhooksRouter.patch(
  "/:id/active",
  asyncH(async (req, res) => {
    await Webhook.updateOne({ _id: req.params.id }, { active: Boolean(req.body?.active) });
    res.json({ ok: true });
  })
);

webhooksRouter.post(
  "/:id/rotate-secret",
  asyncH(async (req, res) => {
    const hook = await Webhook.findByIdAndUpdate(req.params.id, { secret: newSecret() }, { new: true });
    if (!hook) throw new HttpError(404, "Not found");
    res.json({ secret: hook.secret });
  })
);

webhooksRouter.delete(
  "/:id",
  asyncH(async (req, res) => {
    await Webhook.deleteOne({ _id: req.params.id });
    await Delivery.deleteMany({ webhookId: req.params.id });
    res.json({ ok: true });
  })
);

/** "Send test" button */
webhooksRouter.post(
  "/:id/test",
  asyncH(async (req, res) => {
    const hook = await Webhook.findById(req.params.id);
    if (!hook) throw new HttpError(404, "Not found");
    res.json(await deliver(hook, "webhook.test", { message: "Test event from your chatbot dashboard", sentAt: new Date() }));
  })
);

webhooksRouter.get(
  "/deliveries",
  asyncH(async (req, res) => {
    const q: Record<string, unknown> = {};
    if (req.query.webhookId) q.webhookId = String(req.query.webhookId);
    if (req.query.status === "failed") q.success = false;
    if (req.query.status === "success") q.success = true;
    res.json(await Delivery.find(q).sort({ createdAt: -1 }).limit(100).lean());
  })
);

/** Failed delivery ko dobara bhejna */
webhooksRouter.post(
  "/deliveries/:id/redeliver",
  asyncH(async (req, res) => {
    const d = await Delivery.findById(req.params.id).lean();
    if (!d) throw new HttpError(404, "Delivery not found");
    const hook = await Webhook.findById(d.webhookId);
    if (!hook) throw new HttpError(404, "Webhook was deleted");
    const p = d.payload as { id?: string; data?: unknown };
    res.json(await deliver(hook, d.event as never, p?.data, 1, p?.id));
  })
);

/* ════════════════ Incoming webhooks (dashboard API) ════════════════ */
export const incomingRouter = Router();

function parseIncoming(b: Record<string, unknown>) {
  const name = String(b.name ?? "").trim();
  if (!name) throw new HttpError(400, "Name is required");
  const action = (["log", "chat", "tool"].includes(String(b.action)) ? String(b.action) : "log") as "log" | "chat" | "tool";
  const toolName = action === "tool" ? String(b.toolName ?? "").trim() : undefined;
  if (action === "tool" && !toolName) throw new HttpError(400, "Select a tool");
  return { name, action, toolName, active: b.active !== false };
}

incomingRouter.get(
  "/",
  asyncH(async (_req, res) => {
    res.json(await IncomingHook.find().sort({ createdAt: -1 }).lean());
  })
);

incomingRouter.post(
  "/",
  asyncH(async (req, res) => {
    const hook = await IncomingHook.create({ ...parseIncoming(req.body ?? {}), token: crypto.randomBytes(18).toString("base64url") });
    res.status(201).json(hook);
  })
);

incomingRouter.put(
  "/:id",
  asyncH(async (req, res) => {
    const hook = await IncomingHook.findByIdAndUpdate(req.params.id, parseIncoming(req.body ?? {}), { new: true });
    if (!hook) throw new HttpError(404, "Not found");
    res.json(hook);
  })
);

incomingRouter.patch(
  "/:id/active",
  asyncH(async (req, res) => {
    await IncomingHook.updateOne({ _id: req.params.id }, { active: Boolean(req.body?.active) });
    res.json({ ok: true });
  })
);

incomingRouter.post(
  "/:id/regenerate",
  asyncH(async (req, res) => {
    const hook = await IncomingHook.findByIdAndUpdate(req.params.id, { token: crypto.randomBytes(18).toString("base64url") }, { new: true });
    if (!hook) throw new HttpError(404, "Not found");
    res.json({ token: hook.token });
  })
);

incomingRouter.delete(
  "/:id",
  asyncH(async (req, res) => {
    await IncomingHook.deleteOne({ _id: req.params.id });
    await IncomingEvent.deleteMany({ hookId: req.params.id });
    res.json({ ok: true });
  })
);

incomingRouter.get(
  "/events",
  asyncH(async (req, res) => {
    const q: Record<string, unknown> = req.query.hookId ? { hookId: String(req.query.hookId) } : {};
    res.json(await IncomingEvent.find(q).sort({ createdAt: -1 }).limit(100).lean());
  })
);

/* ════════════════ Public receiver: POST /hooks/in/:token ════════════════
   Bahar ki service (Zapier, Make, n8n, form tool, CRM) yahan POST karegi.   */
export const receiverRouter = Router();

const SAFE_HEADERS = ["content-type", "user-agent", "x-forwarded-for", "x-request-id"];

receiverRouter.post(
  "/:token",
  asyncH(async (req, res) => {
    const hook = await IncomingHook.findOne({ token: req.params.token });
    if (!hook || !hook.active) throw new HttpError(404, "Unknown webhook");

    const payload = req.body ?? {};
    const headers = Object.fromEntries(SAFE_HEADERS.filter((h) => req.headers[h]).map((h) => [h, req.headers[h]]));
    let result: unknown = { received: true };
    let success = true;

    try {
      if (hook.action === "chat") {
        // body: { "message": "...", "sessionId": "optional" }
        const message = typeof payload.message === "string" ? payload.message.slice(0, 2000) : "";
        if (!message) throw new HttpError(400, 'Body must include "message" (string)');
        const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.slice(0, 80) : `hook-${hook._id}-${Date.now()}`;
        const r = await handleMessage(sessionId, message, "webhook");
        result = { sessionId, reply: r.reply };
      } else if (hook.action === "tool") {
        // body = tool ke arguments (ya { "args": {...} })
        const args = payload.args && typeof payload.args === "object" ? payload.args : payload;
        const r = await callTool(hook.toolName!, args);
        success = !r.isError;
        result = { tool: hook.toolName, output: r.text, isError: r.isError };
        emitToolEvents(hook.toolName!, args, r.text, r.isError, { channel: "webhook" });
      }
    } catch (err) {
      success = false;
      result = { error: err instanceof Error ? err.message : String(err) };
    }

    await IncomingEvent.create({ hookId: hook._id, hookName: hook.name, payload, headers, result: JSON.stringify(result).slice(0, 4000), success });
    await IncomingHook.updateOne({ _id: hook._id }, { lastReceivedAt: new Date(), $inc: { receivedCount: 1 } });

    res.status(success ? 200 : 422).json(result);
  })
);
