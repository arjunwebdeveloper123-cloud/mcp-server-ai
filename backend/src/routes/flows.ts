import { Router } from "express";
import mongoose from "mongoose";
import { Flow, Settings, getSettings } from "../models/index.js";
import { validateFlow, type FlowEdge, type FlowNode } from "../services/flow.js";
import { blankFlow, templateFlow } from "../services/flowTemplate.js";
import { listAllToolNames } from "../mcp/manager.js";
import { testNodeAiKey } from "../services/providers/nodeAi.js";
import { handleMessage } from "../services/chat.js";
import { sendWhatsAppMessage } from "../services/whatsapp.js";
import { asyncH, HttpError } from "../http.js";

export const flowsRouter = Router();

const NODE_TYPES = new Set(["start", "message", "question", "buttons", "condition", "ai", "tool", "webhook", "handoff", "end", "api", "json"]);

/** Browser se aaya data saaf karo — sirf zaroori fields */
function sanitize(body: Record<string, unknown>) {
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const edges = Array.isArray(body.edges) ? body.edges : [];
  if (nodes.length > 300) throw new HttpError(400, "A flow can have at most 300 boxes");
  const cleanNodes: FlowNode[] = nodes.map((n: Record<string, unknown>) => {
    if (!NODE_TYPES.has(String(n.type))) throw new HttpError(400, `Unknown box type: ${String(n.type)}`);
    const pos = (n.position as { x?: number; y?: number }) ?? {};
    return {
      id: String(n.id),
      type: n.type as FlowNode["type"],
      position: { x: Number(pos.x) || 0, y: Number(pos.y) || 0 },
      data: typeof n.data === "object" && n.data ? (n.data as Record<string, unknown>) : {},
    };
  });
  const ids = new Set(cleanNodes.map((n) => n.id));
  const cleanEdges: FlowEdge[] = edges
    .map((e: Record<string, unknown>) => ({
      id: String(e.id),
      source: String(e.source),
      target: String(e.target),
      sourceHandle: e.sourceHandle ? String(e.sourceHandle) : null,
    }))
    .filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes: cleanNodes, edges: cleanEdges };
}

flowsRouter.get(
  "/",
  asyncH(async (_req, res) => {
    const s = await getSettings();
    const flows = await Flow.find().sort({ updatedAt: -1 }).lean();
    res.json(
      flows.map((f) => ({
        _id: f._id,
        name: f.name,
        boxes: (f.nodes as unknown[]).length,
        updatedAt: f.updatedAt,
        active: String(s.activeFlowId ?? "") === String(f._id),
      }))
    );
  })
);

flowsRouter.post(
  "/",
  asyncH(async (req, res) => {
    const name = String(req.body?.name ?? "").trim() || "Untitled flow";
    const start = req.body?.template ? templateFlow() : blankFlow();
    const f = await Flow.create({ name: name.slice(0, 80), ...start });
    res.status(201).json({ _id: f._id });
  })
);

/** Real-time verification of an AI API key and model */
flowsRouter.post(
  "/test-ai-key",
  asyncH(async (req, res) => {
    const provider = String(req.body?.provider || "gemini");
    const apiKey = String(req.body?.apiKey || "");
    const model = req.body?.model ? String(req.body.model) : undefined;
    const baseUrl = req.body?.baseUrl ? String(req.body.baseUrl) : undefined;
    const result = await testNodeAiKey({ provider, apiKey, model, baseUrl });
    res.json(result);
  })
);

/** Real-time testing of an API request node from Inspector */
flowsRouter.post(
  "/test-api-node",
  asyncH(async (req, res) => {
    const method = String(req.body?.method || "GET").toUpperCase();
    const rawUrl = String(req.body?.url || "").trim();
    const rawHeaders = req.body?.headers;
    const rawBody = req.body?.body;

    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      return res.json({
        ok: false,
        status: 0,
        statusText: "Invalid URL",
        latencyMs: 0,
        error: "URL must begin with http:// or https://",
      });
    }

    let headers: Record<string, string> = {};
    if (typeof rawHeaders === "string" && rawHeaders.trim()) {
      try {
        headers = JSON.parse(rawHeaders);
      } catch {
        return res.json({
          ok: false,
          status: 0,
          statusText: "Invalid Headers",
          latencyMs: 0,
          error: "Headers must be valid JSON",
        });
      }
    } else if (rawHeaders && typeof rawHeaders === "object") {
      headers = rawHeaders as Record<string, string>;
    }

    let bodyPayload: string | undefined = undefined;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && rawBody !== undefined && rawBody !== null && rawBody !== "") {
      bodyPayload = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody);
    }

    const startedAt = Date.now();
    try {
      const response = await fetch(rawUrl, {
        method,
        headers: {
          "User-Agent": "MCP-Chatbot-Flow/1.0",
          ...headers,
        },
        body: bodyPayload,
        signal: AbortSignal.timeout(15000),
      });

      const latencyMs = Date.now() - startedAt;
      const resHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        resHeaders[key] = val;
      });

      const rawText = await response.text();
      let parsedData: unknown = null;
      try {
        parsedData = JSON.parse(rawText);
      } catch {
        parsedData = null;
      }

      res.json({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        latencyMs,
        headers: resHeaders,
        data: parsedData,
        raw: rawText.length > 5000 ? rawText.slice(0, 5000) + "\n... (truncated)" : rawText,
        error: response.ok ? undefined : `HTTP ${response.status} ${response.statusText}`,
      });
    } catch (err: unknown) {
      const latencyMs = Date.now() - startedAt;
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.json({
        ok: false,
        status: 0,
        statusText: "Network/Timeout Error",
        latencyMs,
        error: errorMsg,
      });
    }
  })
);

