import { Schema, model, type InferSchemaType } from "mongoose";

/* ───────── Bot instructions (system prompt) — Bot settings me "Use recommended" isi ko wapas laata hai ───────── */
export const RECOMMENDED_PROMPT = `You are a friendly sales assistant chatbot for a digital agency in Delhi.
Reply in the same language the customer uses (Hindi, Hinglish or English). Keep replies short (2-4 lines).

Conversation flow:
1. Greet and ask how you can help.
2. If they ask about services or pricing, use the services tool.
3. To capture a lead, collect: name, 10-digit phone number, service. Ask one thing at a time.
4. Repeat the details back and ask for confirmation, THEN save the lead.
5. After saving, thank them and say the team will contact them within 24 hours.
6. If they ask about an earlier enquiry, ask for their phone and look it up.

Appointments (if appointment tools are available):
7. If they want a meeting or call, ask which day, then check free slots for that date and offer a few.
8. Collect name and 10-digit phone, confirm date + time, THEN book the meeting and share the booking id.
9. To cancel or check a booking, ask for their phone number and use the booking tools.

Never invent prices, slots or facts that are not in tool results.`;

/* ───────── Bot settings (single document) ───────── */
const settingsSchema = new Schema(
  {
    _id: { type: String, default: "global" },
    botName: { type: String, default: "Agency Assistant" },
    // AI provider: auto = Claude key ho to Claude, warna demo
    provider: { type: String, enum: ["auto", "claude", "openai", "ollama", "demo"], default: "auto" },
    // "Free API" — koi bhi OpenAI-compatible service (key backend/.env me OPENAI_COMPAT_API_KEY)
    openaiBaseUrl: { type: String, default: process.env.OPENAI_COMPAT_BASE_URL ?? "https://api.groq.com/openai/v1" },
    openaiModel: { type: String, default: process.env.OPENAI_COMPAT_MODEL ?? "llama-3.3-70b-versatile" },
    ollamaUrl: { type: String, default: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434" },
    ollamaModel: { type: String, default: process.env.OLLAMA_MODEL ?? "qwen2.5:7b" },
    model: { type: String, default: process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5" },
    maxTokens: { type: Number, default: 1024 },
    welcomeMessage: {
      type: String,
      default: "Namaste! 👋 Main aapki kaise madad kar sakta hoon? Website, SEO, GMB ya social media — kuch bhi poochiye.",
    },
    systemPrompt: { type: String, default: () => RECOMMENDED_PROMPT },
    quickReplies: { type: [String], default: ["Aap kya services dete ho?", "Mujhe website banwani hai", "Meri enquiry ka status?"] },
    brandColor: { type: String, default: "#0f6e56" },
    widgetPosition: { type: String, enum: ["right", "left"], default: "right" },
    maxToolRounds: { type: Number, default: 5 },
    // Built-in MCP servers jo ek baar apne aap jod diye gaye (delete karne par wapas nahi aate)
    seededServers: { type: [String], default: [] },
    // Knowledge base: har sawaal par sirf itne tukde (chunks) / itne characters LLM ko jaate hain
    knowledgeEnabled: { type: Boolean, default: true },
    knowledgeTopK: { type: Number, default: 4 },
    knowledgeMaxChars: { type: Number, default: 2500 },
    // Flow builder: jo flow "Published" hai (null = sirf AI se baat)
    activeFlowId: { type: Schema.Types.ObjectId, ref: "Flow", default: null },
    // Login tokens sign karne ka secret (JWT_SECRET env na ho to yahan ek baar ban jaata hai)
    authSecret: { type: String, select: false },
  },
  { timestamps: true }
);
export const Settings = model("Settings", settingsSchema);
export type SettingsDoc = InferSchemaType<typeof settingsSchema>;

export async function getSettings() {
  return (await Settings.findById("global")) ?? (await Settings.create({ _id: "global" }));
}

/* ───────── MCP servers (connections) ───────── */
const mcpServerSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, match: /^[a-z0-9-]{2,30}$/ },
    transport: { type: String, enum: ["stdio", "http"], required: true },
    // stdio
    command: String,
    args: { type: [String], default: [] },
    env: { type: Map, of: String, default: {} },
    // http (Streamable HTTP)
    url: String,
    headers: { type: Map, of: String, default: {} },
    enabled: { type: Boolean, default: true },
    disabledTools: { type: [String], default: [] },
  },
  { timestamps: true }
);
export const McpServer = model("McpServer", mcpServerSchema);
export type McpServerDoc = InferSchemaType<typeof mcpServerSchema> & { _id: unknown };

