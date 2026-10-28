import crypto from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { Conversation, Delivery, Flow, IncomingEvent, KnowledgeDoc, LeadRead, RECOMMENDED_PROMPT, Settings, Webhook, getSettings } from "../models/index.js";
import { handleMessage } from "../services/chat.js";
import { currentUser } from "../services/auth.js";
import { checkOllama, ollamaTarget, openaiTarget, PROVIDER_SETTINGS, resolveProvider, testCompat } from "../services/providers/index.js";
import { listServers } from "../mcp/manager.js";
import { asyncH, HttpError } from "../http.js";

/* ════════════ Simple in-memory rate limit (public chat endpoint) ════════════ */
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>(); // har limiter ka apna counter
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > max) return res.status(429).json({ error: "Too many requests — please wait a minute and try again" });
    next();
  };
}

/* ════════════ Public: chat + widget config ════════════ */
export const publicRouter = Router();

publicRouter.get(
  "/widget/config",
  asyncH(async (_req, res) => {
    const s = await getSettings();
    res.json({
      botName: s.botName,
      welcomeMessage: s.welcomeMessage,
      quickReplies: s.quickReplies,
      brandColor: s.brandColor,
      widgetPosition: s.widgetPosition,
    });
  })
);

publicRouter.post(
  "/chat",
  rateLimit(30, 60_000),
  asyncH(async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message || message.length > 2000) throw new HttpError(400, "message (1–2000 chars) required");
    const sessionId =
      typeof req.body?.sessionId === "string" && /^[\w-]{8,80}$/.test(req.body.sessionId)
        ? req.body.sessionId
        : crypto.randomUUID();
    const channel = req.body?.channel === "playground" ? "playground" : "widget";
    // Draft flow test sirf logged-in admin (Flow builder ka Test panel)
    let testFlowId: string | undefined;
    if (typeof req.body?.testFlowId === "string" && /^[a-f0-9]{24}$/.test(req.body.testFlowId)) {
      if (!(await currentUser(req))) throw new HttpError(401, "Log in to test a draft flow");
      testFlowId = req.body.testFlowId;
    }
    const r = await handleMessage(sessionId, message, channel, { testFlowId });
    // Tool log sirf playground ko dikhate hain (customer ko nahi)
    res.json({ sessionId, reply: r.reply, quickReplies: r.quickReplies, ...(channel === "playground" ? { toolLog: r.toolLog, provider: r.provider } : {}) });
  })
);

/* ════════════ Admin: settings ════════════ */
export const settingsRouter = Router();

