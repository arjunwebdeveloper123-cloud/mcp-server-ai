import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import { connectAll, closeAll, seedDefaultServer } from "./mcp/manager.js";
import { seedKnowledgeFiles } from "./services/knowledge.js";
import { mcpRouter } from "./routes/mcp.js";
import { webhooksRouter, incomingRouter, receiverRouter } from "./routes/webhooks.js";
import { publicRouter, settingsRouter, statsRouter } from "./routes/core.js";
import { errorHandler } from "./http.js";
import { authRouter } from "./routes/auth.js";
import { knowledgeRouter } from "./routes/knowledge.js";
import { flowsRouter, flowWebhookReceiverRouter } from "./routes/flows.js";
import { dataRouter } from "./routes/data.js";
import { requireAuth } from "./services/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 5000);
// Dashboard me login nahi hai → default sirf apne computer (127.0.0.1) par suno.
const HOST = process.env.HOST ?? "127.0.0.1";
const DASHBOARD_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const WIDGET_URL = process.env.WIDGET_URL ?? `${DASHBOARD_ORIGIN}/widget/chat`;

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "200kb" }));
app.use(cookieParser());

/* ── Public routes (koi bhi website / service call kar sakti hai) ── */
const publicCors = cors({ origin: true });
app.get("/embed.js", publicCors, (_req, res) => {
  const src = fs.readFileSync(path.join(__dirname, "public", "embed.js"), "utf8").replace("__WIDGET_URL__", WIDGET_URL);
  res.type("application/javascript").set("Cache-Control", "public, max-age=300").send(src);
});
app.use("/api", publicCors, publicRouter); // /api/chat, /api/widget/config
app.use("/hooks/in", publicCors, receiverRouter); // incoming webhooks
app.use("/hooks/flow", publicCors, flowWebhookReceiverRouter); // incoming CRM flow webhooks

// Root and Webhook info endpoints for ngrok connectivity confirmation
app.get("/", publicCors, (_req, res) => {
  res.json({
    ok: true,
    service: "Chatbot and Flow Engine API",
    status: "online",
    tunnelReady: true,
    flowWebhookEndpoint: "/hooks/flow/:flowId/:nodeId",
    message: "Backend is connected with ngrok! To trigger a flow from your CRM, copy the predefined webhook URL from Flow Builder.",
  });
});

app.all(["/webhook", "/webhooks"], publicCors, (req, res) => {
  res.json({
    ok: true,
    status: "ready",
    message: "Webhook receiver is active. For flow triggers, please use: /hooks/flow/:flowId/:nodeId",
    hint: "Open your Flow in Flow Builder, click your Webhook box, and copy the Predefined Webhook URL.",
    receivedMethod: req.method,
  });
});
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, db: mongoose.connection.readyState === 1 });
});

/* ── Login ── */
const adminCors = cors({ origin: DASHBOARD_ORIGIN, credentials: true });
app.use("/api/auth", adminCors, authRouter);

/* ── Admin routes (sirf dashboard, login zaroori) ── */
app.use("/api/admin", adminCors, requireAuth);
app.use("/api/admin/settings", adminCors, settingsRouter);
app.use("/api/admin/stats", adminCors, statsRouter);
app.use("/api/admin/mcp", adminCors, mcpRouter);
app.use("/api/admin/webhooks", adminCors, webhooksRouter);
app.use("/api/admin/incoming", adminCors, incomingRouter);
app.use("/api/admin/knowledge", adminCors, knowledgeRouter);
app.use("/api/admin/flows", adminCors, flowsRouter);
app.use("/api/admin/data", adminCors, dataRouter);

app.use(errorHandler);

async function main() {
  const uri = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/chatbot";
  await mongoose.connect(uri);
  console.log("[backend] MongoDB connected");

  await seedDefaultServer();
  await seedKnowledgeFiles(); // knowledge-files/*.md → Knowledge base (sirf pehli baar)
  await connectAll(); // DB me saved saare MCP servers connect

  app.listen(PORT, HOST, () => {
    console.log(`[backend] API      http://${HOST}:${PORT}`);
    console.log(`[backend] Embed    http://${HOST}:${PORT}/embed.js`);
    if (!process.env.ANTHROPIC_API_KEY)
      console.log("[backend] No ANTHROPIC_API_KEY — bot uses the Free API (OPENAI_COMPAT_API_KEY) or Demo mode");
  });
}

main().catch((err) => {
  console.error("[backend] failed to start:", err);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await closeAll();
    await mongoose.disconnect();
    process.exit(0);
  });
}