flowsRouter.get(
  "/:id",
  asyncH(async (req, res) => {
    const f = await Flow.findById(req.params.id).lean();
    if (!f) throw new HttpError(404, "Flow not found");
    const s = await getSettings();
    res.json({ ...f, active: String(s.activeFlowId ?? "") === String(f._id), tools: listAllToolNames() });
  })
);

flowsRouter.put(
  "/:id",
  asyncH(async (req, res) => {
    const { nodes, edges } = sanitize(req.body ?? {});
    const name = String(req.body?.name ?? "").trim().slice(0, 80) || "Untitled flow";
    const f = await Flow.findByIdAndUpdate(req.params.id, { name, nodes, edges }, { new: true });
    if (!f) throw new HttpError(404, "Flow not found");
    res.json({ ok: true, updatedAt: f.updatedAt, ...validateFlow(nodes, edges, listAllToolNames()) });
  })
);

/** Publish = bot ab isi flow se chalega */
flowsRouter.post(
  "/:id/publish",
  asyncH(async (req, res) => {
    const f = await Flow.findById(req.params.id).lean();
    if (!f) throw new HttpError(404, "Flow not found");
    const check = validateFlow(f.nodes as FlowNode[], f.edges as FlowEdge[], listAllToolNames());
    if (check.errors.length) return res.status(400).json({ error: "Fix these before publishing", ...check });
    await getSettings();
    await Settings.updateOne({ _id: "global" }, { activeFlowId: f._id });
    res.json({ ok: true, ...check });
  })
);

flowsRouter.post(
  "/unpublish",
  asyncH(async (_req, res) => {
    await Settings.updateOne({ _id: "global" }, { activeFlowId: null });
    res.json({ ok: true });
  })
);

flowsRouter.post(
  "/:id/duplicate",
  asyncH(async (req, res) => {
    const f = await Flow.findById(req.params.id).lean();
    if (!f) throw new HttpError(404, "Flow not found");
    const copy = await Flow.create({ name: `${f.name} (copy)`.slice(0, 80), nodes: f.nodes, edges: f.edges });
    res.status(201).json({ _id: copy._id });
  })
);

flowsRouter.delete(
  "/:id",
  asyncH(async (req, res) => {
    await Settings.updateOne({ _id: "global", activeFlowId: req.params.id }, { activeFlowId: null });
    await Flow.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  })
);

/* ════════════════ Incoming Flow Webhooks (CRM Trigger) ════════════════ */
type WebhookEventLog = {
  receivedAt: string;
  nodeId?: string;
  payload: unknown;
  recipientId?: string;
};
const latestFlowWebhooks = new Map<string, WebhookEventLog>();

export function recordFlowWebhookEvent(flowId: string, event: WebhookEventLog) {
  latestFlowWebhooks.set(String(flowId), event);
}

flowsRouter.get(
  "/:id/latest-webhook",
  asyncH(async (req, res) => {
    const event = latestFlowWebhooks.get(String(req.params.id)) || null;
    res.json({ event });
  })
);

/* ── Live ngrok Tunnel Detection & Public Testing Helper ── */
flowsRouter.get(
  "/ngrok-tunnel/status",
  asyncH(async (_req, res) => {
    const envUrl = (
      process.env.NGROK_URL ||
      process.env.PUBLIC_WEBHOOK_URL ||
      process.env.PUBLIC_URL ||
      ""
    ).trim();

    let ngrokApiUrl: string | null = null;
    let tunnels: Array<{ name: string; public_url: string; proto: string }> = [];

    // Query ngrok's local inspection API running on default port 4040
    try {
      const resp = await fetch("http://127.0.0.1:4040/api/tunnels", {
        signal: AbortSignal.timeout(1500),
      });
      if (resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
        tunnels = (data.tunnels as Array<{ name: string; public_url: string; proto: string }>) || [];
        const httpsTunnel = tunnels.find((t) => t.proto === "https") || tunnels[0];
        if (httpsTunnel?.public_url) {
          ngrokApiUrl = httpsTunnel.public_url.replace(/\/+$/, "");
        }
      }
    } catch {
      // ngrok not currently running on 127.0.0.1:4040
    }

    const publicUrl =
      ngrokApiUrl ||
      (envUrl.startsWith("http") && !envUrl.includes("localhost") && !envUrl.includes("127.0.0.1")
        ? envUrl.replace(/\/+$/, "")
        : null);

    res.json({
      ok: true,
      active: Boolean(publicUrl),
      publicUrl,
      source: ngrokApiUrl ? "ngrok-api" : publicUrl ? "env" : "none",
      port: Number(process.env.PORT || 5000),
      tunnels,
    });
  })
);