/* ───────── Outgoing webhooks ───────── */
export const WEBHOOK_EVENTS = [
  "conversation.started",
  "message.received",
  "message.sent",
  "tool.called",
  "tool.failed",
  "lead.created",
  "appointment.booked",
  "appointment.cancelled",
  "conversation.handoff",
  "webhook.test",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const webhookSchema = new Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    events: { type: [String], enum: WEBHOOK_EVENTS, default: ["lead.created"] },
    secret: { type: String, required: true },
    headers: { type: Map, of: String, default: {} },
    active: { type: Boolean, default: true },
    lastStatus: Number,
    lastDeliveredAt: Date,
  },
  { timestamps: true }
);
export const Webhook = model("Webhook", webhookSchema);

const deliverySchema = new Schema(
  {
    webhookId: { type: Schema.Types.ObjectId, ref: "Webhook", index: true },
    webhookName: String,
    event: String,
    url: String,
    payload: Schema.Types.Mixed,
    attempt: { type: Number, default: 1 },
    success: Boolean,
    statusCode: Number,
    responseBody: String,
    error: String,
    durationMs: Number,
  },
  { timestamps: true }
);
export const Delivery = model("Delivery", deliverySchema);

/* ───────── Incoming webhook endpoints ───────── */
const incomingHookSchema = new Schema(
  {
    name: { type: String, required: true },
    token: { type: String, required: true, unique: true },
    // log  → sirf payload save
    // chat → payload.message bot ko bhejo, reply response me lautao
    // tool → kisi MCP tool ko payload ke saath call karo
    action: { type: String, enum: ["log", "chat", "tool"], default: "log" },
    toolName: String, // action=tool ke liye: "<serverSlug>__<tool>"
    active: { type: Boolean, default: true },
    lastReceivedAt: Date,
    receivedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);
export const IncomingHook = model("IncomingHook", incomingHookSchema);

const incomingEventSchema = new Schema(
  {
    hookId: { type: Schema.Types.ObjectId, ref: "IncomingHook", index: true },
    hookName: String,
    payload: Schema.Types.Mixed,
    headers: Schema.Types.Mixed,
    result: String,
    success: Boolean,
  },
  { timestamps: true }
);
export const IncomingEvent = model("IncomingEvent", incomingEventSchema);

/* ───────── Conversations (overview stats + playground) ───────── */
const conversationSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    channel: { type: String, default: "widget" }, // widget | playground | webhook
    needsHuman: { type: Boolean, default: false }, // flow ka "Human handoff" box
    state: { type: Schema.Types.Mixed, default: {} }, // demo mode ka step-by-step flow state
    messages: [
      {
        role: { type: String, enum: ["user", "assistant"] },
        content: String,
        at: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    toolCalls: [
      {
        name: String,
        input: Schema.Types.Mixed,
        output: String,
        isError: Boolean,
        at: { type: Date, default: Date.now },
        _id: false,
      },
    ],
  },
  { timestamps: true }
);
export const Conversation = model("Conversation", conversationSchema);

/* Lead collection mcp-server likhta hai; overview count ke liye read-only model */
export const LeadRead = model("Lead", new Schema({}, { strict: false, timestamps: true }), "leads");
/* Appointment collection appointment-server likhta hai; dashboard ke liye read/update model */
export const AppointmentRead = model("Appointment", new Schema({}, { strict: false, timestamps: true }), "appointments");

/* ───────── Knowledge base (uploaded files) ───────── */
const knowledgeDocSchema = new Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ["md", "txt", "pdf", "docx"], required: true },
    size: Number, // bytes
    chars: Number,
    chunkCount: Number,
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);
export const KnowledgeDoc = model("KnowledgeDoc", knowledgeDocSchema);

const knowledgeChunkSchema = new Schema({
  docId: { type: Schema.Types.ObjectId, ref: "KnowledgeDoc", index: true },
  docName: String,
  title: String, // heading path, jaise "Pricing › SEO"
  text: String,
  order: Number,
});
export const KnowledgeChunk = model("KnowledgeChunk", knowledgeChunkSchema);

/* ───────── Flow builder ───────── */
const flowSchema = new Schema(
  {
    name: { type: String, required: true },
    nodes: { type: Schema.Types.Mixed, default: [] }, // React Flow nodes: { id, type, position, data }
    edges: { type: Schema.Types.Mixed, default: [] }, // React Flow edges: { id, source, target, sourceHandle }
  },
  { timestamps: true, minimize: false }
);
export const Flow = model("Flow", flowSchema);

/* ───────── Dashboard users (login) ───────── */
const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true }
);
export const User = model("User", userSchema);