/** Abhi kaunsa AI chal raha hai aur wo ready hai ya nahi */
export async function aiStatus(s: { provider?: string | null; ollamaUrl: string; ollamaModel: string; openaiBaseUrl: string; openaiModel: string }) {
  const active = resolveProvider(s.provider);
  const apiKeyConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
  if (active === "claude")
    return { active, ready: apiKeyConfigured, apiKeyConfigured, detail: apiKeyConfigured ? "Claude API key found" : "ANTHROPIC_API_KEY missing in backend/.env" };
  if (active === "openai") {
    const hasKey = Boolean(process.env.OPENAI_COMPAT_API_KEY);
    return {
      active,
      ready: hasKey,
      apiKeyConfigured,
      openaiKeyConfigured: hasKey,
      detail: hasKey ? `${s.openaiModel} via ${hostOf(s.openaiBaseUrl)}` : "OPENAI_COMPAT_API_KEY missing in backend/.env",
    };
  }
  if (active === "ollama") {
    const o = await checkOllama(s.ollamaUrl);
    const hasModel = o.models.some((m) => m === s.ollamaModel || m.split(":")[0] === s.ollamaModel);
    return {
      active,
      ready: o.running && hasModel,
      apiKeyConfigured,
      ollama: o,
      detail: !o.running ? `Ollama not running at ${s.ollamaUrl}` : !hasModel ? `Model "${s.ollamaModel}" not downloaded` : "Ollama ready",
    };
  }
  return { active, ready: true, apiKeyConfigured, detail: "Demo mode — fixed flow, no AI" };
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const withStatus = async (s: Awaited<ReturnType<typeof getSettings>>) => ({
  ...s.toObject(),
  apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  openaiKeyConfigured: Boolean(process.env.OPENAI_COMPAT_API_KEY),
  recommendedPrompt: RECOMMENDED_PROMPT,
  ai: await aiStatus(s),
});

settingsRouter.get(
  "/",
  asyncH(async (_req, res) => {
    res.json(await withStatus(await getSettings()));
  })
);

const EDITABLE = ["botName", "provider", "ollamaUrl", "ollamaModel", "openaiBaseUrl", "openaiModel", "model", "maxTokens", "welcomeMessage", "systemPrompt", "quickReplies", "brandColor", "widgetPosition", "maxToolRounds"] as const;

settingsRouter.put(
  "/",
  asyncH(async (req, res) => {
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE) if (k in (req.body ?? {})) patch[k] = req.body[k];
    if ("brandColor" in patch && !/^#[0-9a-fA-F]{6}$/.test(String(patch.brandColor))) throw new HttpError(400, "brandColor must be like #0f6e56");
    if ("provider" in patch && !(PROVIDER_SETTINGS as readonly string[]).includes(String(patch.provider))) throw new HttpError(400, "Unknown provider");
    if ("openaiBaseUrl" in patch && !/^https?:\/\/[^\s]+$/.test(String(patch.openaiBaseUrl))) throw new HttpError(400, "API base URL must start with https://");
    if ("openaiModel" in patch && !String(patch.openaiModel).trim()) throw new HttpError(400, "Model name is required");
    if ("ollamaUrl" in patch && !/^https?:\/\/[^\s]+$/.test(String(patch.ollamaUrl))) throw new HttpError(400, "Ollama URL must start with http:// or https://");
    if ("ollamaModel" in patch && !String(patch.ollamaModel).trim()) throw new HttpError(400, "Ollama model is required");
    if ("maxTokens" in patch) patch.maxTokens = Math.min(Math.max(Number(patch.maxTokens) || 1024, 256), 8192);
    if ("maxToolRounds" in patch) patch.maxToolRounds = Math.min(Math.max(Number(patch.maxToolRounds) || 5, 1), 10);
    if ("quickReplies" in patch) patch.quickReplies = (Array.isArray(patch.quickReplies) ? patch.quickReplies : []).map(String).filter(Boolean).slice(0, 6);
    await getSettings();
    await Settings.updateOne({ _id: "global" }, patch, { runValidators: true });
    const s = await Settings.findById("global");
    res.json(await withStatus(s!));
  })
);

/** "Test connection" — form me jo URL/model hai usse ek chhota sawaal + tool calling check */
settingsRouter.post(
  "/test-ai",
  asyncH(async (req, res) => {
    const kind = req.body?.provider === "ollama" ? "ollama" : "openai";
    const s = await getSettings();
    if (kind === "openai") {
      if (!process.env.OPENAI_COMPAT_API_KEY) throw new HttpError(400, "Add OPENAI_COMPAT_API_KEY to backend/.env and restart the backend first");
      const url = String(req.body?.openaiBaseUrl ?? s.openaiBaseUrl);
      if (!/^https?:\/\//.test(url)) throw new HttpError(400, "API base URL must start with https://");
      return res.json(await testCompat(openaiTarget(url, String(req.body?.openaiModel ?? s.openaiModel))));
    }
    res.json(await testCompat(ollamaTarget(String(req.body?.ollamaUrl ?? s.ollamaUrl), String(req.body?.ollamaModel ?? s.ollamaModel))));
  })
);

/* ════════════ Admin: overview stats ════════════ */
async function extraStats() {
  const s = await getSettings();
  const [flow, needsHuman, docs] = await Promise.all([
    s.activeFlowId ? Flow.findById(s.activeFlowId).select("name").lean() : null,
    Conversation.countDocuments({ needsHuman: true }),
    KnowledgeDoc.countDocuments({ enabled: true }),
  ]);
  return { activeFlow: flow ? { id: flow._id, name: flow.name } : null, needsHuman, knowledgeDocs: docs };
}

export const statsRouter = Router();

statsRouter.get(
  "/",
  asyncH(async (_req, res) => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [convos, convos7d, leads, leads7d, deliveries, failed, incoming, webhooks, servers, recentConvos] = await Promise.all([
      Conversation.countDocuments(),
      Conversation.countDocuments({ createdAt: { $gte: since } }),
      LeadRead.countDocuments(),
      LeadRead.countDocuments({ createdAt: { $gte: since } }),
      Delivery.countDocuments({ createdAt: { $gte: since } }),
      Delivery.countDocuments({ createdAt: { $gte: since }, success: false }),
      IncomingEvent.countDocuments({ createdAt: { $gte: since } }),
      Webhook.countDocuments({ active: true }),
      listServers(),
      Conversation.find().sort({ updatedAt: -1 }).limit(6).select("sessionId channel messages updatedAt toolCalls").lean(),
    ]);

    // Daily conversations — last 7 days
    const daily: { date: string; conversations: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      // Local date (toISOString UTC me convert karke IST me ek din peeche kar deta hai)
      const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      daily.push({
        date: local,
        conversations: await Conversation.countDocuments({ createdAt: { $gte: d, $lt: next } }),
      });
    }

    // Tool usage (last 200 conversations)
    const toolCounts: Record<string, number> = {};
    const recentForTools = await Conversation.find({ updatedAt: { $gte: since } }).select("toolCalls").limit(200).lean();
    for (const c of recentForTools) for (const t of c.toolCalls ?? []) if (t.name && t.name.includes("__")) toolCounts[t.name] = (toolCounts[t.name] ?? 0) + 1;

    res.json({
      conversations: { total: convos, last7d: convos7d },
      leads: { total: leads, last7d: leads7d },
      webhooks: { active: webhooks, deliveries7d: deliveries, failed7d: failed, incoming7d: incoming },
      mcp: {
        servers: servers.length,
        connected: servers.filter((s) => s.status === "connected").length,
        tools: servers.reduce((n, s) => n + s.tools.filter((t) => t.enabled).length, 0),
        list: servers.map((s) => ({ name: s.name, slug: s.slug, status: s.status, tools: s.tools.length })),
      },
      daily,
      toolUsage: Object.entries(toolCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      recentConversations: recentConvos.map((c) => ({
        sessionId: c.sessionId,
        channel: c.channel,
        updatedAt: c.updatedAt,
        messages: c.messages?.length ?? 0,
        toolCalls: (c.toolCalls ?? []).filter((t) => t.name?.includes("__")).length,
        lastMessage: c.messages?.[c.messages.length - 1]?.content?.slice(0, 120) ?? "",
      })),
      apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      ai: await aiStatus(await getSettings()),
      ...(await extraStats()),
    });
  })
);

/** Saari conversations (Conversations page) — ?channel=widget|playground|webhook &page=1 */
statsRouter.get(
  "/conversations",
  asyncH(async (req, res) => {
    const PAGE = 25;
    const page = Math.max(1, Number(req.query.page) || 1);
    const q: Record<string, unknown> = {};
    if (["widget", "playground", "webhook"].includes(String(req.query.channel))) q.channel = String(req.query.channel);
    if (req.query.needsHuman === "1") q.needsHuman = true;
    const [total, docs] = await Promise.all([
      Conversation.countDocuments(q),
      Conversation.find(q)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * PAGE)
        .limit(PAGE)
        .select("sessionId channel messages toolCalls needsHuman createdAt updatedAt")
        .lean(),
    ]);
    res.json({
      total,
      page,
      pages: Math.max(1, Math.ceil(total / PAGE)),
      items: docs.map((c) => {
        const msgs = c.messages ?? [];
        const tools = c.toolCalls ?? [];
        return {
          sessionId: c.sessionId,
          channel: c.channel,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          messages: msgs.length,
          toolCalls: tools.filter((t) => t.name?.includes("__")).length,
          firstMessage: msgs.find((m) => m.role === "user")?.content?.slice(0, 140) ?? "",
          lastMessage: msgs[msgs.length - 1]?.content?.slice(0, 140) ?? "",
          leadSaved: tools.some((t) => t.name?.endsWith("__save_lead") && !t.isError && /saved/i.test(t.output ?? "")),
          meetingBooked: tools.some((t) => t.name?.endsWith("__book_meeting") && !t.isError && /booked/i.test(t.output ?? "")),
          hadError: tools.some((t) => t.isError),
          needsHuman: Boolean(c.needsHuman),
        };
      }),
    });
  })
);

/** "Needs human" wali conversation team ne sambhal li → bot phir se jawab dega */
statsRouter.post(
  "/conversations/:sessionId/resolve",
  asyncH(async (req, res) => {
    const c = await Conversation.findOne({ sessionId: req.params.sessionId });
    if (!c) throw new HttpError(404, "Not found");
    c.needsHuman = false;
    const st = (c.state ?? {}) as { flow?: { handoff?: boolean } };
    if (st.flow) st.flow.handoff = false;
    c.state = st;
    c.markModified("state");
    await c.save();
    res.json({ ok: true });
  })
);

/** Ek conversation ka transcript (overview se click) */
statsRouter.get(
  "/conversations/:sessionId",
  asyncH(async (req, res) => {
    const c = await Conversation.findOne({ sessionId: req.params.sessionId }).lean();
    if (!c) throw new HttpError(404, "Not found");
    res.json(c);
  })
);