flowsRouter.post(
  "/ngrok-tunnel/test-ping",
  asyncH(async (req, res) => {
    const rawUrl = String(req.body?.url || "").trim();
    if (!rawUrl) throw new HttpError(400, "URL is required");
    const started = Date.now();
    try {
      const pingRes = await fetch(rawUrl, {
        method: "GET",
        headers: { "User-Agent": "Antigravity-Webhook-Tester/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      const data = await pingRes.json().catch(() => null);
      res.json({
        ok: pingRes.ok,
        status: pingRes.status,
        statusText: pingRes.statusText,
        data,
        latencyMs: Date.now() - started,
      });
    } catch (err) {
      res.json({
        ok: false,
        status: 0,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - started,
      });
    }
  })
);

/* ── Test live Cloud Gateway / PinBot WhatsApp Dispatch ── */
flowsRouter.post(
  "/test-whatsapp-dispatch",
  asyncH(async (req, res) => {
    const { phoneId, apiKey, to, text, template, provider, apiUrl } = req.body || {};
    if (!to) throw new HttpError(400, "Recipient phone number ('to') is required");
    const sampleText =
      String(text || "").trim() || "Hello! This is a test message from your Cloud Gateway WhatsApp chatbot.";

    const result = await sendWhatsAppMessage({
      provider: provider || "cloudgateway",
      phoneNumberId: phoneId,
      apiKey,
      to: String(to),
      text: template ? undefined : sampleText,
      template,
      apiUrl,
    });

    res.json(result);
  })
);

export const flowWebhookReceiverRouter = Router();

flowWebhookReceiverRouter.get(
  ["/:flowId/:nodeId", "/:flowId"],
  asyncH(async (req, res) => {
    // ── Meta WhatsApp Webhook verification handshake ──
    const mode = req.query["hub.mode"] || req.query.mode;
    const challenge = req.query["hub.challenge"] || req.query.challenge;

    if (mode === "subscribe" && challenge) {
      console.log(`[whatsapp] Verified webhook challenge for flow ${req.params.flowId}`);
      return res.status(200).send(String(challenge));
    }

    res.json({
      ok: true,
      status: "ready",
      message: "Webhook endpoint ready. Send a POST request with your JSON payload from WhatsApp or your CRM.",
      flowId: req.params.flowId,
      nodeId: req.params.nodeId,
    });
  })
);

flowWebhookReceiverRouter.post(
  ["/:flowId/:nodeId", "/:flowId"],
  asyncH(async (req, res) => {
    const rawFlowId = String(req.params.flowId || "");
    const nodeId = req.params.nodeId ? String(req.params.nodeId) : undefined;

    let flow: any = null;
    if (mongoose.Types.ObjectId.isValid(rawFlowId)) {
      flow = await Flow.findById(rawFlowId).lean();
    }
    if (!flow) {
      const settings = await getSettings();
      if (settings.activeFlowId && mongoose.Types.ObjectId.isValid(String(settings.activeFlowId))) {
        flow = await Flow.findById(settings.activeFlowId).lean();
      }
      if (!flow) {
        flow = (await Flow.findOne({ published: true }).lean()) || (await Flow.findOne().sort({ updatedAt: -1 }).lean());
      }
    }
    if (!flow) throw new HttpError(404, "No active or published flow found to handle this webhook");

    const flowId = String(flow._id);

    const payload = req.body ?? {};
    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);

    // ── Auto-detect Meta WhatsApp Cloud API format ──
    let isWhatsApp = false;
    let waFrom: string | undefined;
    let waText: string | undefined;
    let waName: string | undefined;
    let waPhoneNumberId: string | undefined;

    if (Array.isArray(payload?.entry) && payload.entry[0]?.changes?.[0]?.value) {
      const val = payload.entry[0].changes[0].value;
      // If delivery/read status update, acknowledge HTTP 200 without executing flow
      if (Array.isArray(val.statuses) && (!Array.isArray(val.messages) || !val.messages.length)) {
        return res.status(200).json({ ok: true, status: "acknowledged_status_update" });
      }

      if (Array.isArray(val.messages) && val.messages[0]) {
        isWhatsApp = true;
        const msg = val.messages[0];
        waFrom = msg.from; // User's WhatsApp number (e.g. 919876543210)
        waText =
          msg.text?.body ||
          msg.caption ||
          msg.interactive?.button_reply?.title ||
          msg.interactive?.list_reply?.title ||
          "";
        waPhoneNumberId = val.metadata?.phone_number_id;
        if (Array.isArray(val.contacts) && val.contacts[0]?.profile?.name) {
          waName = val.contacts[0].profile.name;
        }
      }
    }

    // Auto-detect recipientId from WhatsApp or CRM fields
    const detectedRecipientId =
      waFrom ??
      payload.recipientId ??
      payload.recipient_id ??
      payload.phone ??
      payload.to ??
      payload.from ??
      payload.customer?.phone ??
      payload.customer?.id ??
      payload.id ??
      req.query.recipientId ??
      req.query.phone;

    const initialVars: Record<string, string> = {
      webhookPayload: payloadStr,
    };
    if (detectedRecipientId) {
      initialVars.recipientId = String(detectedRecipientId);
      initialVars.phone = String(detectedRecipientId);
    }
    if (waName) {
      initialVars.name = waName;
    }
    if (waPhoneNumberId) {
      initialVars.phoneNumberId = waPhoneNumberId;
    }
    if (isWhatsApp) {
      initialVars.channel = "whatsapp";
    }

    if (typeof payload === "object" && payload !== null && !isWhatsApp) {
      for (const [k, v] of Object.entries(payload)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          initialVars[k] = String(v);
        }
      }
    }

    const userMessage =
      waText ||
      (typeof payload.message === "string"
        ? payload.message
        : typeof payload.text === "string"
        ? payload.text
        : "Incoming Webhook");

    initialVars.userMessage = userMessage;

    const sessionId = isWhatsApp
      ? `wa-${detectedRecipientId || Date.now()}`
      : `crm-${flowId}-${detectedRecipientId || Date.now()}`;

    recordFlowWebhookEvent(flowId, {
      receivedAt: new Date().toISOString(),
      nodeId: nodeId || undefined,
      payload,
      recipientId: detectedRecipientId ? String(detectedRecipientId) : undefined,
    });

    const result = await handleMessage(sessionId, userMessage, isWhatsApp ? "whatsapp" : "webhook", {
      testFlowId: flowId,
      initialVars,
      startNodeId: nodeId || undefined,
    });

    // ── Find WhatsApp & Cloud Gateway configuration from Webhook node, Flow, or env ──
    const webhookNode = (flow.nodes as any[])?.find((n) => n.id === nodeId || n.type === "webhook");
    const nodeData = webhookNode?.data || {};

    const targetPhoneId =
      nodeData.whatsappPhoneId ||
      (flow as any).whatsappPhoneId ||
      waPhoneNumberId ||
      process.env.CLOUDGATEWAY_PHONE_ID ||
      process.env.PINBOT_PHONE_ID;

    const targetApiKey =
      nodeData.whatsappApiKey ||
      (flow as any).whatsappApiKey ||
      process.env.CLOUDGATEWAY_API_KEY ||
      process.env.PINBOT_API_KEY;

    const targetProvider =
      nodeData.whatsappProvider || (flow as any).whatsappProvider || "cloudgateway";

    const targetBaseUrl =
      nodeData.whatsappBaseUrl || (flow as any).whatsappBaseUrl || "https://partnersv1.pinbot.ai/v3";

    // Automatically send message back to customer on WhatsApp via Cloud Gateway PinBot API
    let whatsappResult: { ok: boolean; error?: string } | undefined;
    if (detectedRecipientId && result.reply && (targetPhoneId || waPhoneNumberId) && (targetApiKey || process.env.WHATSAPP_TOKEN)) {
      whatsappResult = await sendWhatsAppMessage({
        provider: targetProvider,
        apiUrl: targetBaseUrl,
        phoneNumberId: targetPhoneId || waPhoneNumberId,
        apiKey: targetApiKey,
        to: String(detectedRecipientId),
        text: result.reply,
      });
      if (whatsappResult.ok) {
        console.log(`[whatsapp] Successfully sent AI reply to WhatsApp number ${detectedRecipientId} via ${targetProvider}`);
      } else {
        console.warn(`[whatsapp] Message not delivered via WhatsApp gateway: ${whatsappResult.error}`);
      }
    }

    res.json({
      success: true,
      reply: result.reply,
      recipientId: result.recipientId || initialVars.recipientId,
      sessionId,
      variables: result.variables || initialVars,
      whatsappSent: whatsappResult?.ok,
      whatsappError: whatsappResult?.error,
    });
  })
);
